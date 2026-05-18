import { batch, createSignal } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { newId } from "./lib/id";
import {
  UserFacingMessages,
  type CapabilityStatus,
  isUnsupportedEndpointError,
} from "./lib/capability";
import { AgUiCustomEventNames } from "./lib/agui-custom-events";
import {
  parseA2uiMessages,
  parseApprovalRequest,
  parseApprovalResolved,
  parseFileArtifact,
  parseThinkingStatus,
  parseToolCallStatus,
  type ThinkingStatusEvent,
} from "./lib/parsers";
import {
  loadSettings,
  loadThreadsBundle,
  saveSettings,
  saveThreadsBundle,
  type GenericCustomTimelineItem,
  type Message,
  type RuntimeThoughtCard,
  type Settings,
  type Thread,
  type ToolCallCard,
} from "./lib/storage";
import {
  deleteFile,
  downloadFile,
  FileMissingError,
  FileNotTextError,
  FilePreconditionFailedError,
  FileTooLargeError,
  listAgents,
  listFiles,
  loadFileContent,
  postApprovalResponse,
  postRun,
  resumeRun,
  saveFileContent,
  type ApprovalDecision,
  type AgUiEvent,
  type FileEntry,
  type StreamHandle,
} from "./lib/api";
import { buildRunPrompt } from "./lib/fileEditor";

// One Solid store for all UI-relevant state. Persistence is fanned out
// to localStorage in `persist*` helpers — we don't observe the whole
// store with createEffect because that re-serializes on every keystroke.

interface AppState {
  capabilities: {
    agentsApi: CapabilityStatus;
    filesApi: CapabilityStatus;
    approvalApi: CapabilityStatus;
  };
  settings: Settings;
  availableAgents: string[];
  threads: Thread[];
  currentThreadId: string | null;
  isStreaming: boolean;
  // Most recent event id we received from the hub for the in-flight
  // run. Used to resume via Last-Event-ID after a network blip.
  lastEventSeq: string | undefined;
  // Surfaced to UI as a transient banner; cleared on next user action.
  errorBanner: string | null;
  filesDrawer: {
    open: boolean;
    agent: string | null;
    entries: FileEntry[];
    loadingState: "idle" | "loading" | "error";
    errorMessage: string | null;
    truncated: boolean;
  };
  fileEditor: {
    open: boolean;
    agent: string | null;
    path: string | null;
    text: string;
    etag: string | null;
    mime: string | null;
    sizeBytes: number;
    dirty: boolean;
    loadingState: "idle" | "loading" | "saving" | "error";
    errorMessage: string | null;
  };
}

const initialSettings = loadSettings();
const initialBundle = loadThreadsBundle();
const [state, setState] = createStore<AppState>({
  capabilities: {
    agentsApi: "unknown",
    filesApi: "unknown",
    approvalApi: "unknown",
  },
  settings: initialSettings,
  availableAgents: [initialSettings.defaultAgent],
  threads: initialBundle.threads,
  currentThreadId: initialBundle.currentThreadId,
  isStreaming: false,
  lastEventSeq: undefined,
  errorBanner: null,
  filesDrawer: {
    open: false,
    agent: null,
    entries: [],
    loadingState: "idle",
    errorMessage: null,
    truncated: false,
  },
  fileEditor: {
    open: false,
    agent: null,
    path: null,
    text: "",
    etag: null,
    mime: null,
    sizeBytes: 0,
    dirty: false,
    loadingState: "idle",
    errorMessage: null,
  },
});

// Track the in-flight stream handle so we can abort on user actions
// (sending a new message, switching threads, etc).
const [activeStream, setActiveStream] = createSignal<StreamHandle | null>(null);
let activeRunId: string | null = null;
const activeRunIdByThread = new Map<string, string>();

export const store = state;
void refreshAvailableAgents(initialSettings);

