import { describe, expect, it } from "vitest";
import {
  parseA2uiMessages,
  parseApprovalRequest,
  parseApprovalResolved,
  parseFileArtifact,
  parseThinkingStatus,
  parseToolCallStatus,
} from "./parsers";

describe("parsers", () => {
  it("parses approval request payload", () => {
    const parsed = parseApprovalRequest({
      requestId: "req_1",
      toolName: "write_file",
      arguments: { path: "a.txt" },
      pendingTotal: 2.7,
      shellCommand: "echo ok",
      timeoutSecs: 15.2,
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.requestId).toBe("req_1");
    expect(parsed?.toolName).toBe("write_file");
    expect(parsed?.pendingTotal).toBe(2);
    expect(parsed?.timeoutSecs).toBe(15);
  });

  it("rejects invalid approval resolved payload", () => {
    expect(
      parseApprovalResolved({
        requestId: "req_1",
        decision: "invalid",
      }),
    ).toBeNull();
  });

  it("parses file artifact and auto-fills eventId", () => {
    const parsed = parseFileArtifact({
      path: "报告.md",
      name: "报告.md",
      sizeBytes: 100,
      operation: "created",
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.eventId.startsWith("file_")).toBe(true);
    expect(parsed?.operation).toBe("created");
  });

  it("parses thinking status detail", () => {
    const parsed = parseThinkingStatus({
      thoughtId: "thought_1",
      status: "done",
      elapsedMs: 21.3,
      detail: "Model draft: ...",
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.elapsedMs).toBe(21);
    expect(parsed?.detail).toContain("Model draft");
  });

  it("parses tool call status with arguments and result", () => {
    const parsed = parseToolCallStatus({
      toolCallId: "tool_1",
      toolName: "shell",
      status: "failed",
      elapsedMs: 133,
      arguments: "{\"command\":\"ls\"}",
      result: "permission denied",
      error: "permission denied",
      resultPreview: "permission denied",
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.toolCallId).toBe("tool_1");
    expect(parsed?.status).toBe("failed");
    expect(parsed?.arguments).toContain("command");
  });

  it("parses a2ui single message payload", () => {
    const parsed = parseA2uiMessages({
      version: "v0.9",
      createSurface: {
        surfaceId: "main",
        catalogId: "https://a2ui.org/specification/v0_9/basic_catalog.json",
      },
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.length).toBe(1);
    expect(parsed?.[0].createSurface).toBeTruthy();
  });

  it("parses a2ui wrapper messages payload", () => {
    const parsed = parseA2uiMessages({
      messages: [
        {
          version: "v0.9",
          createSurface: { surfaceId: "main", catalogId: "basic" },
        },
        {
          version: "v0.9",
          updateDataModel: { surfaceId: "main", path: "/", value: { title: "hi" } },
        },
      ],
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.length).toBe(2);
  });
});
