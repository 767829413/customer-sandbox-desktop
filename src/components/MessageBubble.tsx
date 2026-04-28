import { Show, createMemo } from "solid-js";
import { renderMarkdown } from "../lib/markdown";
import type { Message } from "../lib/storage";

interface Props {
  message: Message;
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
      </div>
    </div>
  );
}