// Keep the open Files drawer pinned to the active thread's agent.
// Called from every entry point that mutates `currentThreadId`
// (thread switch, new chat, delete). Without this, switching from a
// zeptoclaw thread to a codex thread left the drawer showing the
// previous agent's file list until the user manually closed/reopened
// it — UX bug surfaced in 2026-05-18.
function syncFilesDrawerToCurrentThread(): void {
  if (!state.filesDrawer.open) return;
  const agent = currentThread()?.agent ?? null;
  if (agent === state.filesDrawer.agent) return;
  setState(
    produce((s: AppState) => {
      s.filesDrawer.agent = agent;
      // Drop stale entries immediately so the previous agent's files
      // don't flash for the few hundred ms before refreshFiles lands.
      s.filesDrawer.entries = [];
      s.filesDrawer.truncated = false;
      s.filesDrawer.errorMessage = null;
    }),
  );
  if (agent) {
    void refreshFiles();
  }
}

export function setCurrentThread(threadId: string): void {
  setState("currentThreadId", threadId);
  persistThreads();
  syncFilesDrawerToCurrentThread();
}

export function newThread(agent?: string): Thread {
  const t: Thread = {
    id: newId(),
    title: "New chat",
    agent: agent ?? state.settings.defaultAgent,
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
    messages: [],
  };
  setState(
    produce((s: AppState) => {
      s.threads.unshift(t);
      s.currentThreadId = t.id;
    }),
  );
  persistThreads();
  syncFilesDrawerToCurrentThread();
  // If the agent catalog hasn't been confirmed yet (initial mount
  // failed because the gateway wasn't reachable), opportunistically
  // refresh it here. The dropdown self-heals the next time the user
  // hits "+ New Chat" instead of being stuck on a fallback list of
  // just the default agent. Successful state ("supported") short-
  // circuits, so this is free in the happy path.
  if (state.capabilities.agentsApi !== "supported") {
    void refreshAvailableAgents();
  }
  return t;
}

export function deleteThread(threadId: string): void {
  setState(
    produce((s: AppState) => {
      const idx = s.threads.findIndex((t) => t.id === threadId);
      if (idx === -1) return;
      s.threads.splice(idx, 1);
      if (s.currentThreadId === threadId) {
        s.currentThreadId = s.threads[0]?.id ?? null;
      }
    }),
  );
  persistThreads();
  syncFilesDrawerToCurrentThread();
}

export function updateSettings(s: Settings): void {
  setState(
    produce((st: AppState) => {
      st.settings = s;
      st.capabilities.agentsApi = "unknown";
      st.capabilities.filesApi = "unknown";
      st.capabilities.approvalApi = "unknown";
      st.filesDrawer.open = false;
      st.filesDrawer.agent = null;
      st.filesDrawer.entries = [];
      st.filesDrawer.errorMessage = null;
      st.filesDrawer.loadingState = "idle";
      st.filesDrawer.truncated = false;
    }),
  );
  saveSettings(s);
  void refreshAvailableAgents(s);
}

export function clearErrorBanner(): void {
  setState("errorBanner", null);
}

function markCapability(kind: keyof AppState["capabilities"], status: CapabilityStatus): void {
  setState("capabilities", kind, status);
}

async function withCapability<T>(
  kind: keyof AppState["capabilities"],
  unsupportedMessage: string,
  op: () => Promise<T>,
  onUnsupported?: () => void,
): Promise<T> {
  if (state.capabilities[kind] === "unsupported") {
    throw new Error(unsupportedMessage);
  }
  try {
    const result = await op();
    markCapability(kind, "supported");
    return result;
  } catch (err) {
    if (isUnsupportedEndpointError(err)) {
      markCapability(kind, "unsupported");
      onUnsupported?.();
      throw new Error(unsupportedMessage);
    }
    throw err;
  }
}

function normalizeAgents(agents: string[], fallback: string): string[] {
  const out: string[] = [];
  for (const raw of agents) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (out.includes(trimmed)) continue;
    out.push(trimmed);
  }
  if (out.length === 0) {
    out.push(fallback.trim() || "default");
  }
  return out;
}

// Tracks whether a background retry is already scheduled so we don't
// pile up timers if multiple call sites notice the fallback state at
// once (e.g. `newThread()` racing with the initial mount).
let agentRefreshRetryScheduled = false;

