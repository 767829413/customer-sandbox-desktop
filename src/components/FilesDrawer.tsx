import { For, Show, createSignal } from "solid-js";
import { confirmAction, saveBlobToDisk } from "../lib/native-download";
import {
  closeFilesDrawer,
  downloadWorkspaceFile,
  deleteWorkspaceFile,
  openFileEditor,
  refreshFiles,
  store,
} from "../store";
import { classifyForEditor } from "../lib/fileEditor";

const LARGE_FILE_BYTES = 50 * 1024 * 1024;

export default function FilesDrawer() {
  const [busyPath, setBusyPath] = createSignal<string | null>(null);
  const [localError, setLocalError] = createSignal<string | null>(null);

  const onRefresh = () => {
    setLocalError(null);
    void refreshFiles();
  };

  const onDownload = async (path: string, name: string, sizeBytes: number) => {
    if (!store.filesDrawer.agent || busyPath() !== null) return;
    if (
      sizeBytes > LARGE_FILE_BYTES &&
      !(await confirmAction(
        `File is ${formatBytes(sizeBytes)}. Continue download?`,
        "Large file",
      ))
    ) {
      return;
    }
    setBusyPath(path);
    setLocalError(null);
    try {
      const blob = await downloadWorkspaceFile(store.filesDrawer.agent, path);
      await saveBlobToDisk(blob, name);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyPath(null);
    }
  };

  const onDelete = async (path: string, name: string) => {
    if (!store.filesDrawer.agent || busyPath() !== null) return;
    if (
      !(await confirmAction(
        `Delete "${name}"?\nThis workspace is shared across all chats with agent ${store.filesDrawer.agent}.`,
        "Delete file",
      ))
    ) {
      return;
    }
    setBusyPath(path);
    setLocalError(null);
    console.debug("[FilesDrawer.onDelete] requesting delete", { path, name });
    try {
      await deleteWorkspaceFile(store.filesDrawer.agent, path);
      console.debug("[FilesDrawer.onDelete] success", { path });
      // Note: deleteWorkspaceFile already removes the entry from the
      // store, so no explicit refresh is needed here. A stray refresh
      // would only race with the optimistic filter.
    } catch (err) {
      console.warn("[FilesDrawer.onDelete] failed", { path, err });
      setLocalError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyPath(null);
    }
  };

  return (
    <Show when={store.filesDrawer.open}>
      <aside class="flex h-full w-96 shrink-0 flex-col border-l border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
        <div class="border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <div class="flex items-center justify-between">
            <div>
              <div class="text-sm font-semibold">Workspace files</div>
              <div class="text-xs text-neutral-500 dark:text-neutral-400">
                Agent: {store.filesDrawer.agent}
              </div>
            </div>
            <button
              class="rounded px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-200 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
              onClick={() => closeFilesDrawer()}
            >
              ✕
            </button>
          </div>
          <div class="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
            Shared across all chats with this agent
          </div>
        </div>

        <div class="flex items-center gap-2 border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
          <button
            class="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
            onClick={onRefresh}
            disabled={store.filesDrawer.loadingState === "loading"}
          >
            {store.filesDrawer.loadingState === "loading" ? "Refreshing…" : "Refresh"}
          </button>
          <span class="text-xs text-neutral-500 dark:text-neutral-400">
            {store.filesDrawer.entries.length} item(s)
            <Show when={store.filesDrawer.truncated}> · truncated</Show>
          </span>
          <span
            class="ml-auto flex items-center gap-1 text-[11px]"
            title={streamStateTooltip(store.filesDrawer.streamState)}
          >
            <span
              class="inline-block h-2 w-2 rounded-full"
              classList={{
                "bg-emerald-500": store.filesDrawer.streamState === "live",
                "bg-amber-500 animate-pulse":
                  store.filesDrawer.streamState === "connecting",
                "bg-neutral-400": store.filesDrawer.streamState === "polling",
                "bg-neutral-300 dark:bg-neutral-600":
                  store.filesDrawer.streamState === "off",
              }}
            />
            <span class="text-neutral-500 dark:text-neutral-400">
              {streamStateLabel(store.filesDrawer.streamState)}
            </span>
          </span>
        </div>

        <div class="flex-1 overflow-y-auto px-3 py-2">
          <Show when={store.filesDrawer.errorMessage}>
            {(msg) => (
              <div class="mb-2 rounded bg-red-100 px-2 py-1 text-xs text-red-700 dark:bg-red-900/40 dark:text-red-200">
                {msg()}
              </div>
            )}
          </Show>
          <Show when={localError()}>
            {(msg) => (
              <div class="mb-2 rounded bg-red-100 px-2 py-1 text-xs text-red-700 dark:bg-red-900/40 dark:text-red-200">
                {msg()}
              </div>
            )}
          </Show>
          <Show
            when={store.filesDrawer.entries.length > 0}
            fallback={
              <div class="px-2 py-8 text-center text-xs text-neutral-400">No files yet.</div>
            }
          >
            <div class="flex flex-col gap-1">
              <For each={store.filesDrawer.entries}>
                {(entry) => {
                  const verdict = classifyForEditor(entry);
                  const editTitle =
                    verdict.editable
                      ? "Edit"
                      : verdict.reason === "directory"
                        ? "Cannot edit a directory"
                        : verdict.reason === "too-large"
                          ? "File is too large to edit (5 MB limit)"
                          : "Binary file — download instead";
                  const onOpen = () => {
                    if (!verdict.editable || !store.filesDrawer.agent) return;
                    void openFileEditor(store.filesDrawer.agent, entry.path);
                  };
                  return (
                    <div
                      class="rounded border border-neutral-200 px-2 py-2 text-xs dark:border-neutral-800"
                      classList={{
                        "cursor-pointer hover:border-blue-300 dark:hover:border-blue-600":
                          verdict.editable,
                      }}
                      onDblClick={onOpen}
                      title={verdict.editable ? "Double-click to edit" : undefined}
                    >
                      <div class="flex items-start gap-2">
                        <span class="pt-0.5">{entry.isDir ? "📁" : "📄"}</span>
                        <div class="min-w-0 flex-1">
                          <div class="truncate font-medium">{entry.name}</div>
                          <div class="truncate text-neutral-500 dark:text-neutral-400">
                            {entry.path}
                          </div>
                          <div class="text-neutral-500 dark:text-neutral-400">
                            {entry.isDir ? "directory" : formatBytes(entry.sizeBytes)} ·{" "}
                            {formatTime(entry.mtimeMs)}
                          </div>
                        </div>
                        <div class="flex shrink-0 items-center gap-1">
                          <button
                            class="rounded px-1.5 py-0.5 text-neutral-500 hover:bg-blue-100 hover:text-blue-700 disabled:opacity-40 dark:hover:bg-blue-900/60 dark:hover:text-blue-200"
                            disabled={!verdict.editable || busyPath() !== null}
                            onClick={onOpen}
                            title={editTitle}
                          >
                            ✎
                          </button>
                          <button
                            class="rounded px-1.5 py-0.5 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-800 disabled:opacity-40 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
                            disabled={entry.isDir || busyPath() !== null}
                            onClick={() => void onDownload(entry.path, entry.name, entry.sizeBytes)}
                            title="Download"
                          >
                            ⬇
                          </button>
                          <button
                            class="rounded px-1.5 py-0.5 text-neutral-500 hover:bg-red-100 hover:text-red-700 disabled:opacity-40 dark:hover:bg-red-900/60 dark:hover:text-red-200"
                            disabled={entry.isDir || busyPath() !== null}
                            onClick={() => void onDelete(entry.path, entry.name)}
                            title="Delete"
                          >
                            🗑
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                }}
              </For>
            </div>
          </Show>
        </div>
      </aside>
    </Show>
  );
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const kb = value / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

function formatTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "unknown time";
  return new Date(ms).toLocaleString();
}

function streamStateLabel(s: "off" | "connecting" | "live" | "polling"): string {
  switch (s) {
    case "live":
      return "live";
    case "connecting":
      return "connecting…";
    case "polling":
      return "polling";
    case "off":
      return "off";
  }
}

function streamStateTooltip(s: "off" | "connecting" | "live" | "polling"): string {
  switch (s) {
    case "live":
      return "Real-time updates active — file list reflects sandbox changes within a moment.";
    case "connecting":
      return "Opening real-time stream…";
    case "polling":
      return "Real-time stream unavailable — click Refresh to update.";
    case "off":
      return "Drawer is idle.";
  }
}
