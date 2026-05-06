import { For, Show, createMemo } from "solid-js";
import { renderMarkdown } from "../lib/markdown";
import type { ApprovalRequestCard, FileArtifact, Message } from "../lib/storage";
import ApprovalCard from "./extensions/ApprovalCard";
import FileArtifactChip from "./extensions/FileArtifactChip";
import RuntimeThoughtCard from "./extensions/RuntimeThoughtCard";
import ToolCallStatusCard from "./extensions/ToolCallStatusCard";

interface Props {
  threadId: string;
  message: Message;
  agent: string;
}

export default function MessageBubble(props: Props) {
  const html = createMemo(() => renderMarkdown(props.message.content));
  const isUser = () => props.message.role === "user";
  const timeLabel = createMemo(() =>
    new Date(props.message.createdAtMs).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }),
  );
  const approvalsById = createMemo(() => {
    const map = new Map<string, ApprovalRequestCard>();
    for (const approval of props.message.approvalRequests ?? []) {
      if (!approval) continue;
      map.set(approval.requestId, approval);
    }
    return map;
  });
  const artifactsById = createMemo(() => {
    const map = new Map<string, FileArtifact>();
    for (const artifact of props.message.fileArtifacts ?? []) {
      if (!artifact) continue;
      map.set(artifact.eventId, artifact);
    }
    return map;
  });
  const timelineCount = createMemo(() => props.message.timeline?.length ?? 0);

  return (
    <div
      class="flex w-full"
      classList={{ "justify-end": isUser(), "justify-start": !isUser() }}
    >
      <div
        class="max-w-[80%] rounded-2xl px-4 py-2 text-sm shadow-sm"
        classList={{
          "bg-blue-600 text-white": isUser(),
          "bg-neutral-100 dark:bg-neutral-800": !isUser(),
        }}
      >
        <Show
          when={timelineCount() > 0}
          fallback={
            <>
              <Show when={(props.message.approvalRequests?.length ?? 0) > 0}>
                <div class="mb-2 flex flex-col gap-1.5">
                  <For each={props.message.approvalRequests}>
                    {(approval) => <ApprovalCard threadId={props.threadId} approval={approval} />}
                  </For>
                </div>
              </Show>
              <Show when={(props.message.fileArtifacts?.length ?? 0) > 0}>
                <div class="mb-2 flex flex-col gap-1.5">
                  <For each={props.message.fileArtifacts}>
                    {(artifact) => <FileArtifactChip artifact={artifact} agent={props.agent} />}
                  </For>
                </div>
              </Show>
            </>
          }
        >
          <details
            class="mb-2 rounded-md border border-neutral-300 bg-neutral-50/80 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900/70"
            open={props.message.streaming === true}
          >
            <summary class="cursor-pointer text-[11px] text-neutral-600 dark:text-neutral-300">
              Runtime timeline · {timelineCount()} events
            </summary>
            <div class="mt-1">
              <For each={props.message.timeline}>
                {(item) =>
                  item.kind === "thought" ? (
                    <RuntimeThoughtCard card={item} />
                  ) : item.kind === "tool_call" ? (
                    <ToolCallStatusCard card={item} />
                  ) : item.kind === "custom_event" ? (
                    <div class="py-1 text-[11px] text-neutral-700 dark:text-neutral-300">
                      <span class="font-mono">{item.name}</span>
                      <span class="ml-2 text-neutral-500 dark:text-neutral-400">{item.preview}</span>
                    </div>
                  ) : item.kind === "approval" ? (
                    <Show when={approvalsById().get(item.requestId)}>
                      {(approval) => <ApprovalCard threadId={props.threadId} approval={approval()} />}
                    </Show>
                  ) : (
                    <Show when={artifactsById().get(item.eventId)}>
                      {(artifact) => <FileArtifactChip artifact={artifact()} agent={props.agent} />}
                    </Show>
                  )
                }
              </For>
            </div>
          </details>
        </Show>
        <Show
          when={props.message.content.length > 0}
          fallback={
            <Show
              when={props.message.streaming}
              fallback={<span class="italic opacity-60">(empty)</span>}
            >
              <span class="inline-flex gap-1">
                <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-current opacity-60"></span>
                <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-current opacity-60 [animation-delay:120ms]"></span>
                <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-current opacity-60 [animation-delay:240ms]"></span>
              </span>
            </Show>
          }
        >
          <div class="prose-chat" innerHTML={html()} />
        </Show>
        <Show when={props.message.errorMessage}>
          <div class="mt-2 rounded bg-red-100 px-2 py-1 text-xs text-red-700 dark:bg-red-900/40 dark:text-red-200">
            {props.message.errorMessage}
          </div>
        </Show>
        <div class="mt-2 text-right text-[10px] opacity-60">{timeLabel()}</div>
      </div>
    </div>
  );
}
