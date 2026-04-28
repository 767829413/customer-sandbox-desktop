import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { clearErrorBanner, sendMessage, store } from "../store";
import MessageBubble from "./MessageBubble";

export default function ChatArea() {
  const [draft, setDraft] = createSignal("");
  let scrollEl: HTMLDivElement | undefined;
  let textareaEl: HTMLTextAreaElement | undefined;

  const currentThread = createMemo(() =>
    store.threads.find((t) => t.id === store.currentThreadId),
  );

  // Auto-scroll to bottom when new content arrives. Track message
  // count + last message length so streaming deltas keep us pinned.
  const scrollSignature = createMemo(() => {
    const t = currentThread();
    if (!t || t.messages.length === 0) return "";
    const last = t.messages[t.messages.length - 1];
    return `${t.id}:${t.messages.length}:${last.content.length}`;
  });

  // Tiny effect — Solid's render scheduler will batch this with the
  // store update, so DOM is up-to-date by the time we read scrollHeight.
  onMount(() => {
    let prev = scrollSignature();
    const tick = () => {
      const cur = scrollSignature();
      if (cur !== prev) {
        prev = cur;
        if (scrollEl) {
          scrollEl.scrollTop = scrollEl.scrollHeight;
        }
      }
    };
    const id = setInterval(tick, 80);
    onCleanup(() => clearInterval(id));
  });

  const handleSubmit = (ev: Event) => {
    ev.preventDefault();
    const text = draft();
    if (!text.trim() || store.isStreaming) return;
    sendMessage(text);
    setDraft("");
    if (textareaEl) {
      textareaEl.style.height = "auto";
    }
  };

  const handleKeydown = (ev: KeyboardEvent) => {
    // Cmd/Ctrl+Enter sends. Plain Enter inserts a newline so users
    // can paste multi-line prompts naturally.
    if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") {
      ev.preventDefault();
      handleSubmit(ev);
    }
  };

  const handleInput = (ev: InputEvent) => {
    const t = ev.currentTarget as HTMLTextAreaElement;
    setDraft(t.value);
    // Auto-grow up to ~10 lines.
    t.style.height = "auto";
    t.style.height = `${Math.min(t.scrollHeight, 240)}px`;
  };

  return (
    <div class="flex h-full flex-1 flex-col">
      <Show when={store.errorBanner}>
        <div class="flex items-start gap-3 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
          <span class="flex-1">{store.errorBanner}</span>
          <button
            class="rounded px-2 py-0.5 text-xs hover:bg-red-100 dark:hover:bg-red-900/60"
            onClick={() => clearErrorBanner()}
          >
            Dismiss
          </button>
        </div>
      </Show>

      <div ref={scrollEl} class="flex-1 overflow-y-auto px-4 py-6">
        <Show
          when={currentThread()}
          fallback={
            <div class="flex h-full items-center justify-center text-sm text-neutral-400">
              Pick a thread on the left or start a new chat.
            </div>
          }
        >
          {(t) => (
            <Show
              when={t().messages.length > 0}
              fallback={
                <div class="flex h-full items-center justify-center text-sm text-neutral-400">
                  Send a message to {t().agent} to start the conversation.
                </div>
              }
            >
              <div class="mx-auto flex max-w-3xl flex-col gap-4">
                <For each={t().messages}>{(m) => <MessageBubble message={m} />}</For>
              </div>
            </Show>
          )}
        </Show>
      </div>

      <form
        class="border-t border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-950"
        onSubmit={handleSubmit}
      >
        <div class="mx-auto flex max-w-3xl items-end gap-2">
          <textarea
            ref={textareaEl}
            value={draft()}
            onInput={handleInput}
            onKeyDown={handleKeydown}
            rows={1}
            placeholder="Message OpenShell…  (Cmd/Ctrl+Enter to send)"
            class="flex-1 resize-none rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900"
            disabled={store.isStreaming}
          />
          <button
            type="submit"
            class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={store.isStreaming || !draft().trim()}
          >
            {store.isStreaming ? "Sending…" : "Send"}
          </button>
        </div>
      </form>
    </div>
  );
}
