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
      {props.card.status === "active" ? "⏳ " : "✓ "}
      {text()}
    </div>
  );
}
