import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FileArtifact } from "../../lib/storage";
import { downloadFile } from "../../lib/api";
import { deleteWorkspaceFile } from "../../store";
import FileArtifactChip from "./FileArtifactChip";

vi.mock("../../lib/api", () => ({
  downloadFile: vi.fn(),
}));

vi.mock("../../store", () => ({
  store: {
    settings: {
      gatewayBaseUrl: "http://localhost:8080",
      token: "test-token",
    },
  },
  deleteWorkspaceFile: vi.fn(),
}));

const downloadMock = vi.mocked(downloadFile);
const deleteMock = vi.mocked(deleteWorkspaceFile);

function makeArtifact(overrides: Partial<FileArtifact> = {}): FileArtifact {
  return {
    path: "workspace/random_cn.py",
    name: "random_cn.py",
    sizeBytes: 128,
    operation: "created",
    ...overrides,
  };
}

beforeEach(() => {
  downloadMock.mockReset();
  deleteMock.mockReset();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:test-url"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("FileArtifactChip", () => {
  it("click download triggers API and browser save flow", async () => {
    downloadMock.mockResolvedValueOnce(new Blob(["print('ok')\n"], { type: "text/plain" }));
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    render(() => <FileArtifactChip agent="zeptoclaw" artifact={makeArtifact()} />);

    await fireEvent.click(screen.getByTitle("Download"));

    await waitFor(() => {
      expect(downloadMock).toHaveBeenCalledTimes(1);
    });
    expect(downloadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        gatewayBaseUrl: "http://localhost:8080",
        token: "test-token",
      }),
      "zeptoclaw",
      "workspace/random_cn.py",
    );
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it("click delete confirms and calls delete action", async () => {
    deleteMock.mockResolvedValueOnce();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(() => <FileArtifactChip agent="zeptoclaw" artifact={makeArtifact()} />);

    await fireEvent.click(screen.getByTitle("Delete"));

    await waitFor(() => {
      expect(deleteMock).toHaveBeenCalledTimes(1);
    });
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(deleteMock).toHaveBeenCalledWith("zeptoclaw", "workspace/random_cn.py");
    expect(downloadMock).not.toHaveBeenCalled();
  });
});
