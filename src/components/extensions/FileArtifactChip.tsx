import { Show, createSignal } from "solid-js";
import { downloadFile } from "../../lib/api";
import type { FileArtifact } from "../../lib/storage";
import { deleteWorkspaceFile, store } from "../../store";

interface Props {
  agent: string;
  artifact: FileArtifact;
}

const LARGE_FILE_BYTES = 50 * 1024 * 1024;

export default function FileArtifactChip(props: Props) {
  const [busy, setBusy] = createSignal<"idle" | "downloading" | "deleting">("idle");
  const [error, setError] = createSignal<string | null>(null);

  const onDownload = async () => {
    if (props.artifact.deleted || busy() !== "idle") return;
    if (
      props.artifact.sizeBytes > LARGE_FILE_BYTES &&
      !confirm(
        `File is ${formatBytes(props.artifact.sizeBytes)}. Continue download?`,
      )
    ) {
      return;
    }
    setBusy("downloading");
    setError(null);
    try {
      const blob = await downloadFile(store.settings, props.agent, props.artifact.path);
      const url = URL.createObjectURL(blob);
      try {
        const link = document.createElement("a");
        link.href = url;
        link.download = props.artifact.name;
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        link.remove();
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("idle");
    }
  };

  const onDelete = async () => {
    if (props.artifact.deleted || busy() !== "idle") return;
    if (
      !confirm(
        `Delete "${props.artifact.name}"?\nThis workspace is shared across all chats with agent ${props.agent}.`,
      )
    ) {
      return;
    }
    setBusy("deleting");
    setError(null);
    try {
      await deleteWorkspaceFile(props.agent, props.artifact.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("idle");
    }
  };

  return (
    <div class="rounded-lg border border-neutral-200 bg-white/70 px-3 py-2 text-xs dark:border-neutral-700 dark:bg-neutral-900/60">
      <div
        class="flex items-center gap-2"
        classList={{ "opacity-60 line-through": props.artifact.deleted === true }}
      >
        <span>{fileIcon(props.artifact)}</span>
        <div class="min-w-0 flex-1">
          <div class="truncate font-medium">{props.artifact.name}</div>
          <div class="truncate text-neutral-500 dark:text-neutral-400">
            {formatBytes(props.artifact.sizeBytes)} · {props.artifact.operation}
            <Show when={props.artifact.deleted}> · deleted</Show>
          </div>
        </div>
        <button
          class="rounded px-1.5 py-0.5 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-800 disabled:opacity-40 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
          disabled={busy() !== "idle" || props.artifact.deleted === true}
          onClick={() => void onDownload()}
          title="Download"
        >
          ⬇
        </button>
        <button
          class="rounded px-1.5 py-0.5 text-neutral-500 hover:bg-red-100 hover:text-red-700 disabled:opacity-40 dark:hover:bg-red-900/60 dark:hover:text-red-200"
          disabled={busy() !== "idle" || props.artifact.deleted === true}
          onClick={() => void onDelete()}
          title="Delete"
        >
          🗑
        </button>
      </div>
      <Show when={error()}>
        {(msg) => (
          <div class="mt-1 rounded bg-red-100 px-2 py-1 text-[11px] text-red-700 dark:bg-red-900/40 dark:text-red-200">
            {msg()}
          </div>
        )}
      </Show>
    </div>
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

function fileIcon(artifact: FileArtifact): string {
  const path = artifact.path.toLowerCase();
  if (path.endsWith(".py")) return "🐍";
  if (path.endsWith(".md")) return "📝";
  if (path.endsWith(".txt")) return "📄";
  if (artifact.mime?.includes("json")) return "🧩";
  return "📎";
}
