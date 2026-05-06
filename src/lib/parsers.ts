import type { ApprovalDecision } from "./api";
import { newId } from "./id";
import type { ApprovalRequestCard, FileArtifact, ToolCallCard } from "./storage";

export type ThinkingStatusEvent = {
  thoughtId: string;
  status: "thinking" | "done";
  elapsedMs?: number;
  detail?: string;
};

export function parseApprovalRequest(value: unknown): ApprovalRequestCard | null {
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

export function parseApprovalResolved(
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

export function parseFileArtifact(value: unknown): FileArtifact | null {
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
    eventId:
      typeof obj.eventId === "string" && obj.eventId.length > 0
        ? obj.eventId
        : `file_${newId()}`,
    path: obj.path,
    name: obj.name,
    sizeBytes: Math.floor(obj.sizeBytes),
    mime: typeof obj.mime === "string" ? obj.mime : undefined,
    operation: obj.operation,
    deleted: false,
  };
}

export function parseThinkingStatus(value: unknown): ThinkingStatusEvent | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.thoughtId !== "string" || obj.thoughtId.length === 0) return null;
  if (obj.status !== "thinking" && obj.status !== "done") return null;
  if (
    obj.elapsedMs !== undefined &&
    (typeof obj.elapsedMs !== "number" || !Number.isFinite(obj.elapsedMs) || obj.elapsedMs < 0)
  ) {
    return null;
  }
  if (obj.detail !== undefined && typeof obj.detail !== "string") {
    return null;
  }
  return {
    thoughtId: obj.thoughtId,
    status: obj.status,
    elapsedMs: typeof obj.elapsedMs === "number" ? Math.floor(obj.elapsedMs) : undefined,
    detail: typeof obj.detail === "string" ? obj.detail : undefined,
  };
}

export function parseToolCallStatus(value: unknown): ToolCallCard | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.toolCallId !== "string" || obj.toolCallId.length === 0) return null;
  if (typeof obj.toolName !== "string" || obj.toolName.length === 0) return null;
  if (obj.status !== "started" && obj.status !== "done" && obj.status !== "failed") return null;
  if (
    obj.elapsedMs !== undefined &&
    (typeof obj.elapsedMs !== "number" || !Number.isFinite(obj.elapsedMs) || obj.elapsedMs < 0)
  ) {
    return null;
  }
  if (obj.error !== undefined && typeof obj.error !== "string") return null;
  if (obj.arguments !== undefined && typeof obj.arguments !== "string") return null;
  if (obj.result !== undefined && typeof obj.result !== "string") return null;
  if (obj.resultPreview !== undefined && typeof obj.resultPreview !== "string") return null;
  return {
    kind: "tool_call",
    toolCallId: obj.toolCallId,
    toolName: obj.toolName,
    status: obj.status,
    elapsedMs: typeof obj.elapsedMs === "number" ? Math.floor(obj.elapsedMs) : undefined,
    arguments: typeof obj.arguments === "string" ? obj.arguments : undefined,
    result: typeof obj.result === "string" ? obj.result : undefined,
    error: typeof obj.error === "string" ? obj.error : undefined,
    resultPreview: typeof obj.resultPreview === "string" ? obj.resultPreview : undefined,
  };
}