export async function refreshAvailableAgents(settingsOverride?: Settings): Promise<void> {
  const settings = settingsOverride ?? state.settings;
  if (!settings.gatewayUrl.trim()) {
    setState("availableAgents", normalizeAgents([], settings.defaultAgent));
    markCapability("agentsApi", "unknown");
    return;
  }
  try {
    const catalog = await listAgents(settings);
    setState("availableAgents", normalizeAgents(catalog.agents, catalog.defaultAgent));
    markCapability("agentsApi", "supported");
    agentRefreshRetryScheduled = false;
  } catch (err) {
    const unsupported = isUnsupportedEndpointError(err);
    markCapability("agentsApi", unsupported ? "unsupported" : "unknown");
    // Keep UX stable on transient errors; settings dialog surfaces
    // details. Schedule one delayed retry for the "gateway not yet
    // reachable on app launch" case so the agent dropdown self-heals
    // without the user having to re-open Settings. Permanent failures
    // (`unsupported`) skip the retry — the endpoint isn't coming back.
    setState("availableAgents", normalizeAgents([], settings.defaultAgent));
    if (!unsupported && !agentRefreshRetryScheduled) {
      agentRefreshRetryScheduled = true;
      setTimeout(() => {
        agentRefreshRetryScheduled = false;
        void refreshAvailableAgents();
      }, 3000);
    }
  }
}

export function toggleFilesDrawer(agent: string): void {
  if (state.filesDrawer.open && state.filesDrawer.agent === agent) {
    closeFilesDrawer();
    return;
  }
  openFilesDrawer(agent);
}

export function openFilesDrawer(agent: string): void {
  if (state.capabilities.filesApi === "unsupported") {
    setState("errorBanner", UserFacingMessages.filesDisabled);
    return;
  }
  setState(
    produce((s: AppState) => {
      s.filesDrawer.open = true;
      s.filesDrawer.agent = agent;
      s.filesDrawer.errorMessage = null;
    }),
  );
  void refreshFiles();
}

export function closeFilesDrawer(): void {
  setState(
    produce((s: AppState) => {
      s.filesDrawer.open = false;
      s.filesDrawer.loadingState = "idle";
      s.filesDrawer.errorMessage = null;
    }),
  );
}

export async function refreshFiles(): Promise<void> {
  const agent = state.filesDrawer.agent;
  if (!agent) return;
  setState(
    produce((s: AppState) => {
      s.filesDrawer.loadingState = "loading";
      s.filesDrawer.errorMessage = null;
    }),
  );
  try {
    const result = await listFiles(state.settings, agent);
    markCapability("filesApi", "supported");
    setState(
      produce((s: AppState) => {
        if (s.filesDrawer.agent !== agent) return;
        s.filesDrawer.entries = result.files;
        s.filesDrawer.truncated = result.truncated;
        s.filesDrawer.loadingState = "idle";
        s.filesDrawer.errorMessage = null;
      }),
    );
  } catch (err) {
    const unsupported = isUnsupportedEndpointError(err);
    if (unsupported) {
      markCapability("filesApi", "unsupported");
      setState(
        produce((s: AppState) => {
          if (s.filesDrawer.agent !== agent) return;
          s.filesDrawer.open = false;
          s.filesDrawer.loadingState = "idle";
          s.filesDrawer.errorMessage = null;
        }),
      );
      setState("errorBanner", UserFacingMessages.filesAutoHidden);
      return;
    }
    const rawMessage = err instanceof Error ? err.message : String(err);
    const message = rawMessage;
    setState(
      produce((s: AppState) => {
        if (s.filesDrawer.agent !== agent) return;
        s.filesDrawer.loadingState = "error";
        s.filesDrawer.errorMessage = message;
      }),
    );
  }
}

export async function deleteWorkspaceFile(agent: string, path: string): Promise<void> {
  await withCapability(
    "filesApi",
    UserFacingMessages.filesUnsupported,
    () => deleteFile(state.settings, agent, path),
    () => setState("errorBanner", UserFacingMessages.filesAutoHidden),
  );
  markFileDeleted(agent, path);
  setState(
    produce((s: AppState) => {
      if (s.filesDrawer.agent !== agent) return;
      s.filesDrawer.entries = s.filesDrawer.entries.filter((entry) => entry.path !== path);
    }),
  );
  persistThreads();
}

export async function downloadWorkspaceFile(agent: string, path: string): Promise<Blob> {
  return withCapability(
    "filesApi",
    UserFacingMessages.filesUnsupported,
    () => downloadFile(state.settings, agent, path),
    () => setState("errorBanner", UserFacingMessages.filesAutoHidden),
  );
}

