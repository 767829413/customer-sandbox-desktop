import { For, Show, createMemo } from "solid-js";
import { renderMarkdown } from "../lib/markdown";
import type { Message } from "../lib/storage";
import ApprovalCard from "./extensions/ApprovalCard";
import FileArtifactChip from "./extensions/FileArtifactChip";

interface Props {
  threadId: string;
  message: Message;
  agent: string;
}

export default function MessageBubble(props: Props) {
  const html = createMemo(() => renderMarkdown(props.message.content));
  const isUser = () => props.message.role === "user";

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
        <Show when={(props.message.approvalRequests?.length ?? 0) > 0}>
          <div class="mt-2 flex flex-col gap-1.5">
            <For each={props.message.approvalRequests}>
              {(approval) => <ApprovalCard threadId={props.threadId} approval={approval} />}
            </For>
          </div>
        </Show>
        <Show when={(props.message.fileArtifacts?.length ?? 0) > 0}>
          <div class="mt-2 flex flex-col gap-1.5">
            <For each={props.message.fileArtifacts}>
              {(artifact) => <FileArtifactChip artifact={artifact} agent={props.agent} />}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}
