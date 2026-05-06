import { Show, createMemo, createSignal } from "solid-js";
import type { ApprovalDecision } from "../../lib/api";
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

  const resolvedDecision = createMemo(
    () => props.approval.resolvedDecision ?? submittedDecision() ?? null,
  );
  const approvalApiUnsupported = createMemo(
    () => store.capabilities.approvalApi === "unsupported",
  );

  const onDecision = async (decision: ApprovalDecision) => {
    if (approvalApiUnsupported()) {
      setError("当前服务端未实现审批回填接口，无法在卡片中直接审批。");
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

      <Show
        when={props.approval.shellCommand}
        fallback={<pre class="max-h-40 overflow-auto rounded bg-black/5 p-2 dark:bg-black/30">{prettyArgs()}</pre>}
      >
        {(cmd) => (
          <pre class="max-h-40 overflow-auto rounded bg-black/5 p-2 dark:bg-black/30">{cmd()}</pre>
        )}
      </Show>

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
        <button
          class="rounded border border-emerald-600 px-2 py-1 text-[11px] font-medium text-emerald-700 disabled:opacity-50 dark:text-emerald-300"
          disabled={busyDecision() !== null || resolvedDecision() !== null || approvalApiUnsupported()}
          onClick={() => void onDecision("approve_all")}
        >
          Approve all
        </button>
        <button
          class="rounded border border-red-600 px-2 py-1 text-[11px] font-medium text-red-700 disabled:opacity-50 dark:text-red-300"
          disabled={busyDecision() !== null || resolvedDecision() !== null || approvalApiUnsupported()}
          onClick={() => void onDecision("deny_all")}
        >
          Deny all
        </button>
      </div>

      <Show when={approvalApiUnsupported()}>
        <div class="mt-2 rounded bg-neutral-100 px-2 py-1 text-[11px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
          当前服务端未实现审批回填接口（/v1/threads/&lt;threadId&gt;/responses）。
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
