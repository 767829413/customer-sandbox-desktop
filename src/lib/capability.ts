export type CapabilityStatus = "unknown" | "supported" | "unsupported";

export const UserFacingMessages = {
  filesUnsupported: "当前服务端未实现文件扩展能力。",
  filesAutoHidden: "当前服务端未实现文件扩展能力，Files 已自动隐藏。",
  filesDisabled: "当前服务端未实现文件扩展能力，已禁用 Files。",
  approvalUnsupported: "当前服务端未实现审批回填接口，无法在卡片中直接审批。",
  connectionLostPrefix: "连接中断：",
  reconnectDroppedEvents: "重连时丢失了事件，请重新发送。",
  lostEventsOnReconnect: "重连丢失事件，当前消息不完整。",
} as const;

export function isUnsupportedEndpointError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /HTTP\s+(404|405|501)\b/i.test(msg);
}