export async function openFileEditor(agent: string, path: string): Promise<void> {
  setState(
    produce((s: AppState) => {
      s.fileEditor.open = true;
      s.fileEditor.agent = agent;
      s.fileEditor.path = path;
      s.fileEditor.text = "";
      s.fileEditor.etag = null;
      s.fileEditor.mime = null;
      s.fileEditor.sizeBytes = 0;
      s.fileEditor.dirty = false;
      s.fileEditor.loadingState = "loading";
      s.fileEditor.errorMessage = null;
    }),
  );
  try {
    const content = await loadFileContent(state.settings, agent, path);
    setState(
      produce((s: AppState) => {
        // Guard against the user closing/switching the editor while
        // the GET was in flight.
        if (s.fileEditor.agent !== agent || s.fileEditor.path !== path) return;
        s.fileEditor.text = content.text;
        s.fileEditor.etag = content.etag;
        s.fileEditor.mime = content.mime;
        s.fileEditor.sizeBytes = content.sizeBytes;
        s.fileEditor.loadingState = "idle";
        s.fileEditor.errorMessage = null;
      }),
    );
  } catch (err) {
    const message =
      err instanceof FileMissingError
        ? `${err.message} The file list was refreshed.`
        : err instanceof FileTooLargeError
          ? "File is too large to edit (limit is 5 MB)."
          : err instanceof FileNotTextError
            ? "File is not UTF-8 text. Use Download to fetch the binary."
            : err instanceof Error
              ? err.message
              : String(err);
    setState(
      produce((s: AppState) => {
        if (s.fileEditor.agent !== agent || s.fileEditor.path !== path) return;
        s.fileEditor.loadingState = "error";
        s.fileEditor.errorMessage = message;
      }),
    );
    // The drawer is almost certainly showing stale entries when we
    // see a 404 — refresh it so the ghost row disappears and the user
    // can pick a file that actually exists.
    if (err instanceof FileMissingError) {
      if (state.filesDrawer.open && state.filesDrawer.agent === agent) {
        void refreshFiles();
      }
    }
  }
}

export function closeFileEditor(): void {
  setState(
    produce((s: AppState) => {
      s.fileEditor.open = false;
      s.fileEditor.agent = null;
      s.fileEditor.path = null;
      s.fileEditor.text = "";
      s.fileEditor.etag = null;
      s.fileEditor.mime = null;
      s.fileEditor.sizeBytes = 0;
      s.fileEditor.dirty = false;
      s.fileEditor.loadingState = "idle";
      s.fileEditor.errorMessage = null;
    }),
  );
}

export function updateFileEditorText(text: string): void {
  setState(
    produce((s: AppState) => {
      if (!s.fileEditor.open) return;
      s.fileEditor.text = text;
      s.fileEditor.dirty = true;
    }),
  );
}

/**
 * Persist the editor buffer. Returns `true` on success so callers
 * (e.g. Save & Run) can chain follow-up actions only when the write
 * actually landed. Conflicts (412) are surfaced via `errorMessage`
 * but never throw — the UI shows a banner with "force overwrite".
 */
export async function saveFileEditor(options: { force?: boolean } = {}): Promise<boolean> {
  const { agent, path, text, etag } = state.fileEditor;
  if (!agent || !path) return false;
  setState(
    produce((s: AppState) => {
      s.fileEditor.loadingState = "saving";
      s.fileEditor.errorMessage = null;
    }),
  );
  try {
    const result = await saveFileContent(state.settings, agent, path, text, {
      ifMatchEtag: options.force ? null : etag,
    });
    setState(
      produce((s: AppState) => {
        if (s.fileEditor.agent !== agent || s.fileEditor.path !== path) return;
        s.fileEditor.etag = result.etag;
        s.fileEditor.sizeBytes = result.sizeBytes;
        s.fileEditor.dirty = false;
        s.fileEditor.loadingState = "idle";
        s.fileEditor.errorMessage = null;
      }),
    );
    // Reflect the new mtime/size in the drawer list if it's pinned to
    // the same agent. Race-safe via `refreshFiles`'s own agent guard.
    if (state.filesDrawer.open && state.filesDrawer.agent === agent) {
      void refreshFiles();
    }
    return true;
  } catch (err) {
    const isConflict = err instanceof FilePreconditionFailedError;
    const isMissing = err instanceof FileMissingError;
    const message = isConflict
      ? "File was modified on disk since you opened it. Click Save again to overwrite."
      : isMissing
        ? `${(err as FileMissingError).message} Cannot save here.`
        : err instanceof Error
          ? err.message
          : String(err);
    setState(
      produce((s: AppState) => {
        if (s.fileEditor.agent !== agent || s.fileEditor.path !== path) return;
        s.fileEditor.loadingState = "error";
        s.fileEditor.errorMessage = message;
        if (isConflict) {
          // Drop the now-known-stale etag so the next Save click forces
          // an overwrite via the `force: true` path the UI will use.
          s.fileEditor.etag = null;
        }
      }),
    );
    return false;
  }
}

