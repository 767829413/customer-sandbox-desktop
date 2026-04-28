// `cargo tauri dev` / desktop binary entry point. The actual setup lives
// in `lib.rs` so a future mobile target can call the same `run()` from
// platform-specific entry stubs.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    openshell_tauri_lib::run()
}
