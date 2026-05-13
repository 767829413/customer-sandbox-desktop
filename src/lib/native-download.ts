// Native download + confirm shims that route around two macOS WKWebView
// limitations exposed in 2026-05-13 manual testing:
//
//   1. `<a href="blob:..." download>` navigation is silently dropped by
//      WKWebView — no save dialog, no Downloads folder write. We instead
//      pull the Blob into memory, ask the user where to save via the
//      native save dialog, and write through plugin-fs.
//   2. `window.confirm()` returns `undefined` (falsy) without ever showing
//      a dialog, so any "are you sure?" gate built on it just no-ops.
//      Replaced with the plugin-dialog `ask()` async equivalent.
//
// Both helpers gracefully degrade when run outside of a Tauri host (e.g.
// `pnpm dev` in a plain browser) so the dev experience doesn't break.

import { ask, save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";

const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Show a native confirm dialog via Tauri's plugin-dialog, falling back to
 * the browser-native `confirm()` outside of Tauri. Returns `false` if the
 * user dismisses, never throws.
 */
export async function confirmAction(
  message: string,
  title = "Confirm",
): Promise<boolean> {
  if (!isTauri()) {
    const ok = window.confirm(message);
    console.debug("[confirmAction] non-tauri window.confirm =>", ok);
    return ok;
  }
  try {
    const ok = await ask(message, { title, kind: "warning" });
    console.debug("[confirmAction] tauri dialog.ask =>", ok, "title=", title);
    return ok;
  } catch (err) {
    console.warn("[confirmAction] dialog.ask threw, returning false", err);
    return false;
  }
}

/**
 * Write a Blob to disk via Tauri's plugin-fs after asking the user for a
 * destination path. Returns `true` if the file was written, `false` if
 * the user cancelled the save dialog. Throws on actual IO failures.
 *
 * Outside of Tauri, falls back to the legacy `<a download>` flow (works
 * in normal browsers). The legacy fallback is best-effort only.
 */
export async function saveBlobToDisk(
  blob: Blob,
  defaultFileName: string,
): Promise<boolean> {
  if (!isTauri()) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = defaultFileName;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  }
  const destination = await save({ defaultPath: defaultFileName });
  if (!destination) {
    return false;
  }
  const buffer = new Uint8Array(await blob.arrayBuffer());
  await writeFile(destination, buffer);
  return true;
}
