// See docs/agui-custom-events.md (must stay aligned with server constants).
export const AgUiCustomEventNames = {
  fileArtifact: "ui:file_artifact",
  approvalRequest: "ui:approval_request",
  approvalResolved: "ui:approval_resolved",
  thinkingStatus: "ui:thinking_status",
  toolCall: "ui:tool_call",
} as const;

export type AgUiCustomEventName =
  (typeof AgUiCustomEventNames)[keyof typeof AgUiCustomEventNames];
