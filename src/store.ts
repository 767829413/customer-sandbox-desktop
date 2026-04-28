import { batch, createSignal } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { newId } from "./lib/id";
import {
  loadSettings,
  loadThreadsBundle,
  saveSettings,
  saveThreadsBundle,
  type Message,
  type Settings,
  type Thread,
} from "./lib/storage";
import {
  postRun,
  resumeRun,
  type AgUiEvent,
  type StreamHandle,
} from "./lib/api";

// One Solid store for all UI-relevant state. Persistence is fanned out
// to localStorage in `persist*` helpers — we don't observe the whole
// store with createEffect because that re-serializes on every keystroke.

interface AppState {
  settings: Settings;
  threads: Thread[];
  currentThreadId: string | null;
  isStreaming: boolean;
  // Most recent event id we received from the hub for the in-flight
  // run. Used to resume via Last-Event-ID after a network blip.
  lastEventSeq: string | undefined;
  // Surfaced to UI as a transient banner; cleared on next user action.
  errorBanner: string | null;
}

const initialBundle = loadThreadsBundle();
const [state, setState] = createStore<AppState>({
  settings: loadSettings(),
  threads: initialBundle.threads,
  currentThreadId: initialBundle.currentThreadId,
  isStreaming: false,
  lastEventSeq: undefined,
  errorBanner: null,
});

// Track the in-flight stream handle so we can abort on user actions
// (sending a new message, switching threads, etc).
const [activeStream, setActiveStream] = createSignal<StreamHandle | null>(null);
let activeRunId: string | null = null;

export const store = state;

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
}

export function clearErrorBanner(): void {
  setState("errorBanner", null);
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
      onClose: () => onStreamClose(),
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
      setActiveStream(null);
    },
    onClose: () => onStreamClose(),
  });
  setActiveStream(handle);
}

function onStreamClose(): void {
  // Server closed the SSE channel. RUN_FINISHED / RUN_ERROR has
  // already cleaned up the per-message streaming flag — this just
  // releases the global spinner if it's still on.
  if (state.isStreaming) {
    setState("isStreaming", false);
  }
  activeRunId = null;
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
      // No-op: we already spawned the assistant placeholder up front.
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
    case "RUN_FINISHED":
      setState("isStreaming", false);
      activeRunId = null;
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
}

function currentThread(): Thread | undefined {
  if (!state.currentThreadId) return undefined;
  return state.threads.find((t) => t.id === state.currentThreadId);
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
