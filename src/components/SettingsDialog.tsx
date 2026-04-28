import { Show, createSignal } from "solid-js";
import { store, updateSettings } from "../store";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function SettingsDialog(props: Props) {
  // Local form state — we don't write to the store until "Save" so a
  // user can bail out via "Cancel" or Esc without polluting persisted
  // settings.
  const [gatewayUrl, setGatewayUrl] = createSignal(store.settings.gatewayUrl);
  const [bearerToken, setBearerToken] = createSignal(store.settings.bearerToken);
  const [defaultAgent, setDefaultAgent] = createSignal(store.settings.defaultAgent);
  const [showToken, setShowToken] = createSignal(false);

  // Re-sync when the dialog re-opens after an external change.
  // (Cheap: this component is rendered behind a `<Show when=…>` that
  //  fully unmounts when closed, so we get fresh signals each open.)

  const handleSave = (ev: Event) => {
    ev.preventDefault();
    updateSettings({
      gatewayUrl: gatewayUrl().trim(),
      bearerToken: bearerToken().trim(),
      defaultAgent: defaultAgent().trim() || "zeptoclaw",
    });
    props.onClose();
  };

  const handleKeydown = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") props.onClose();
  };

  return (
    <Show when={props.open}>
      <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
        onClick={(e) => {
          if (e.target === e.currentTarget) props.onClose();
        }}
        onKeyDown={handleKeydown}
        tabIndex={-1}
      >
        <form
          class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-neutral-900"
          onSubmit={handleSave}
        >
          <h2 class="mb-4 text-lg font-semibold">Settings</h2>

          <label class="block pb-3">
            <span class="block pb-1 text-sm font-medium">Gateway URL</span>
            <input
              type="url"
              required
              placeholder="http://127.0.0.1:7878"
              value={gatewayUrl()}
              onInput={(e) => setGatewayUrl(e.currentTarget.value)}
              class="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800"
            />
            <span class="mt-1 block text-xs text-neutral-500">
              For local dev: <code>ssh -L 7878:127.0.0.1:7878 ec2-user@host</code>
            </span>
          </label>

          <label class="block pb-3">
            <span class="block pb-1 text-sm font-medium">Bearer token</span>
            <div class="relative">
              <input
                type={showToken() ? "text" : "password"}
                required
                placeholder="osh_pat_…"
                value={bearerToken()}
                onInput={(e) => setBearerToken(e.currentTarget.value)}
                class="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 pr-16 text-sm font-mono dark:border-neutral-700 dark:bg-neutral-800"
              />
              <button
                type="button"
                class="absolute right-1 top-1/2 -translate-y-1/2 rounded px-2 py-0.5 text-xs text-neutral-600 hover:bg-neutral-200 dark:text-neutral-300 dark:hover:bg-neutral-700"
                onClick={() => setShowToken(!showToken())}
              >
                {showToken() ? "Hide" : "Show"}
              </button>
            </div>
            <span class="mt-1 block text-xs text-neutral-500">
              Configured under <code>[[agui.auth.tokens]]</code> in
              <code> gateway.toml</code>.
            </span>
          </label>

          <label class="block pb-4">
            <span class="block pb-1 text-sm font-medium">Default agent</span>
            <input
              type="text"
              required
              placeholder="zeptoclaw"
              value={defaultAgent()}
              onInput={(e) => setDefaultAgent(e.currentTarget.value)}
              class="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm font-mono dark:border-neutral-700 dark:bg-neutral-800"
            />
            <span class="mt-1 block text-xs text-neutral-500">
              Used for new chats. Currently the gateway's
              <code> [agui].default_agent</code> always wins for now (see
              step-7 plan §7).
            </span>
          </label>

          <div class="flex justify-end gap-2 pt-2">
            <button
              type="button"
              class="rounded px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
              onClick={() => props.onClose()}
            >
              Cancel
            </button>
            <button
              type="submit"
              class="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </Show>
  );
}
