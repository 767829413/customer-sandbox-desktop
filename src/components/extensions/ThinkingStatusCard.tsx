import type { ThinkingStatusCard } from "../../lib/storage";

interface Props {
  card: ThinkingStatusCard;
}

export default function ThinkingStatusCardView(props: Props) {
  const isThinking = () => props.card.status === "thinking";
  return (
    <div class="rounded-lg border border-sky-300 bg-sky-50/90 px-3 py-2 text-xs dark:border-sky-800 dark:bg-sky-950/40">
      <span class="font-medium text-sky-900 dark:text-sky-200">
        {isThinking() ? "Thinking..." : "Thinking done"}
      </span>
    </div>
  );
}
