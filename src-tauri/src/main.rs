// Windows: no console window behind the app in a release build.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/*
 * The desktop shell.
 *
 * Deliberately almost empty. The app is already a complete offline-first
 * browser app that keeps everything in localStorage and IndexedDB, so the
 * desktop build is the same bundle in a window that owns its own storage -
 * there is no server to start and no IPC to expose.
 *
 * Nothing is registered here on purpose. Every command added to this file is
 * a hole punched through the webview sandbox into the operating system, and
 * the browser build has to work without them anyway. When the desktop needs a
 * capability the web cannot have, it gets added here with a capability entry
 * beside it - not before.
 */
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .run(tauri::generate_context!())
        .expect("The All Dash failed to start");
}