export async function saveAndRunFileEditor(): Promise<void> {
  const { agent, path } = state.fileEditor;
  if (!agent || !path) return;
  const thread = currentThread();
  if (!thread || thread.agent !== agent) {
    setState(
      produce((s: AppState) => {
        s.fileEditor.errorMessage = `Save & Run requires an active chat with agent "${agent}". Switch threads first.`;
      }),
    );
    return;
  }
  const ok = await saveFileEditor();
  if (!ok) return;
  const prompt = buildRunPrompt(path);
  closeFileEditor();
  sendMessage(prompt);
}

export async function respondApproval(
  threadId: string,
  requestId: string,
  decision: ApprovalDecision,
): Promise<void> {
  const runId = activeRunIdByThread.get(threadId);
  if (!runId) {
    throw new Error("No active run for this thread.");
  }
  await withCapability("approvalApi", UserFacingMessages.approvalUnsupported, () =>
    postApprovalResponse(state.settings, threadId, {
      runId,
      requestId,
      decision,
    }),
  );
}

/**
 * Send a user message in the current thread. Creates the thread if
 * none is active. Returns immediately; UI watches `state.isStreaming`
 * and the assistant message that was appended in the same batch.
 */
export function sendMessage(content: string): void {
  const trimmed = content.trim();
  if (!trimmed) return;

  // Cancel any in-flight stream first; we don't want two producers
  // racing into the same thread.
  abortActiveStream();

  let thread = currentThread();
  if (!thread) {
    thread = newThread();
  }
  const threadId = thread.id;

  const userMsg: Message = {
    id: newId(),
    role: "user",
    content: trimmed,
    createdAtMs: Date.now(),
  };
  const assistantMsg: Message = {
    id: newId(),
    role: "assistant",
    content: "",
    createdAtMs: Date.now(),
    streaming: true,
  };

  batch(() => {
    appendMessages(threadId, [userMsg, assistantMsg]);
    if (thread!.title === "New chat") {
      retitleFromUser(threadId, trimmed);
    }
    setState("isStreaming", true);
    setState("lastEventSeq", undefined);
    setState("errorBanner", null);
  });

  const runId = newId();
  activeRunId = runId;
  activeRunIdByThread.set(threadId, runId);

  const handle = postRun(
    state.settings,
    {
      threadId,
      runId,
      ...(thread.agent.trim().length > 0 ? { agent: thread.agent.trim() } : {}),
      messages: [{ role: "user", content: trimmed }],
    },
    {
      onEvent: (ev, seq) => handleEvent(threadId, assistantMsg.id, runId, ev, seq),
      onError: (err) => onStreamError(threadId, assistantMsg.id, runId, err),
      onClose: () => onStreamClose(threadId, runId),
    },
  );
  setActiveStream(handle);
  persistThreads();
}

