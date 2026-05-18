import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FileNotTextError,
  FilePreconditionFailedError,
  FileTooLargeError,
  loadFileContent,
  postApprovalResponse,
  saveFileContent,
} from "./api";
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

describe("postApprovalResponse", () => {
  it("posts approval response successfully", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(
      postApprovalResponse(settings, "thread_1", {
        runId: "run_1",
        requestId: "req_1",
        decision: "approve",
      }),
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toContain("/v1/threads/thread_1/responses");
    expect(init?.method).toBe("POST");
  });

  it("returns JSON error body for HTTP 409", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "request id not found" }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      postApprovalResponse(settings, "thread_1", {
        runId: "run_1",
        requestId: "req_1",
        decision: "approve",
      }),
    ).rejects.toThrow("request id not found");
  });

  it("returns plain text body for HTTP 404", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("no active session", {
        status: 404,
        headers: { "content-type": "text/plain" },
      }),
    );

    await expect(
      postApprovalResponse(settings, "thread_1", {
        runId: "run_1",
        requestId: "req_1",
        decision: "approve",
      }),
    ).rejects.toThrow("no active session");
  });

  it("falls back to HTTP code message for empty HTTP 400", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 400 }));

    await expect(
      postApprovalResponse(settings, "thread_1", {
        runId: "run_1",
        requestId: "req_1",
        decision: "approve",
      }),
    ).rejects.toThrow("server returned HTTP 400");
  });
});

describe("loadFileContent", () => {
  it("decodes UTF-8 text and surfaces ETag / mime", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("print('hi')\n", {
        status: 200,
        headers: {
          "content-type": "text/x-python; charset=utf-8",
          etag: "\"abc123\"",
        },
      }),
    );

    const out = await loadFileContent(settings, "zeptoclaw", "x.py");
    expect(out.text).toBe("print('hi')\n");
    expect(out.etag).toBe("\"abc123\"");
    expect(out.mime).toContain("text/x-python");
    expect(out.sizeBytes).toBe(12);

    const [url] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toContain("/v1/files/content");
    expect(String(url)).toContain("agent=zeptoclaw");
    expect(String(url)).toContain("path=x.py");
  });

  it("rejects binary content with FileNotTextError", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]).buffer, {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      }),
    );
    await expect(loadFileContent(settings, "zeptoclaw", "blob.bin")).rejects.toBeInstanceOf(
      FileNotTextError,
    );
  });

  it("rejects oversized body with FileTooLargeError", async () => {
    const big = new Uint8Array(6 * 1024 * 1024); // 6 MB > 5 MB cap
    fetchMock.mockResolvedValueOnce(new Response(big.buffer, { status: 200 }));
    await expect(loadFileContent(settings, "zeptoclaw", "big.txt")).rejects.toBeInstanceOf(
      FileTooLargeError,
    );
  });
});

describe("saveFileContent", () => {
  it("PUTs body, attaches If-Match when provided, and returns new etag", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, sizeBytes: 11, mtimeMs: 123 }), {
        status: 200,
        headers: { "content-type": "application/json", etag: "\"v2\"" },
      }),
    );

    const out = await saveFileContent(settings, "zeptoclaw", "x.py", "print('hi')", {
      ifMatchEtag: "\"v1\"",
    });
    expect(out.etag).toBe("\"v2\"");
    expect(out.sizeBytes).toBe(11);
    expect(out.mtimeMs).toBe(123);

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init?.method).toBe("PUT");
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.["If-Match"]).toBe("\"v1\"");
    expect(headers?.["Content-Type"]).toBe("text/plain; charset=utf-8");
    expect(init?.body).toBe("print('hi')");
  });

  it("omits If-Match when caller passes null (force overwrite)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, sizeBytes: 3 }), { status: 200 }),
    );
    await saveFileContent(settings, "zeptoclaw", "x.py", "abc", { ifMatchEtag: null });
    const [, init] = fetchMock.mock.calls[0] ?? [];
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers && "If-Match" in headers).toBe(false);
  });

  it("maps 412 to FilePreconditionFailedError", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "etag mismatch" }), {
        status: 412,
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(
      saveFileContent(settings, "zeptoclaw", "x.py", "abc", { ifMatchEtag: "\"stale\"" }),
    ).rejects.toBeInstanceOf(FilePreconditionFailedError);
  });

  it("maps 413 to FileTooLargeError", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 413 }));
    await expect(saveFileContent(settings, "zeptoclaw", "x.py", "abc")).rejects.toBeInstanceOf(
      FileTooLargeError,
    );
  });
});
