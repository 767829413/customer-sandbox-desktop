// Files drawer real-time stream client.
//
// Subscribes to `GET /v1/files/events?agent=X` over fetch+SSE and
// dispatches snapshot / upsert / removed events to the caller. The
// browser EventSource API can't carry our Authorization header, so we
// drive the SSE parser ourselves over a fetch ReadableStream — same
// approach used by the AG-UI run stream.
//
// Caller is responsible for:
// - keeping at most one handle per (agent) alive (close before switching)
// - degrading to `listFiles` polling on `onUnsupported`
// - reconnecting on `onError` if desired (the helper doesn't loop)

import { parseSse } from "./sse";
import type { FileEntry } from "./api";
import type { Settings } from "./storage";

export type FilesStreamFrame =
  | { kind: "snapshot"; files: FileEntry[] }
  | { kind: "upsert"; file: FileEntry }
  | { kind: "removed"; path: string };

export interface FilesStreamCallbacks {
  /** Authoritative full file list — replace local state. */
  onSnapshot: (files: FileEntry[]) => void;
  /** Single file added or changed (size / mtime / mime maybe new). */
  onUpsert: (file: FileEntry) => void;
  /** Single file removed (path is the rel path inside workspace). */
  onRemoved: (path: string) => void;
  /**
   * Server returned a 4xx/5xx status before the body opened. Most
   * commonly 404 (old gateway, no `/v1/files/events`) → caller should
   * stop trying SSE and fall back to one-shot list polling.
   */
  onUnsupported: (status: number) => void;
  /** Network failure / mid-stream read error. Caller may retry. */
  onError: (err: Error) => void;
  /** Server closed the stream cleanly (no error). Caller may reconnect. */
  onClose: () => void;
}

export interface FilesStreamHandle {
  /** Idempotent: aborts the fetch and silences any further callbacks. */
  close: () => void;
}

export function openFilesStream(
  settings: Settings,
  agent: string,
  cb: FilesStreamCallbacks,
): FilesStreamHandle {
  const controller = new AbortController();
  let closed = false;

  const url =
    `${trimSlash(settings.gatewayUrl)}/v1/files/events` +
    `?agent=${encodeURIComponent(agent)}`;

  const headers: Record<string, string> = { Accept: "text/event-stream" };
  if (settings.bearerToken) {
    headers["Authorization"] = `Bearer ${settings.bearerToken}`;
  }

  void (async () => {
    let resp: Response;
    try {
      resp = await fetch(url, {
        method: "GET",
        headers,
        signal: controller.signal,
      });
    } catch (err) {
      if (closed) return;
      // AbortError happens during normal close(); not surfaced.
      if (isAbortError(err)) return;
      cb.onError(toError(err));
      return;
    }
    if (closed) return;
    if (!resp.ok) {
      cb.onUnsupported(resp.status);
      return;
    }
    if (!resp.body) {
      cb.onError(new Error("empty response body"));
      return;
    }
    try {
      for await (const frame of parseSse(resp.body)) {
        if (closed) return;
        const parsed = parseFrame(frame.data);
        if (!parsed) continue;
        switch (parsed.kind) {
          case "snapshot":
            cb.onSnapshot(parsed.files);
            break;
          case "upsert":
            cb.onUpsert(parsed.file);
            break;
          case "removed":
            cb.onRemoved(parsed.path);
            break;
        }
      }
      if (!closed) cb.onClose();
    } catch (err) {
      if (closed) return;
      if (isAbortError(err)) return;
      cb.onError(toError(err));
    }
  })();

  return {
    close: () => {
      if (closed) return;
      closed = true;
      controller.abort();
    },
  };
}

function parseFrame(data: string): FilesStreamFrame | null {
  if (!data) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof obj !== "object" || obj === null) return null;
  const o = obj as { kind?: unknown; files?: unknown; file?: unknown; path?: unknown };
  if (o.kind === "snapshot" && Array.isArray(o.files)) {
    const files = (o.files as unknown[]).filter(isFileEntry);
    return { kind: "snapshot", files };
  }
  if (o.kind === "upsert" && isFileEntry(o.file)) {
    return { kind: "upsert", file: o.file };
  }
  if (o.kind === "removed" && typeof o.path === "string" && o.path.length > 0) {
    return { kind: "removed", path: o.path };
  }
  return null;
}

function isFileEntry(x: unknown): x is FileEntry {
  if (typeof x !== "object" || x === null) return false;
  const e = x as Record<string, unknown>;
  return (
    typeof e.path === "string" &&
    typeof e.name === "string" &&
    typeof e.sizeBytes === "number" &&
    typeof e.mtimeMs === "number" &&
    typeof e.isDir === "boolean"
  );
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

function trimSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}
