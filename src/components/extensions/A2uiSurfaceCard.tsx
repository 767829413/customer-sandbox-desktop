import { Show, createEffect, createSignal } from "solid-js";

interface Props {
  messages: Record<string, unknown>[];
}

export default function A2uiSurfaceCard(props: Props) {
  let hostRef: HTMLDivElement | undefined;
  const [error, setError] = createSignal<string | null>(null);
  let renderSeq = 0;

  createEffect(() => {
    const host = hostRef;
    const messages = props.messages;
    if (!host || messages.length === 0) return;

    const seq = ++renderSeq;
    setError(null);

    void (async () => {
      try {
        const [webCore, litRenderer] = await Promise.all([
          import("@a2ui/web_core/v0_9"),
          import("@a2ui/lit/v0_9"),
        ]);
        if (seq !== renderSeq || !hostRef) return;

        // Ensure the custom element module is evaluated.
        void litRenderer.A2uiSurface;

        const processor = new webCore.MessageProcessor(
          [litRenderer.basicCatalog],
          async () => undefined,
        );
        processor.processMessages(messages as any[]);

        const surfaces = Array.from(processor.model.surfacesMap.values());
        host.replaceChildren();
        if (surfaces.length === 0) {
          setError("A2UI payload did not create any surface.");
          return;
        }

        for (const surface of surfaces) {
          const el = document.createElement("a2ui-surface") as HTMLElement & {
            surface?: unknown;
          };
          el.surface = surface;
          host.appendChild(el);
        }
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        setError(`A2UI render failed: ${detail}`);
      }
    })();
  });

  return (
    <div class="py-1 text-[11px]">
      <div class="mb-1 text-neutral-700 dark:text-neutral-300">A2UI surface</div>
      <div class="rounded border border-neutral-300 bg-white/70 p-2 dark:border-neutral-700 dark:bg-neutral-900/70">
        <div ref={hostRef} />
        <Show when={error()}>
          {(msg) => (
            <div class="mt-1 rounded bg-red-100 px-2 py-1 text-[11px] text-red-700 dark:bg-red-900/40 dark:text-red-200">
              {msg()}
            </div>
          )}
        </Show>
      </div>
    </div>
  );
}
