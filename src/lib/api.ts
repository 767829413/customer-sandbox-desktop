import { parseSse, type SseFrame } from "./sse";
import type { Settings } from "./storage";

// AG-UI event payload shape. The server doesn't tag events at the SSE
// `event:` field — type info lives inside the JSON payload's `type`
// key. We only model the subset the client cares about.
export type AgUiEvent =
  | { type: "RUN_STARTED"; threadId: string; runId: string }
  | { type: "TEXT_MESSAGE_START"; messageId: string; role: "assistant" }
  | { type: "TEXT_MESSAGE_CONTENT"; messageId: string; delta: string }
  | { type: "TEXT_MESSAGE_END"; messageId: string }
  | { type: "CUSTOM"; name: string; value: unknown }
  | { type: "RUN_FINISHED"; threadId: string; runId: string }
  | { type: "RUN_ERROR"; threadId: string; runId: string; message: string }
  // Synthetic frame inserted by the hub when the client's Last-Event-ID
  // points before the start of the retained ring. Carries no event id;
  // the client should restart the run instead of resuming.
  | { type: "RUN_LAGGED" };

export interface FileEntry {
  path: string;
  name: string;
  sizeBytes: number;
  mtimeMs: number;
  mime?: string;
  isDir: boolean;
}

export interface RunRequestBody {
  threadId: string;
  runId: string;
  agent?: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface StreamCallbacks {
  /** Called for every parsed AG-UI event in arrival order. */
  onEvent: (ev: AgUiEvent, seq?: number) => void;
  /** Network or HTTP error before the run is considered terminal. */
  onError: (err: Error) => void;
  /** Stream ended cleanly (server closed after RUN_FINISHED/ERROR). */
  onClose: () => void;
}

export interface StreamHandle {
  /** Abort the underlying fetch. The producer keeps running on the gateway. */
  abort: () => void;
}

export type ApprovalDecision = "approve" | "deny" | "approve_all" | "deny_all";

function authHeaders(settings: Settings): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "text/event-stream",
  };
  if (settings.bearerToken) {
    headers["Authorization"] = `Bearer ${settings.bearerToken}`;
  }
  return headers;
}

function authRequestHeaders(settings: Settings, accept: string): HeadersInit {
  const headers: Record<string, string> = {
    Accept: accept,
  };
  if (settings.bearerToken) {
    headers["Authorization"] = `Bearer ${settings.bearerToken}`;
  }
  return headers;
}

/**
 * Start a new run by POSTing to /v1/runs and consuming the SSE response.
 *
 * The gateway architecture (B5) decouples producer from consumer: the
 * actual run executes in a detached task on the server, and POST is just
 * a subscriber. So losing this fetch (e.g. ssh tunnel hiccup) doesn't
 * truncate the run — call `resumeRun` with the same runId + last seq to
 * reconnect.
 */
