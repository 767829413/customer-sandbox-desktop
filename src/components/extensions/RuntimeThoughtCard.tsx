import type { RuntimeThoughtCard } from "../../lib/storage";

interface Props {
  card: RuntimeThoughtCard;
}

export default function RuntimeThoughtCardView(props: Props) {
  const text = () => {
    if (props.card.status === "active") return "Thought...";
    if (props.card.durationMs !== undefined) {
      if (props.card.durationMs < 1000) return `Thought for ${props.card.durationMs}ms`;
      return `Thought for ${(props.card.durationMs / 1000).toFixed(1)}s`;
    }
    return "Thought";
  };

  return (
    <div class="py-1 text-[11px] text-neutral-700 dark:text-neutral-300">
      <div>
        {props.card.status === "active" ? "⏳ " : "✓ "}
        {text()}
      </div>
      {props.card.detail && props.card.detail.trim().length > 0 ? (
        <details class="ml-5 mt-1 rounded border border-neutral-300 bg-white/70 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900/70">
          <summary class="cursor-pointer text-neutral-600 dark:text-neutral-300">Thought detail</summary>
          <pre class="mt-1 max-h-56 overflow-auto whitespace-pre-wrap text-[11px] text-neutral-700 dark:text-neutral-200">
            {props.card.detail}
          </pre>
        </details>
      ) : null}
    </div>
  );
}
