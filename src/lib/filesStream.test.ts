import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openFilesStream } from "./filesStream";
import type { FileEntry } from "./api";
import type { Settings } from "./storage";

const settings: Settings = {
  gatewayUrl: "http://127.0.0.1:8080",
  bearerToken: "token",
  defaultAgent: "default",
};

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Build a Response whose body emits the given SSE text chunks. */
function sseResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  let i = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i]!));
        i += 1;
      } else {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    status,
    headers: { "content-type": "text/event-stream" },
  });
}

const fileA: FileEntry = {
  path: "a.py",
  name: "a.py",
  sizeBytes: 12,
  mtimeMs: 1000,
  isDir: false,
};
const fileB: FileEntry = {
  path: "b.md",
  name: "b.md",
  sizeBytes: 30,
  mtimeMs: 2000,
  isDir: false,
};

describe("openFilesStream", () => {
  it("delivers snapshot then upsert then removed in order", async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        `data: ${JSON.stringify({ kind: "snapshot", files: [fileA] })}\n\n`,
        `data: ${JSON.stringify({ kind: "upsert", file: fileB })}\n\n`,
        `data: ${JSON.stringify({ kind: "removed", path: "a.py" })}\n\n`,
      ]),
    );

    const events: string[] = [];
    const onClose = vi.fn();
    openFilesStream(settings, "default", {
      onSnapshot: (files) => events.push(`snapshot:${files.map((f) => f.path).join(",")}`),
      onUpsert: (file) => events.push(`upsert:${file.path}`),
      onRemoved: (path) => events.push(`removed:${path}`),
      onUnsupported: () => {
        throw new Error("should not be unsupported");
      },
      onError: (err) => {
        throw err;
      },
      onClose,
    });

    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(events).toEqual(["snapshot:a.py", "upsert:b.md", "removed:a.py"]);
  });

  it("calls onUnsupported on 404 (old gateway)", async () => {
    fetchMock.mockResolvedValueOnce(new Response("not found", { status: 404 }));

    const onUnsupported = vi.fn();
    openFilesStream(settings, "default", {
      onSnapshot: () => {},
      onUpsert: () => {},
      onRemoved: () => {},
      onUnsupported,
      onError: (err) => {
        throw err;
      },
      onClose: () => {},
    });

    await vi.waitFor(() => expect(onUnsupported).toHaveBeenCalledWith(404));
  });

  it("calls onUnsupported on 503 (watcher unavailable)", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));

    const onUnsupported = vi.fn();
    openFilesStream(settings, "default", {
      onSnapshot: () => {},
      onUpsert: () => {},
      onRemoved: () => {},
      onUnsupported,
      onError: () => {},
      onClose: () => {},
    });

    await vi.waitFor(() => expect(onUnsupported).toHaveBeenCalledWith(503));
  });

  it("calls onError when fetch rejects (network down)", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const onError = vi.fn();
    openFilesStream(settings, "default", {
      onSnapshot: () => {},
      onUpsert: () => {},
      onRemoved: () => {},
      onUnsupported: () => {},
      onError,
      onClose: () => {},
    });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(TypeError);
  });

  it("close() suppresses further callbacks", async () => {
    // Build a body that hangs after the first frame so we can close()
    // before the second arrives.
    const encoder = new TextEncoder();
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (pulls === 0) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ kind: "snapshot", files: [fileA] })}\n\n`,
            ),
          );
          pulls += 1;
        } else {
          // Block indefinitely; the AbortController will cut us off.
          await new Promise(() => {});
        }
      },
    });
    fetchMock.mockResolvedValueOnce(
      new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );

    const onUpsert = vi.fn();
    const onClose = vi.fn();
    const handle = openFilesStream(settings, "default", {
      onSnapshot: () => {},
      onUpsert,
      onRemoved: () => {},
      onUnsupported: () => {},
      onError: () => {},
      onClose,
    });

    // Give the snapshot a tick to arrive.
    await new Promise((r) => setTimeout(r, 10));
    handle.close();
    // Wait long enough that any spurious callbacks would have fired.
    await new Promise((r) => setTimeout(r, 50));
    expect(onUpsert).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ignores malformed frames without breaking the stream", async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        `data: not-json\n\n`,
        `data: ${JSON.stringify({ kind: "snapshot", files: [fileA] })}\n\n`,
        `data: ${JSON.stringify({ kind: "upsert" /* missing file */ })}\n\n`,
        `data: ${JSON.stringify({ kind: "removed", path: "a.py" })}\n\n`,
      ]),
    );

    const events: string[] = [];
    const onClose = vi.fn();
    openFilesStream(settings, "default", {
      onSnapshot: (files) => events.push(`snapshot:${files.length}`),
      onUpsert: () => events.push("upsert"),
      onRemoved: (p) => events.push(`removed:${p}`),
      onUnsupported: () => {},
      onError: (err) => {
        throw err;
      },
      onClose,
    });

    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(events).toEqual(["snapshot:1", "removed:a.py"]);
  });
});
