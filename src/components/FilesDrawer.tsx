import { For, Show, createSignal } from "solid-js";
import { downloadFile } from "../lib/api";
import {
  closeFilesDrawer,
  deleteWorkspaceFile,
  refreshFiles,
  store,
} from "../store";

const LARGE_FILE_BYTES = 50 * 1024 * 1024;

export default function FilesDrawer() {
  const [busyPath, setBusyPath] = createSignal<string | null>(null);

  const onRefresh = () => void refreshFiles();

  const onDownload = async (path: string, name: string, sizeBytes: number) => {
    if (!store.filesDrawer.agent || busyPath() !== null) return;
    if (
      sizeBytes > LARGE_FILE_BYTES &&
      !confirm(`File is ${formatBytes(sizeBytes)}. Continue download?`)
    ) {
      return;
    }
    setBusyPath(path);
    try {
      const blob = await downloadFile(store.settings, store.filesDrawer.agent, path);
      const url = URL.createObjectURL(blob);
      try {
        const link = document.createElement("a");
        link.href = url;
        link.download = name;
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        link.remove();
      } finally {
        URL.revokeObjectURL(url);
      }
    } finally {
      setBusyPath(null);
    }
  };

  const onDelete = async (path: string, name: string) => {
    if (!store.filesDrawer.agent || busyPath() !== null) return;
    if (
      !confirm(
        `Delete "${name}"?\nThis workspace is shared across all chats with agent ${store.filesDrawer.agent}.`,
      )
    ) {
      return;
    }
    setBusyPath(path);
    try {
      await deleteWorkspaceFile(store.filesDrawer.agent, path);
      await refreshFiles();
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
        </div>

        <div class="flex-1 overflow-y-auto px-3 py-2">
          <Show when={store.filesDrawer.errorMessage}>
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
                {(entry) => (
                  <div class="rounded border border-neutral-200 px-2 py-2 text-xs dark:border-neutral-800">
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
                )}
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
