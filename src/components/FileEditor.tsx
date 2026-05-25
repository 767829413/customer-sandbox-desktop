import { Show, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { EditorState, type Extension } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { oneDark } from "@codemirror/theme-one-dark";

import {
  closeFileEditor,
  reloadFileEditor,
  saveFileEditor,
  saveAndRunFileEditor,
  store,
  updateFileEditorText,
} from "../store";
import { loadLanguageExtension } from "../lib/fileEditor";

export default function FileEditor() {
  let host: HTMLDivElement | undefined;
  let view: EditorView | undefined;
  const [langExt, setLangExt] = createSignal<Extension | null>(null);

  // CodeMirror is imperative; we tear down + remount only when its
  // identity (which file, which theme, which language) actually
  // changes. We deliberately do NOT depend on `store.fileEditor.text`
  // here — that signal flips on every keystroke (via the update
  // listener below), and remounting per keystroke would destroy focus
  // and selection.
  const mountKey = createMemo(() =>
    [
      store.fileEditor.agent ?? "",
      store.fileEditor.path ?? "",
      prefersDark() ? "dark" : "light",
      langExt() ? "lang" : "plain",
      store.fileEditor.open ? "open" : "closed",
      // Collapse {idle, saving} → "ready" so a save round-trip
      // doesn't unmount the editor mid-edit.
      store.fileEditor.loadingState === "loading" ? "loading" : "ready",
    ].join("::"),
  );

  createEffect(() => {
    const path = store.fileEditor.path;
    if (!path) {
      setLangExt(null);
      return;
    }
    let cancelled = false;
    void loadLanguageExtension(path).then((ext) => {
      if (!cancelled) setLangExt(ext);
    });
    onCleanup(() => {
      cancelled = true;
    });
  });

  // Mount / remount the EditorView whenever the mount key changes.
  // Everything inside `untrack` is read non-reactively so user input
  // (which flips `store.fileEditor.text` and `.dirty`) does not
  // re-enter this effect.
  createEffect(() => {
    mountKey();
    untrack(() => {
      if (!store.fileEditor.open || store.fileEditor.loadingState === "loading") {
        destroyView();
        return;
      }
      if (!host) return;
      destroyView();
      const extensions: Extension[] = [
        lineNumbers(),
        history(),
        indentOnInput(),
        bracketMatching(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        EditorView.lineWrapping,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) {
            updateFileEditorText(u.state.doc.toString());
          }
        }),
      ];
      if (prefersDark()) extensions.push(oneDark);
      const lang = langExt();
      if (lang) extensions.push(lang);
      view = new EditorView({
        state: EditorState.create({
          doc: store.fileEditor.text,
          extensions,
        }),
        parent: host,
      });
    });
  });

  onCleanup(destroyView);

  function destroyView() {
    view?.destroy();
    view = undefined;
  }

  const sameAgentAsThread = createMemo(() => {
    const ed = store.fileEditor;
    const cur = store.threads.find((t) => t.id === store.currentThreadId);
    return cur != null && ed.agent != null && cur.agent === ed.agent;
  });

  const handleClose = () => {
    if (
      store.fileEditor.dirty &&
      !window.confirm("You have unsaved changes. Discard them?")
    ) {
      return;
    }
    closeFileEditor();
  };

  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      handleClose();
    } else if (e.key === "s" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void saveFileEditor();
    }
  };

  const handleReload = () => {
    if (
      store.fileEditor.dirty &&
      !window.confirm("Reload from disk and discard your unsaved changes?")
    ) {
      return;
    }
    void reloadFileEditor();
  };

  return (
    <Show when={store.fileEditor.open}>
      <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
        onClick={(e) => {
          if (e.target === e.currentTarget) handleClose();
        }}
        onKeyDown={handleKeydown}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="File editor"
      >
        <div class="flex h-[85vh] w-[80vw] max-w-5xl flex-col rounded-xl bg-white shadow-2xl dark:bg-neutral-900">
          <header class="flex items-center justify-between gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 text-sm font-semibold">
                <span class="truncate">{store.fileEditor.path ?? ""}</span>
                <Show when={store.fileEditor.dirty}>
                  <span class="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] uppercase text-amber-700 dark:bg-amber-900/40 dark:text-amber-200">
                    unsaved
                  </span>
                </Show>
              </div>
              <div class="text-xs text-neutral-500 dark:text-neutral-400">
                Agent: {store.fileEditor.agent ?? "—"}
                <Show when={store.fileEditor.mime}>
                  {(mime) => <> · {mime().split(";")[0]}</>}
                </Show>
                <Show when={store.fileEditor.sizeBytes > 0}>
                  {" · "}
                  {formatBytes(store.fileEditor.sizeBytes)}
                </Show>
              </div>
            </div>
            <button
              class="rounded px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-200 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
              onClick={handleClose}
              aria-label="Close editor"
              title="Close (Esc)"
            >
              ✕
            </button>
          </header>

          <Show when={store.fileEditor.errorMessage}>
            {(msg) => (
              <div class="flex items-center justify-between gap-3 border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-200">
                <span>{msg()}</span>
                <Show when={store.fileEditor.conflict}>
                  <span class="flex shrink-0 items-center gap-2">
                    <button
                      class="rounded border border-red-300 px-2 py-1 hover:bg-red-100 dark:border-red-700 dark:hover:bg-red-900/50"
                      onClick={handleReload}
                      disabled={store.fileEditor.loadingState === "saving"}
                    >
                      Reload
                    </button>
                    <button
                      class="rounded bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-50"
                      onClick={() => void saveFileEditor({ force: true })}
                      disabled={store.fileEditor.loadingState === "saving"}
                    >
                      Overwrite
                    </button>
                  </span>
                </Show>
              </div>
            )}
          </Show>

          <div class="relative flex-1 overflow-hidden">
            <Show when={store.fileEditor.loadingState === "loading"}>
              <div class="flex h-full items-center justify-center text-sm text-neutral-500">
                Loading file…
              </div>
            </Show>
            <Show when={store.fileEditor.loadingState !== "loading"}>
              <div
                ref={(el) => (host = el)}
                class="codemirror-host h-full w-full overflow-auto text-sm"
              />
            </Show>
          </div>

          <footer class="flex items-center justify-between gap-2 border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
            <div class="text-xs text-neutral-500 dark:text-neutral-400">
              <Show when={!sameAgentAsThread()}>
                "Save & Run" needs an active chat with{" "}
                <span class="font-mono">{store.fileEditor.agent}</span>.
              </Show>
            </div>
            <div class="flex items-center gap-2">
              <button
                class="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
                onClick={handleClose}
                disabled={store.fileEditor.loadingState === "saving"}
              >
                Cancel
              </button>
              <button
                class="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                onClick={() => void saveFileEditor()}
                disabled={
                  store.fileEditor.loadingState !== "idle" ||
                  !store.fileEditor.dirty ||
                  store.fileEditor.conflict
                }
              >
                {store.fileEditor.loadingState === "saving" ? "Saving…" : "Save"}
              </button>
              <button
                class="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                onClick={() => void saveAndRunFileEditor()}
                disabled={
                  store.fileEditor.loadingState !== "idle" ||
                  store.fileEditor.conflict ||
                  !sameAgentAsThread() ||
                  store.isStreaming
                }
                title={
                  sameAgentAsThread()
                    ? "Save and ask the agent to run this file"
                    : `Switch to a chat with agent "${store.fileEditor.agent}" first`
                }
              >
                Save &amp; Run
              </button>
            </div>
          </footer>
        </div>
      </div>
    </Show>
  );
}

function prefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const kb = value / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}
