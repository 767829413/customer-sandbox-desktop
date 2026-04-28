// Persisted application state. Two flat keys keep migration simple:
//   - openshell.settings : Settings object
//   - openshell.threads  : { threads: Thread[], currentThreadId: string|null }
//
// Messages are stored *inside* each thread to keep the IO surface tiny;
// for MVP this fits in localStorage comfortably (a 1k-message thread is
// ~200 KB). When that becomes painful we'll move to a per-thread bucket
// or a SQLite plugin (see plan §4 "key 架构选择").

const SETTINGS_KEY = "openshell.settings";
const THREADS_KEY = "openshell.threads";

export interface Settings {
  gatewayUrl: string;
  bearerToken: string;
  defaultAgent: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAtMs: number;
  // Set on assistant messages while a run is in flight; cleared on
  // RUN_FINISHED / RUN_ERROR. Lets the UI distinguish "still streaming"
  // from "complete" without a separate flag on the thread.
  streaming?: boolean;
  errorMessage?: string;
}

export interface Thread {
  id: string;
  title: string;
  agent: string;
  createdAtMs: number;
  updatedAtMs: number;
  messages: Message[];
}

export interface ThreadsBundle {
  threads: Thread[];
  currentThreadId: string | null;
}

const DEFAULT_SETTINGS: Settings = {
  gatewayUrl: "http://127.0.0.1:7878",
  bearerToken: "",
  defaultAgent: "zeptoclaw",
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      gatewayUrl: parsed.gatewayUrl ?? DEFAULT_SETTINGS.gatewayUrl,
      bearerToken: parsed.bearerToken ?? DEFAULT_SETTINGS.bearerToken,
      defaultAgent: parsed.defaultAgent ?? DEFAULT_SETTINGS.defaultAgent,
    };
  } catch {
    // Corrupt blob — fall back rather than wedge the app on every boot.
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

export function loadThreadsBundle(): ThreadsBundle {
  try {
    const raw = localStorage.getItem(THREADS_KEY);
    if (!raw) return { threads: [], currentThreadId: null };
    const parsed = JSON.parse(raw) as Partial<ThreadsBundle>;
    return {
      threads: Array.isArray(parsed.threads) ? parsed.threads : [],
      currentThreadId: parsed.currentThreadId ?? null,
    };
  } catch {
    return { threads: [], currentThreadId: null };
  }
}

export function saveThreadsBundle(b: ThreadsBundle): void {
  localStorage.setItem(THREADS_KEY, JSON.stringify(b));
}
