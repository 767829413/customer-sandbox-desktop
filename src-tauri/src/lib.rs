// MVP: webview-only host. No invoke commands yet — the AG-UI HTTP/SSE
// link is driven entirely from the frontend (fetch + ReadableStream).
// Add tauri::generate_handler! commands here when we need filesystem
// or OS-level access (e.g. local SQLite store, native notifications).
pub fn run() {
    tauri::Builder::default()
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running OpenShell tauri application");
}