function onStreamError(
  threadId: string,
  assistantMsgId: string,
  runId: string,
  err: Error,
): void {
  // Don't blow away an already-completed run — the close handler
  // may fire before/after onError depending on where the failure was.
  if (activeRunId !== runId) return;

  // Try to silently resume from where we left off. If the resume also
  // fails, surface the error and stop spinning.
  console.warn("AG-UI POST stream failed; attempting resume", err);
  const handle = resumeRun(state.settings, runId, state.lastEventSeq, {
    onEvent: (ev, seq) => handleEvent(threadId, assistantMsgId, runId, ev, seq),
    onError: (err2) => {
      if (activeRunId !== runId) return;
      setState("isStreaming", false);
      setState("errorBanner", `${UserFacingMessages.connectionLostPrefix}${err2.message}`);
      mutateMessage(threadId, assistantMsgId, (m) => {
        m.streaming = false;
        finalizeActiveThoughtsInMessage(m);
        m.errorMessage = err2.message;
      });
      activeRunId = null;
      activeRunIdByThread.delete(threadId);
      setActiveStream(null);
    },
    onClose: () => onStreamClose(threadId, runId),
  });
  setActiveStream(handle);
}

function onStreamClose(threadId: string, runId: string): void {
  // Server closed the SSE channel. RUN_FINISHED / RUN_ERROR has
  // already cleaned up the per-message streaming flag — this just
  // releases the global spinner if it's still on.
  if (activeRunId !== null && activeRunId !== runId) return;
  if (state.isStreaming) {
    setState("isStreaming", false);
  }
  if (activeRunId === runId) {
    activeRunId = null;
  }
  activeRunIdByThread.delete(threadId);
  setActiveStream(null);
}

function handleEvent(
  threadId: string,
  assistantMsgId: string,
  runId: string,
  ev: AgUiEvent,
  seq: number | undefined,
): void {
  if (activeRunId !== runId) return;
  if (seq !== undefined) {
    setState("lastEventSeq", String(seq));
  }
  switch (ev.type) {
    case "RUN_STARTED":
      activeRunIdByThread.set(threadId, ev.runId);
      return;
    case "TEXT_MESSAGE_START":
      // Server-generated message id is the source of truth for
      // multi-part runs; rebind our placeholder to it.
      mutateMessage(threadId, assistantMsgId, (m) => {
        m.id = ev.messageId;
      });
      return;
    case "TEXT_MESSAGE_CONTENT":
      mutateMessageById(threadId, ev.messageId, (m) => {
        m.content += ev.delta;
      });
      bumpThreadUpdated(threadId);
      return;
    case "TEXT_MESSAGE_END":
      mutateMessageById(threadId, ev.messageId, (m) => {
        m.streaming = false;
      });
      return;
    case "CUSTOM":
      if (!handleKnownCustomEvent(threadId, assistantMsgId, ev.name, ev.value)) {
        mutateMessage(threadId, assistantMsgId, (m) => {
          appendGenericCustomTimeline(m, ev.name, ev.value);
        });
        bumpThreadUpdated(threadId);
        persistThreads();
      }
      return;
    case "RUN_FINISHED":
      setState("isStreaming", false);
      finalizeActiveThoughtsForThread(threadId);
      activeRunId = null;
      activeRunIdByThread.delete(threadId);
      persistThreads();
      return;
    case "RUN_ERROR":
      setState("isStreaming", false);
      mutateMessage(threadId, assistantMsgId, (m) => {
        m.streaming = false;
        finalizeActiveThoughtsInMessage(m);
        m.errorMessage = ev.message;
      });
      setState("errorBanner", ev.message);
      activeRunId = null;
      activeRunIdByThread.delete(threadId);
      persistThreads();
      return;
    case "RUN_LAGGED":
      // Hub couldn't replay from our Last-Event-ID — the requested seq
      // is older than RING_CAP. There's no clean way to recover the
      // missed deltas, so flag it loudly and stop pretending.
      setState("isStreaming", false);
      mutateMessage(threadId, assistantMsgId, (m) => {
        m.streaming = false;
        finalizeActiveThoughtsInMessage(m);
        m.errorMessage = UserFacingMessages.reconnectDroppedEvents;
      });
      setState("errorBanner", UserFacingMessages.lostEventsOnReconnect);
      activeRunId = null;
      activeRunIdByThread.delete(threadId);
      persistThreads();
      return;
  }
}

