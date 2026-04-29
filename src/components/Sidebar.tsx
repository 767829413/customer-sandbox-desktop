import { For, Show, createMemo } from "solid-js";
import {
  deleteThread,
  newThread,
  toggleFilesDrawer,
  setCurrentThread,
  store,
  updateSettings,
} from "../store";

interface Props {
  onOpenSettings: () => void;
}

const KNOWN_AGENTS = ["zeptoclaw", "codex"] as const;

export default function Sidebar(props: Props) {
  // Threads sorted by recency. Solid will re-derive whenever a message
  // bumps `updatedAtMs`.
  const sorted = createMemo(() =>
    [...store.threads].sort((a, b) => b.updatedAtMs - a.updatedAtMs),
  );

  return (
    <aside class="flex h-full w-64 shrink-0 flex-col border-r border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900">
      <div class="border-b border-neutral-200 p-3 dark:border-neutral-800">
        <button
          class="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
          onClick={() => newThread()}
        >
          + New Chat
        </button>
      </div>

      <div class="border-b border-neutral-200 p-3 text-xs text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
        <label class="block pb-1 text-[10px] font-semibold uppercase tracking-wider">
          Default agent
        </label>
        <select
          class="w-full rounded border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
          value={store.settings.defaultAgent}
          onChange={(e) => {
            // Switching the default agent only takes effect on the next
            // "+ New Chat". Existing threads keep whatever agent they
            // were created with — switching mid-thread would mix
            // sandbox state across agents.
            const next = (e.currentTarget as HTMLSelectElement).value;
            updateSettings({ ...store.settings, defaultAgent: next });
          }}
        >
          <For each={KNOWN_AGENTS}>{(a) => <option value={a}>{a}</option>}</For>
        </select>
        <p class="mt-1 text-[10px] leading-snug">
          Applies to new chats. Current chat uses{" "}
          <span class="font-mono">{currentAgent()}</span>.
        </p>
      </div>

      <div class="flex-1 overflow-y-auto">
        <Show
          when={sorted().length > 0}
          fallback={
            <p class="p-4 text-xs text-neutral-400">
              No chats yet. Click <em>+ New Chat</em> to start.
            </p>
          }
        >
          <ul class="py-1">
            <For each={sorted()}>
              {(t) => (
                <li>
                  <div
                    class="group flex items-center gap-1 px-2 py-1.5"
                    classList={{
                      "bg-neutral-200 dark:bg-neutral-800":
                        t.id === store.currentThreadId,
                    }}
                  >
                    <button
                      class="flex-1 truncate rounded px-2 py-1 text-left text-sm text-neutral-800 hover:bg-neutral-200 dark:text-neutral-200 dark:hover:bg-neutral-800"
                      title={t.title}
                      onClick={() => setCurrentThread(t.id)}
                    >
                      <div class="truncate">{t.title}</div>
                      <div class="truncate text-[10px] text-neutral-500">
                        {t.agent} · {new Date(t.updatedAtMs).toLocaleString()}
                      </div>
                    </button>
                    <button
                      class="invisible rounded px-2 py-1 text-xs text-neutral-500 hover:bg-red-100 hover:text-red-700 group-hover:visible dark:hover:bg-red-900/60 dark:hover:text-red-200"
                      title="Delete chat"
                      onClick={() => {
                        if (confirm(`Delete chat "${t.title}"? Local only.`)) {
                          deleteThread(t.id);
                        }
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>

      <div class="border-t border-neutral-200 p-3 dark:border-neutral-800">
        <button
          class="mb-2 flex w-full items-center justify-center gap-2 rounded border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-200 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
          classList={{
            "bg-neutral-200 dark:bg-neutral-800":
              store.filesDrawer.open && store.filesDrawer.agent === currentAgent(),
          }}
          onClick={() => toggleFilesDrawer(currentAgent())}
        >
          📁 Files
        </button>
        <button
          class="flex w-full items-center justify-center gap-2 rounded border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-200 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
          onClick={() => props.onOpenSettings()}
        >
          ⚙ Settings
        </button>
      </div>
    </aside>
  );
}

function currentAgent(): string {
  const t = store.threads.find((t) => t.id === store.currentThreadId);
  return t?.agent ?? store.settings.defaultAgent;
}
