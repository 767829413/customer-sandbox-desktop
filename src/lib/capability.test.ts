import { describe, expect, it } from "vitest";
import { isUnsupportedEndpointError, UserFacingMessages } from "./capability";

describe("capability", () => {
  it("detects unsupported endpoint status codes", () => {
    expect(isUnsupportedEndpointError(new Error("server returned HTTP 404"))).toBe(true);
    expect(isUnsupportedEndpointError(new Error("server returned HTTP 405"))).toBe(true);
    expect(isUnsupportedEndpointError(new Error("server returned HTTP 501"))).toBe(true);
  });

  it("does not mark other errors as unsupported endpoint", () => {
    expect(isUnsupportedEndpointError(new Error("server returned HTTP 500"))).toBe(false);
    expect(isUnsupportedEndpointError(new Error("network timeout"))).toBe(false);
  });

  it("keeps user-facing messages non-empty", () => {
    expect(UserFacingMessages.filesUnsupported.length).toBeGreaterThan(0);
    expect(UserFacingMessages.approvalUnsupported.length).toBeGreaterThan(0);
    expect(UserFacingMessages.lostEventsOnReconnect.length).toBeGreaterThan(0);
  });
});