function handleKnownCustomEvent(
  threadId: string,
  assistantMsgId: string,
  name: string,
  value: unknown,
): boolean {
  if (name === AgUiCustomEventNames.fileArtifact) {
    const artifact = parseFileArtifact(value);
    if (!artifact) return false;
    mutateMessage(threadId, assistantMsgId, (m) => {
      const list = m.fileArtifacts ?? (m.fileArtifacts = []);
      list.push(artifact);
      const timeline = m.timeline ?? (m.timeline = []);
      timeline.push({ kind: "file_artifact", eventId: artifact.eventId });
    });
    bumpThreadUpdated(threadId);
    persistThreads();
    if (
      state.filesDrawer.open &&
      state.filesDrawer.agent !== null &&
      state.filesDrawer.agent === threadAgent(threadId)
    ) {
      void refreshFiles();
    }
    return true;
  }
  if (name === AgUiCustomEventNames.approvalRequest) {
    const approval = parseApprovalRequest(value);
    if (!approval) return false;
    mutateMessage(threadId, assistantMsgId, (m) => {
      const list = m.approvalRequests ?? (m.approvalRequests = []);
      if (!list.some((existing) => existing.requestId === approval.requestId)) {
        list.push(approval);
      }
      const timeline = m.timeline ?? (m.timeline = []);
      if (!timeline.some((item) => item.kind === "approval" && item.requestId === approval.requestId)) {
        timeline.push({ kind: "approval", requestId: approval.requestId });
      }
    });
    bumpThreadUpdated(threadId);
    persistThreads();
    return true;
  }
  if (name === AgUiCustomEventNames.approvalResolved) {
    const resolved = parseApprovalResolved(value);
    if (!resolved) return false;
    markApprovalResolved(threadId, resolved.requestId, resolved.decision);
    bumpThreadUpdated(threadId);
    persistThreads();
    return true;
  }
  if (name === AgUiCustomEventNames.thinkingStatus) {
    const thinking = parseThinkingStatus(value);
    if (!thinking) return false;
    mutateMessage(threadId, assistantMsgId, (m) => {
      applyThinkingStatus(m, thinking);
    });
    bumpThreadUpdated(threadId);
    persistThreads();
    return true;
  }
  if (name === AgUiCustomEventNames.toolCall) {
    const toolCall = parseToolCallStatus(value);
    if (!toolCall) return false;
    mutateMessage(threadId, assistantMsgId, (m) => {
      upsertToolCallTimeline(m, toolCall);
    });
    bumpThreadUpdated(threadId);
    persistThreads();
    return true;
  }
  if (name === AgUiCustomEventNames.a2ui) {
    const messages = parseA2uiMessages(value);
    if (!messages) return false;
    mutateMessage(threadId, assistantMsgId, (m) => {
      const list = m.a2uiMessages ?? (m.a2uiMessages = []);
      list.push(...messages);
    });
    bumpThreadUpdated(threadId);
    persistThreads();
    return true;
  }
  return false;
}

function abortActiveStream(): void {
  const h = activeStream();
  if (h) {
    h.abort();
    setActiveStream(null);
  }
  activeRunId = null;
  activeRunIdByThread.clear();
}

function currentThread(): Thread | undefined {
  if (!state.currentThreadId) return undefined;
  return state.threads.find((t) => t.id === state.currentThreadId);
}

function threadAgent(threadId: string): string | null {
  return state.threads.find((t) => t.id === threadId)?.agent ?? null;
}

function appendMessages(threadId: string, msgs: Message[]): void {
  setState(
    "threads",
    (t) => t.id === threadId,
    produce((t: Thread) => {
      t.messages.push(...msgs);
      t.updatedAtMs = Date.now();
    }),
  );
}

function retitleFromUser(threadId: string, content: string): void {
  // First user message becomes the thread title (truncated). Cheap
  // approximation of ChatGPT's "Untitled chat → first prompt" behavior.
  const title = content.length > 48 ? `${content.slice(0, 48).trim()}…` : content;
  setState(
    "threads",
    (t) => t.id === threadId,
    "title",
    title,
  );
}

function mutateMessage(
  threadId: string,
  messageId: string,
  fn: (m: Message) => void,
): void {
  setState(
    "threads",
    (t) => t.id === threadId,
    produce((t: Thread) => {
      const m = t.messages.find((m) => m.id === messageId);
      if (m) fn(m);
    }),
  );
}

function mutateMessageById(
  threadId: string,
  messageId: string,
  fn: (m: Message) => void,
): void {
  // Same as mutateMessage but doesn't assume the local placeholder id —
  // used after TEXT_MESSAGE_START rebinds to the server's message id.
  mutateMessage(threadId, messageId, fn);
}

