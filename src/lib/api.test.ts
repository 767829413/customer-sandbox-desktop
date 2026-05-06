import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postApprovalResponse } from "./api";
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
