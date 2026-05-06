# OpenShell Tauri Client

Desktop chat client for the OpenShell gateway. Solid + TypeScript + Tailwind on the frontend, Tauri v2 (Rust) hosting the webview.

Implementation plan: [`docs/plans/doing/step-7-tauri-client-mvp.md`](../docs/plans/doing/step-7-tauri-client-mvp.md).

## Prerequisites

- **Node.js ≥ 20** and **pnpm ≥ 9** (the project uses pnpm; `npm install` may also work but is unsupported).
- **Rust toolchain** (`rustup` + `cargo` ≥ 1.77).
- **Tauri v2 system deps** for your platform — see <https://v2.tauri.app/start/prerequisites/>. On macOS this is just Xcode CLT; on Linux you need `webkit2gtk`, `libsoup`, etc.
- **Tauri CLI**: `cargo install tauri-cli --version "^2.1"` (or rely on the dev-dep `@tauri-apps/cli` invoked via `pnpm tauri`).

## Network setup (dev)

The gateway binds to `127.0.0.1:7878` by default. To reach it from your laptop, open an ssh tunnel:

```bash
ssh -L 7878:127.0.0.1:7878 ec2-user@<gateway-host>
```

Leave that terminal open while running the client. The default Settings value (`http://127.0.0.1:7878`) targets this tunnel.

## Configure your token

In `gateway.toml` on the server, add a token entry:

```toml
[agui]
enabled = true
bind = "127.0.0.1:7878"
default_agent = "zeptoclaw"

[[agui.auth.tokens]]
token = "osh_pat_<random>"
user_id = "you"
```

Restart the gateway. In the client, click the Settings cog and paste the token into "Bearer token".

## Run

```bash
cd client
pnpm install
pnpm tauri dev
```

First run takes a few minutes (cargo + npm both populating caches). Subsequent runs are seconds.

## Project layout

```
client/
├── package.json              # frontend deps (Solid, Vite, Tailwind, marked, DOMPurify, hljs)
├── vite.config.ts            # Vite + Solid plugin
├── tailwind.config.js
├── postcss.config.js
├── tsconfig.json
├── index.html                # Vite entry
├── src/
│   ├── main.tsx              # Solid root
│   ├── App.tsx               # Sidebar | ChatArea + Settings dialog
│   ├── style.css             # Tailwind + minimal hljs theme + .prose-chat tweaks
│   ├── store.ts              # Solid createStore + sendMessage / resume / persistence
│   ├── lib/
│   │   ├── api.ts            # POST /v1/runs + GET stream (fetch + ReadableStream SSE)
│   │   ├── sse.ts            # SSE line-stream parser
│   │   ├── storage.ts        # localStorage read/write (settings + threads)
│   │   ├── markdown.ts       # marked + DOMPurify + highlight.js
│   │   └── id.ts             # ULID
│   └── components/
│       ├── Sidebar.tsx       # threads, +New, agent select, settings entry
│       ├── ChatArea.tsx      # messages + composer
│       ├── MessageBubble.tsx # one message (role color + markdown)
│       └── SettingsDialog.tsx
└── src-tauri/                # Tauri v2 backend (webview host only — no invoke commands)
    ├── Cargo.toml
    ├── tauri.conf.json
    ├── build.rs
    └── src/
        ├── main.rs
        └── lib.rs
```

This crate is **excluded from the workspace** (`Cargo.toml` `exclude = ["client/src-tauri", "zeptoclaw"]`), so workspace-wide `cargo build` / `cargo test` won't touch it.

## Build a release binary

```bash
pnpm tauri build
```

Note: this requires the icon set under `client/src-tauri/icons/`. Generate one with:

```bash
pnpm tauri icon path/to/source-1024.png
```

`pnpm tauri dev` works without the icons.

## Known limitations (MVP)

- Chat history lives only in this client's `localStorage`. Reinstall = lose history. Server-side WAL still records every turn — a future "list threads / get history" backend API will surface it cross-device.
- The agent selector sets the default agent for **new chats** only. Existing chats stay bound to their original agent. `POST /v1/runs` now accepts optional `agent`; unknown names are rejected with `400`.
- `RUN_LAGGED` (hub couldn't replay your `Last-Event-ID`) is shown as an error banner; the client does not auto-restart the run.
- No file uploads, no tool-call rendering, no thread search/rename, no auto-update.
- Single Gateway instance only — no multi-server switcher.

See [`docs/plans/doing/step-7-tauri-client-mvp.md`](../docs/plans/doing/step-7-tauri-client-mvp.md) §9 for the full "out of scope" list.

## Troubleshooting

- **`401 Unauthorized` immediately**: check the token in Settings matches `gateway.toml`. The gateway logs `reason=missing/malformed/unknown` to help triage.
- **Connection refused**: ssh tunnel isn't up, or gateway isn't running on the EC2 side. Confirm with `curl http://127.0.0.1:7878/healthz` (should return `ok`).
- **Stream stops with "Reconnect dropped events"**: you stayed disconnected long enough that the hub's 256-frame ring rolled past your last seen seq. Just resend the message.
- **Can't `pnpm tauri build` because of missing icons**: see "Build a release binary" above.