export function postRun(
  settings: Settings,
  body: RunRequestBody,
  cb: StreamCallbacks,
): StreamHandle {
  const ctrl = new AbortController();
  void runFetch(
    `${trimSlash(settings.gatewayUrl)}/v1/runs`,
    {
      method: "POST",
      headers: { ...authHeaders(settings), "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    },
    cb,
  );
  return { abort: () => ctrl.abort() };
}

/**
 * Reconnect to an in-flight or recently-finished run via
 * `GET /v1/runs/{runId}/stream`. The hub will replay any frames newer
 * than `lastEventId` before tailing live events.
 *
 * Pass `lastEventId = undefined` to get a full replay (useful when the
 * client UI lost its in-memory state and wants to rebuild from scratch).
 */
export function resumeRun(
  settings: Settings,
  runId: string,
  lastEventId: string | undefined,
  cb: StreamCallbacks,
): StreamHandle {
  const ctrl = new AbortController();
  const headers: Record<string, string> = { ...(authHeaders(settings) as Record<string, string>) };
  if (lastEventId !== undefined) {
    headers["Last-Event-ID"] = lastEventId;
  }
  void runFetch(
    `${trimSlash(settings.gatewayUrl)}/v1/runs/${encodeURIComponent(runId)}/stream`,
    {
      method: "GET",
      headers,
      signal: ctrl.signal,
    },
    cb,
  );
  return { abort: () => ctrl.abort() };
}

async function runFetch(
  url: string,
  init: RequestInit,
  cb: StreamCallbacks,
): Promise<void> {
  let resp: Response;
  try {
    resp = await fetch(url, init);
  } catch (err) {
    if ((err as DOMException)?.name === "AbortError") {
      cb.onClose();
      return;
    }
    cb.onError(err instanceof Error ? err : new Error(String(err)));
    return;
  }

  if (!resp.ok) {
    cb.onError(new Error(`gateway returned HTTP ${resp.status}`));
    return;
  }
  if (!resp.body) {
    cb.onError(new Error("gateway response has no body"));
    return;
  }

  try {
    for await (const frame of parseSse(resp.body)) {
      const ev = decodeFrame(frame);
      if (!ev) continue;
      const seq = frame.id !== undefined ? Number(frame.id) : undefined;
      cb.onEvent(ev, Number.isFinite(seq) ? seq : undefined);
    }
    cb.onClose();
  } catch (err) {
    if ((err as DOMException)?.name === "AbortError") {
      cb.onClose();
      return;
    }
    cb.onError(err instanceof Error ? err : new Error(String(err)));
  }
}

function decodeFrame(frame: SseFrame): AgUiEvent | null {
  // Defensive: the gateway always emits JSON in the data field, but a
  // future stray comment / keep-alive shouldn't crash the parser.
  if (!frame.data) return null;
  try {
    const obj = JSON.parse(frame.data) as AgUiEvent;
    if (typeof (obj as { type?: unknown }).type !== "string") return null;
    return obj;
  } catch {
    return null;
  }
}

function trimSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

function fileApiUrl(settings: Settings, endpoint: string, agent: string, path?: string): string {
  const url = new URL(`${trimSlash(settings.gatewayUrl)}${endpoint}`);
  url.searchParams.set("agent", agent);
  if (path !== undefined) {
    url.searchParams.set("path", path);
  }
  return url.toString();
}

async function responseError(resp: Response): Promise<Error> {
  const fallback = `gateway returned HTTP ${resp.status}`;
  const contentType = resp.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const body = (await resp.json()) as { error?: unknown };
      if (typeof body.error === "string" && body.error.length > 0) {
        return new Error(body.error);
      }
    } catch {
      return new Error(fallback);
    }
  }
  try {
    const text = (await resp.text()).trim();
    if (text.length > 0) {
      return new Error(text);
    }
  } catch {
    return new Error(fallback);
  }
  return new Error(fallback);
}

export async function listFiles(
  settings: Settings,
  agent: string,
): Promise<{ files: FileEntry[]; truncated: boolean }> {
  const resp = await fetch(fileApiUrl(settings, "/v1/files", agent), {
    method: "GET",
    headers: authRequestHeaders(settings, "application/json"),
  });
  if (!resp.ok) {
    throw await responseError(resp);
  }
  const body = (await resp.json()) as { files?: FileEntry[]; truncated?: boolean };
  return {
    files: Array.isArray(body.files) ? body.files : [],
    truncated: body.truncated === true,
  };
}

export async function postApprovalResponse(
  settings: Settings,
  threadId: string,
  body: {
    runId: string;
    requestId: string;
    decision: ApprovalDecision;
  },
): Promise<void> {
  const resp = await fetch(
    `${trimSlash(settings.gatewayUrl)}/v1/threads/${encodeURIComponent(threadId)}/responses`,
    {
      method: "POST",
      headers: {
        ...authRequestHeaders(settings, "application/json"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  if (!resp.ok) {
    throw await responseError(resp);
  }
}

export async function downloadFile(
  settings: Settings,
  agent: string,
  path: string,
): Promise<Blob> {
  const resp = await fetch(fileApiUrl(settings, "/v1/files/content", agent, path), {
    method: "GET",
    headers: authRequestHeaders(settings, "*/*"),
  });
  if (!resp.ok) {
    throw await responseError(resp);
  }
  return resp.blob();
}

export async function deleteFile(
  settings: Settings,
  agent: string,
  path: string,
): Promise<void> {
  const resp = await fetch(fileApiUrl(settings, "/v1/files", agent, path), {
    method: "DELETE",
    headers: authRequestHeaders(settings, "application/json"),
  });
  if (!resp.ok) {
    throw await responseError(resp);
  }
}
