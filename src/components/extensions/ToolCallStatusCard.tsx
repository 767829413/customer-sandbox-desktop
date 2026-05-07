import { Show } from "solid-js";
import type { ToolCallCard } from "../../lib/storage";

interface Props {
  card: ToolCallCard;
}

export default function ToolCallStatusCard(props: Props) {
  const hasRequest = () =>
    !!props.card.arguments && props.card.arguments.trim().length > 0;
  const hasResponse = () =>
    (!!props.card.result && props.card.result.trim().length > 0) ||
    (!!props.card.resultPreview && props.card.resultPreview.trim().length > 0);

  const responseText = () =>
    props.card.result && props.card.result.trim().length > 0
      ? props.card.result
      : props.card.resultPreview;

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
      <Show when={hasRequest() || hasResponse()}>
        <div class="ml-5 mt-1 space-y-2">
          <Show when={hasRequest()}>
            <details class="rounded border border-neutral-300 bg-white/70 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900/70">
              <summary class="cursor-pointer text-neutral-600 dark:text-neutral-300">
                Request
              </summary>
              <pre class="mt-1 max-h-56 overflow-auto whitespace-pre-wrap text-[11px] text-neutral-700 dark:text-neutral-200">
                {props.card.arguments}
              </pre>
            </details>
          </Show>
          <Show when={hasResponse()}>
            <details class="rounded border border-neutral-300 bg-white/70 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900/70">
              <summary class="cursor-pointer text-neutral-600 dark:text-neutral-300">
                Response
              </summary>
              <pre class="mt-1 max-h-64 overflow-auto whitespace-pre-wrap text-[11px] text-neutral-700 dark:text-neutral-200">
                {responseText()}
              </pre>
            </details>
          </Show>
        </div>
      </Show>
    </div>
  );
}
