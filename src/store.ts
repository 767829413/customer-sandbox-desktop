import { batch, createSignal } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { newId } from "./lib/id";
import {
  loadSettings,
  loadThreadsBundle,
  saveSettings,
  saveThreadsBundle,
  type ApprovalRequestCard,
  type Message,
  type Settings,
  type Thread,
} from "./lib/storage";
import {
  deleteFile,
  listAgents,
  listFiles,
  postApprovalResponse,
  postRun,
  resumeRun,
  type ApprovalDecision,
  type AgUiEvent,
  type FileEntry,
  type StreamHandle,
} from "./lib/api";
import type { FileArtifact } from "./lib/storage";

// One Solid store for all UI-relevant state. Persistence is fanned out
// to localStorage in `persist*` helpers — we don't observe the whole
// store with createEffect because that re-serializes on every keystroke.

interface AppState {
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
}

const initialSettings = loadSettings();
const initialBundle = loadThreadsBundle();
const [state, setState] = createStore<AppState>({
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
});

// Track the in-flight stream handle so we can abort on user actions
// (sending a new message, switching threads, etc).
const [activeStream, setActiveStream] = createSignal<StreamHandle | null>(null);
let activeRunId: string | null = null;
const activeRunIdByThread = new Map<string, string>();

export const store = state;
void refreshAvailableAgents(initialSettings);

export function setCurrentThread(threadId: string): void {
  setState("currentThreadId", threadId);
  persistThreads();
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
}

export function updateSettings(s: Settings): void {
  setState("settings", s);
  saveSettings(s);
  void refreshAvailableAgents(s);
}

export function clearErrorBanner(): void {
  setState("errorBanner", null);
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
    out.push(fallback.trim() || "zeptoclaw");
  }
  return out;
}

export async function refreshAvailableAgents(settingsOverride?: Settings): Promise<void> {
  const settings = settingsOverride ?? state.settings;
  if (!settings.gatewayUrl.trim() || !settings.bearerToken.trim()) {
    setState("availableAgents", normalizeAgents([], settings.defaultAgent));
    return;
  }
  try {
    const catalog = await listAgents(settings);
    setState("availableAgents", normalizeAgents(catalog.agents, catalog.defaultAgent));
  } catch {
    // Keep UX stable on transient errors; settings dialog surfaces details.
    setState("availableAgents", normalizeAgents([], settings.defaultAgent));
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
    const rawMessage = err instanceof Error ? err.message : String(err);
    const message = rawMessage.includes("HTTP 404")
      ? "Gateway 当前版本不支持文件接口 (/v1/files)，请更新并重启 gateway。"
      : rawMessage;
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
  await deleteFile(state.settings, agent, path);
  markFileDeleted(agent, path);
  setState(
    produce((s: AppState) => {
      if (s.filesDrawer.agent !== agent) return;
      s.filesDrawer.entries = s.filesDrawer.entries.filter((entry) => entry.path !== path);
    }),
  );
  persistThreads();
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
  await postApprovalResponse(state.settings, threadId, {
    runId,
    requestId,
    decision,
  });
}

/**
 * Send a user message in the current thread. Creates the thread if
 * none is active. Returns immediately; UI watches `state.isStreaming`
 * and the assistant message that was appended in the same batch.
 */
export function sendMessage(content: string): void {
  const trimmed = content.trim();
  if (!trimmed) return;
  if (!state.settings.bearerToken) {
    setState("errorBanner", "Bearer token is empty — open Settings to fill it in.");
    return;
  }

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
      agent: thread.agent,
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
      setState("errorBanner", `Connection lost: ${err2.message}`);
      mutateMessage(threadId, assistantMsgId, (m) => {
        m.streaming = false;
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
      if (ev.name === "ui:file_artifact") {
        const artifact = parseFileArtifact(ev.value);
        if (!artifact) return;
        mutateMessage(threadId, assistantMsgId, (m) => {
          const list = m.fileArtifacts ?? (m.fileArtifacts = []);
          list.push(artifact);
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
      } else if (ev.name === "ui:approval_request") {
        const approval = parseApprovalRequest(ev.value);
        if (!approval) return;
        mutateMessage(threadId, assistantMsgId, (m) => {
          const list = m.approvalRequests ?? (m.approvalRequests = []);
          list.push(approval);
        });
        bumpThreadUpdated(threadId);
        persistThreads();
      } else if (ev.name === "ui:approval_resolved") {
        const resolved = parseApprovalResolved(ev.value);
        if (!resolved) return;
        markApprovalResolved(threadId, resolved.requestId, resolved.decision);
        bumpThreadUpdated(threadId);
        persistThreads();
      }
      return;
    case "RUN_FINISHED":
      setState("isStreaming", false);
      activeRunId = null;
      activeRunIdByThread.delete(threadId);
      persistThreads();
      return;
    case "RUN_ERROR":
      setState("isStreaming", false);
      mutateMessage(threadId, assistantMsgId, (m) => {
        m.streaming = false;
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
        m.errorMessage = "Reconnect dropped events. Please resend.";
      });
      setState("errorBanner", "Lost events on reconnect — message is incomplete.");
      activeRunId = null;
      activeRunIdByThread.delete(threadId);
      persistThreads();
      return;
  }
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

function parseApprovalRequest(value: unknown): ApprovalRequestCard | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.requestId !== "string" || obj.requestId.length === 0) return null;
  if (typeof obj.toolName !== "string" || obj.toolName.length === 0) return null;
  if (!obj.arguments || typeof obj.arguments !== "object") return null;
  const pendingTotal =
    typeof obj.pendingTotal === "number" && Number.isFinite(obj.pendingTotal) && obj.pendingTotal > 0
      ? Math.floor(obj.pendingTotal)
      : 1;
  if (obj.shellCommand !== undefined && typeof obj.shellCommand !== "string") return null;
  if (
    obj.timeoutSecs !== undefined &&
    (typeof obj.timeoutSecs !== "number" || !Number.isFinite(obj.timeoutSecs) || obj.timeoutSecs < 0)
  ) {
    return null;
  }
  return {
    requestId: obj.requestId,
    toolName: obj.toolName,
    arguments: obj.arguments as Record<string, unknown>,
    pendingTotal,
    shellCommand: typeof obj.shellCommand === "string" ? obj.shellCommand : undefined,
    timeoutSecs: typeof obj.timeoutSecs === "number" ? Math.floor(obj.timeoutSecs) : undefined,
  };
}

function parseApprovalResolved(
  value: unknown,
): { requestId: string; decision: ApprovalDecision } | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.requestId !== "string" || obj.requestId.length === 0) return null;
  if (
    obj.decision !== "approve" &&
    obj.decision !== "deny" &&
    obj.decision !== "approve_all" &&
    obj.decision !== "deny_all"
  ) {
    return null;
  }
  return { requestId: obj.requestId, decision: obj.decision as ApprovalDecision };
}

function parseFileArtifact(value: unknown): FileArtifact | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.path !== "string" || obj.path.length === 0) return null;
  if (typeof obj.name !== "string" || obj.name.length === 0) return null;
  if (typeof obj.sizeBytes !== "number" || !Number.isFinite(obj.sizeBytes) || obj.sizeBytes < 0) {
    return null;
  }
  if (obj.mime !== undefined && typeof obj.mime !== "string") return null;
  if (obj.operation !== "created" && obj.operation !== "modified") return null;
  return {
    path: obj.path,
    name: obj.name,
    sizeBytes: Math.floor(obj.sizeBytes),
    mime: typeof obj.mime === "string" ? obj.mime : undefined,
    operation: obj.operation,
    deleted: false,
  };
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
