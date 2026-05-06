import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApprovalRequestCard } from "../../lib/storage";
import { respondApproval, store } from "../../store";
import ApprovalCard from "./ApprovalCard";

vi.mock("../../store", () => ({
  respondApproval: vi.fn(),
  store: {
    capabilities: {
      approvalApi: "supported",
    },
  },
}));

const respondMock = vi.mocked(respondApproval);
const mockedStore = store as unknown as {
  capabilities: { approvalApi: "supported" | "unsupported" | "unknown" };
};

function makeApproval(overrides: Partial<ApprovalRequestCard> = {}): ApprovalRequestCard {
  return {
    requestId: "req_1",
    toolName: "shell",
    arguments: { command: "echo ok" },
    pendingTotal: 1,
    ...overrides,
  };
}

beforeEach(() => {
  respondMock.mockReset();
  mockedStore.capabilities.approvalApi = "supported";
});

afterEach(() => {
  cleanup();
});

describe("ApprovalCard", () => {
  it("click approve triggers once and disables repeated clicks", async () => {
    respondMock.mockReturnValueOnce(new Promise<void>(() => undefined));

    render(() => <ApprovalCard threadId="thread_1" approval={makeApproval()} />);

    const approveBtn = screen.getByText("Approve") as HTMLButtonElement;
    await fireEvent.click(approveBtn);
    await fireEvent.click(approveBtn);

    expect(respondMock).toHaveBeenCalledTimes(1);
    expect(respondMock).toHaveBeenCalledWith("thread_1", "req_1", "approve");
    expect(approveBtn.disabled).toBe(true);
  });

  it("unsupported approval API shows message and does not call responder", async () => {
    mockedStore.capabilities.approvalApi = "unsupported";

    render(() => <ApprovalCard threadId="thread_1" approval={makeApproval()} />);
    await fireEvent.click(screen.getByText("Approve"));

    expect(respondMock).not.toHaveBeenCalled();
    expect(
      screen.getAllByText("当前服务端未实现审批回填接口，无法在卡片中直接审批。").length,
    ).toBeGreaterThan(0);
  });

  it.each([
    "server returned HTTP 409",
    "server returned HTTP 404",
    "server returned HTTP 400",
  ])("surfaces request error message: %s", async (message) => {
    respondMock.mockRejectedValueOnce(new Error(message));

    render(() => <ApprovalCard threadId="thread_1" approval={makeApproval()} />);
    await fireEvent.click(screen.getByText("Deny"));

    await waitFor(() => {
      expect(screen.queryByText(message)).not.toBeNull();
    });
  });
});
