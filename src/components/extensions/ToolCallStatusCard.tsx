import { Show } from "solid-js";
import type { ToolCallCard } from "../../lib/storage";

interface Props {
  card: ToolCallCard;
}

export default function ToolCallStatusCard(props: Props) {
  const statusIcon = () => {
    switch (props.card.status) {
      case "started":
        return "⏳";
      case "done":
        return "✓";
      case "failed":
        return "⚠";
    }
  };

  const statusLabel = () => {
    switch (props.card.status) {
      case "started":
        return "running";
      case "done":
        return "done";
      case "failed":
        return "failed";
    }
  };

  const statusClass = () => {
    switch (props.card.status) {
      case "started":
        return "text-amber-700 dark:text-amber-300";
      case "done":
        return "text-emerald-700 dark:text-emerald-300";
      case "failed":
        return "text-red-700 dark:text-red-300";
    }
  };

  return (
    <div class="py-1 text-[11px]">
      <div class="flex items-center gap-2">
        <span>{statusIcon()}</span>
        <span class="font-mono text-neutral-700 dark:text-neutral-200">{props.card.toolName}</span>
        <span class={statusClass()}>{statusLabel()}</span>
        <Show when={props.card.elapsedMs !== undefined}>
          <span class="text-neutral-500 dark:text-neutral-400">{props.card.elapsedMs}ms</span>
        </Show>
      </div>
      <Show when={props.card.status === "failed" && props.card.error}>
        <div class="ml-5 mt-1 rounded bg-red-100 px-2 py-1 text-[11px] text-red-700 dark:bg-red-900/40 dark:text-red-200">
          {props.card.error}
        </div>
      </Show>
    </div>
  );
}
