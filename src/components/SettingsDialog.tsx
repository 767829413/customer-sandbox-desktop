import { For, Show, createEffect, createSignal, onCleanup } from "solid-js";
import { listAgents } from "../lib/api";
import type { Settings } from "../lib/storage";
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
  const [availableAgents, setAvailableAgents] = createSignal(
    store.availableAgents.length > 0 ? store.availableAgents : [store.settings.defaultAgent],
  );
  const [agentsLoading, setAgentsLoading] = createSignal(false);
  const [agentsError, setAgentsError] = createSignal<string | null>(null);
  const [showToken, setShowToken] = createSignal(false);
  let loadSeq = 0;

  // Re-sync when the dialog re-opens after an external change.
  // (Cheap: this component is rendered behind a `<Show when=…>` that
  //  fully unmounts when closed, so we get fresh signals each open.)

  const handleSave = (ev: Event) => {
    ev.preventDefault();
    const trimmedGateway = gatewayUrl().trim();
    const trimmedToken = bearerToken().trim();
    const options = availableAgents();
    const selected = defaultAgent().trim();
    const nextAgent = options.includes(selected)
      ? selected
      : selected || options[0] || store.settings.defaultAgent || "default";
    updateSettings({
      gatewayUrl: trimmedGateway,
      bearerToken: trimmedToken,
      defaultAgent: nextAgent,
    });
    props.onClose();
  };

  const handleKeydown = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") props.onClose();
  };

  const loadAgents = async (settings: Settings) => {
    const seq = ++loadSeq;
    const url = settings.gatewayUrl.trim();
    if (!url) {
      setAgentsLoading(false);
      setAgentsError(null);
      setAvailableAgents(store.availableAgents.length > 0 ? store.availableAgents : []);
      return;
    }
    setAgentsLoading(true);
    setAgentsError(null);
    try {
      const catalog = await listAgents(settings);
      if (seq !== loadSeq) return;
      setAvailableAgents(catalog.agents);
      if (catalog.agents.length === 0) {
        setAgentsError("Gateway 没有返回可用 agent。");
      } else if (!catalog.agents.includes(defaultAgent())) {
        setDefaultAgent(
          catalog.agents.includes(catalog.defaultAgent) ? catalog.defaultAgent : catalog.agents[0],
        );
      }
    } catch (err) {
      if (seq !== loadSeq) return;
      const raw = err instanceof Error ? err.message : String(err);
      setAvailableAgents([]);
      setAgentsError(
        raw.includes("HTTP 404")
          ? "服务端未提供 /v1/agents，将使用手动输入的 Default agent。"
          : `拉取 agent 失败：${raw}`,
      );
    } finally {
      if (seq === loadSeq) {
        setAgentsLoading(false);
      }
    }
  };

  createEffect(() => {
    if (!props.open) return;
    const url = gatewayUrl().trim();
    const token = bearerToken().trim();
    const timer = setTimeout(() => {
      void loadAgents({
        gatewayUrl: url,
        bearerToken: token,
        defaultAgent: store.settings.defaultAgent,
      });
    }, 300);
    onCleanup(() => clearTimeout(timer));
  });

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
                placeholder="optional"
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
              可选。仅当服务端要求 Bearer 鉴权时填写。
            </span>
          </label>

          <label class="block pb-4">
            <span class="block pb-1 text-sm font-medium">Default agent</span>
            <input
              type="text"
              list="agent-options"
              value={defaultAgent()}
              onInput={(e) => setDefaultAgent(e.currentTarget.value)}
              placeholder="default"
              class="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm font-mono dark:border-neutral-700 dark:bg-neutral-800"
            />
            <datalist id="agent-options">
              <For each={availableAgents()}>{(agent) => <option value={agent} />}</For>
            </datalist>
            <span class="mt-1 block text-xs text-neutral-500">
              客户端会尝试自动拉取 agent 列表；失败时可手动填写，保持兼容不同 AG-UI 服务端。
            </span>
            <Show when={agentsLoading()}>
              <span class="mt-1 block text-xs text-neutral-500">Loading agents...</span>
            </Show>
            <Show when={agentsError()}>
              {(msg) => <span class="mt-1 block text-xs text-red-600 dark:text-red-300">{msg()}</span>}
            </Show>
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