function bumpThreadUpdated(threadId: string): void {
  setState(
    "threads",
    (t) => t.id === threadId,
    "updatedAtMs",
    Date.now(),
  );
}

function finalizeActiveThoughtsForThread(threadId: string): void {
  setState(
    "threads",
    (t) => t.id === threadId,
    produce((t: Thread) => {
      for (const message of t.messages) {
        finalizeActiveThoughtsInMessage(message);
      }
    }),
  );
}

function applyThinkingStatus(message: Message, event: ThinkingStatusEvent): void {
  const timeline = message.timeline ?? (message.timeline = []);
  const existing = timeline.find(
    (item): item is RuntimeThoughtCard =>
      item.kind === "thought" && item.thoughtId === event.thoughtId,
  );

  if (!existing) {
    timeline.push({
      kind: "thought",
      thoughtId: event.thoughtId,
      status: event.status === "thinking" ? "active" : "done",
      durationMs: event.elapsedMs,
      detail: event.detail,
    });
    return;
  }
  existing.status = event.status === "thinking" ? "active" : "done";
  existing.durationMs = event.elapsedMs;
  existing.detail = event.detail;
}

function finalizeActiveThoughtsInMessage(message: Message): void {
  const timeline = message.timeline;
  if (!timeline || timeline.length === 0) return;
  for (const item of timeline) {
    if (item.kind === "thought" && item.status === "active") {
      item.status = "done";
    }
  }
}

function upsertToolCallTimeline(message: Message, incoming: ToolCallCard): void {
  const timeline = message.timeline ?? (message.timeline = []);
  const existing = timeline.find(
    (item): item is ToolCallCard =>
      item.kind === "tool_call" && item.toolCallId === incoming.toolCallId,
  );
  if (!existing) {
    timeline.push(incoming);
    return;
  }

  existing.toolName = incoming.toolName;
  existing.status = incoming.status;
  existing.elapsedMs = incoming.elapsedMs;
  existing.arguments = incoming.arguments;
  existing.result = incoming.result;
  existing.error = incoming.error;
  existing.resultPreview = incoming.resultPreview;
}

function appendGenericCustomTimeline(message: Message, name: string, value: unknown): void {
  const timeline = message.timeline ?? (message.timeline = []);
  const item: GenericCustomTimelineItem = {
    kind: "custom_event",
    name,
    preview: summarizeCustomPayload(value),
  };
  timeline.push(item);
}

function summarizeCustomPayload(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") {
    const trimmed = value.trim();
    return truncateForTimeline(trimmed.length > 0 ? trimmed : "(empty)");
  }
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized === "string") {
      return truncateForTimeline(serialized);
    }
    return truncateForTimeline(String(value));
  } catch {
    return truncateForTimeline(String(value));
  }
}

function truncateForTimeline(input: string, maxLen = 280): string {
  if (input.length <= maxLen) return input;
  return `${input.slice(0, maxLen)}…`;
}

function markApprovalResolved(
  threadId: string,
  requestId: string,
  decision: ApprovalDecision,
): void {
  setState(
    "threads",
    (t) => t.id === threadId,
    produce((t: Thread) => {
      for (const message of t.messages) {
        if (!message.approvalRequests) continue;
        for (const approval of message.approvalRequests) {
          if (approval.requestId === requestId) {
            approval.resolvedDecision = decision;
          }
        }
      }
    }),
  );
}

function markFileDeleted(agent: string, path: string): void {
  setState(
    produce((s: AppState) => {
      for (const thread of s.threads) {
        if (thread.agent !== agent) continue;
        for (const message of thread.messages) {
          if (!message.fileArtifacts) continue;
          for (const artifact of message.fileArtifacts) {
            if (artifact.path === path) {
              artifact.deleted = true;
            }
          }
        }
      }
    }),
  );
}

function persistThreads(): void {
  saveThreadsBundle({
    threads: state.threads,
    currentThreadId: state.currentThreadId,
  });
}

// Persist on unload so a crash mid-stream still snapshots whatever
// we got. Modern browsers fire `pagehide` more reliably than
// `beforeunload`; both are fine in webview context.
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => persistThreads());
}
