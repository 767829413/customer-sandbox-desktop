// Webview-only host with two Tauri plugins:
//   * dialog — for native confirm() and "save as…" pickers. macOS WKWebView
//     silently drops the webview-internal `window.confirm()` so we can't
//     rely on it for "are you sure?" gates.
//   * fs     — to write the picked file path. WKWebView also doesn't honor
//     `<a href="blob:..." download>` navigation, so the "download a
//     workspace file" flow goes Blob → Uint8Array → fs.writeFile via JS,
//     not via webview navigation.
// No `invoke` commands yet — both plugins ship their JS APIs. Permissions
// for them are declared in `capabilities/default.json`.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running OpenShell tauri application");
}
