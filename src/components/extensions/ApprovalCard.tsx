import { Show, createMemo, createSignal } from "solid-js";
import type { ApprovalDecision } from "../../lib/api";
import { UserFacingMessages } from "../../lib/capability";
import type { ApprovalRequestCard } from "../../lib/storage";
import { respondApproval, store } from "../../store";

interface Props {
  threadId: string;
  approval: ApprovalRequestCard;
}

export default function ApprovalCard(props: Props) {
  const [busyDecision, setBusyDecision] = createSignal<ApprovalDecision | null>(null);
  const [submittedDecision, setSubmittedDecision] = createSignal<ApprovalDecision | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  const prettyArgs = createMemo(() => {
    try {
      return JSON.stringify(props.approval.arguments, null, 2);
    } catch {
      return "{}";
    }
  });
  const requestPreview = createMemo(() => {
    const trimmedCmd = props.approval.shellCommand?.trim();
    const source =
      trimmedCmd && trimmedCmd.length > 0
        ? trimmedCmd
        : prettyArgs()
            .replace(/\s+/g, " ")
            .trim();
    if (!source) return "(empty)";
    return source.length > 140 ? `${source.slice(0, 140)}…` : source;
  });

  const resolvedDecision = createMemo(
    () => props.approval.resolvedDecision ?? submittedDecision() ?? null,
  );
  const approvalApiUnsupported = createMemo(
    () => store.capabilities.approvalApi === "unsupported",
  );

  const onDecision = async (decision: ApprovalDecision) => {
    if (approvalApiUnsupported()) {
      setError(UserFacingMessages.approvalUnsupported);
      return;
    }
    if (busyDecision() !== null || resolvedDecision() !== null) return;
    setBusyDecision(decision);
    setError(null);
    try {
      await respondApproval(props.threadId, props.approval.requestId, decision);
      setSubmittedDecision(decision);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyDecision(null);
    }
  };

  return (
    <div class="rounded-lg border border-amber-300 bg-amber-50/90 px-3 py-2 text-xs dark:border-amber-700 dark:bg-amber-950/40">
      <div class="mb-1 flex items-center justify-between">
        <div class="font-semibold text-amber-900 dark:text-amber-200">
          Approval Required · {props.approval.toolName}
        </div>
        <Show when={props.approval.pendingTotal > 1}>
          <span class="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">
            {props.approval.pendingTotal} pending
          </span>
        </Show>
      </div>

      <details class="rounded border border-amber-200 bg-white/60 px-2 py-1 dark:border-amber-800/60 dark:bg-black/20">
        <summary class="cursor-pointer text-[11px] text-amber-800 dark:text-amber-200">
          Request · {requestPreview()}
        </summary>
        <Show
          when={props.approval.shellCommand}
          fallback={
            <pre class="mt-1 max-h-40 overflow-auto rounded bg-black/5 p-2 dark:bg-black/30">
              {prettyArgs()}
            </pre>
          }
        >
          {(cmd) => (
            <pre class="mt-1 max-h-40 overflow-auto rounded bg-black/5 p-2 dark:bg-black/30">
              {cmd()}
            </pre>
          )}
        </Show>
      </details>

      <div class="mt-2 flex flex-wrap gap-1.5">
        <button
          class="rounded bg-emerald-600 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50"
          disabled={busyDecision() !== null || resolvedDecision() !== null || approvalApiUnsupported()}
          onClick={() => void onDecision("approve")}
        >
          Approve
        </button>
        <button
          class="rounded bg-red-600 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50"
          disabled={busyDecision() !== null || resolvedDecision() !== null || approvalApiUnsupported()}
          onClick={() => void onDecision("deny")}
        >
          Deny
        </button>
      </div>

      {/* Approval mode is a thread-level setting in zeptoclaw, not a
          per-decision choice. We expose it through the chat command
          channel so it stays the single source of truth (state lives
          on the agent, not on the client). */}
      <div class="mt-2 text-[11px] text-neutral-500 dark:text-neutral-400">
        Tip: send{" "}
        <code class="rounded bg-neutral-200 px-1 py-px font-mono text-[10px] dark:bg-neutral-800">
          /skip_approval
        </code>{" "}
        in chat to auto-approve future tools for this chat. Use{" "}
        <code class="rounded bg-neutral-200 px-1 py-px font-mono text-[10px] dark:bg-neutral-800">
          /require_approval
        </code>{" "}
        to turn approvals back on.
      </div>

      <Show when={approvalApiUnsupported()}>
        <div class="mt-2 rounded bg-neutral-100 px-2 py-1 text-[11px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
          {UserFacingMessages.approvalUnsupported}
        </div>
      </Show>

      <Show when={resolvedDecision()}>
        {(decision) => (
          <div class="mt-2 text-[11px] text-neutral-600 dark:text-neutral-300">
            Decision: {decision()}
          </div>
        )}
      </Show>

      <Show when={error()}>
        {(msg) => (
          <div class="mt-2 rounded bg-red-100 px-2 py-1 text-[11px] text-red-700 dark:bg-red-900/40 dark:text-red-200">
            {msg()}
          </div>
        )}
      </Show>
    </div>
  );
}
