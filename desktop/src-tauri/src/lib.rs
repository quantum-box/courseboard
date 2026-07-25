#[cfg(not(any(target_os = "ios", target_os = "android")))]
mod cart_simulator;
#[cfg(any(target_os = "macos", windows))]
mod macos_desktop;
mod native_auth;
mod photon_bridge;
#[cfg(all(target_os = "macos", feature = "web-distribution"))]
mod updater;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
mod ws_server;

use tauri::Manager;
use tauri_plugin_deep_link::DeepLinkExt;

#[tauri::command]
fn app_target_os() -> String {
    std::env::consts::OS.to_string()
}

fn collect_native_auth_callbacks(
    state: &native_auth::NativeAuthCallbackState,
    urls: impl IntoIterator<Item = impl ToString>,
) {
    for url in urls {
        if let Err(error) = state.push_callback(url.to_string()) {
            log::warn!("ignored deep link: {error}");
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // This must be the first plugin so a second desktop process forwards its
    // statically configured deep link to the active instance.
    #[cfg(desktop)]
    let builder =
        tauri::Builder::default().plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));

    #[cfg(not(desktop))]
    let builder = tauri::Builder::default();

    #[cfg(all(target_os = "macos", feature = "web-distribution"))]
    let builder = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build());

    #[cfg(any(target_os = "macos", windows))]
    let builder = builder
        .manage(macos_desktop::CourseboardTabsState::default())
        .menu(macos_desktop::menu)
        .on_menu_event(|app, event| {
            macos_desktop::handle_menu_event(app, event.id().as_ref());
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let app = window.app_handle();
                let label = app
                    .state::<macos_desktop::CourseboardTabsState>()
                    .selected_label();
                if let Err(error) = macos_desktop::close_tab(app, &label) {
                    log::error!("failed to close tab: {error}");
                }
            }
        });

    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .manage(native_auth::NativeAuthCallbackState::default())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Bundles register the static scheme. Runtime registration keeps
            // Windows debug builds and Linux/AppImage development usable too.
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            app.deep_link().register_all()?;

            let app_handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                collect_native_auth_callbacks(
                    app_handle
                        .state::<native_auth::NativeAuthCallbackState>()
                        .inner(),
                    event.urls(),
                );
            });

            // Subscribe first, then read the cold-start value. The queue
            // deduplicates an URL if it arrives through both paths.
            if let Some(urls) = app.deep_link().get_current()? {
                collect_native_auth_callbacks(
                    app.state::<native_auth::NativeAuthCallbackState>().inner(),
                    urls,
                );
            }

            // The simulator is a desktop development aid. Mobile uses the same
            // React UI but must not bind a local TCP listener in the app sandbox.
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            std::thread::spawn(|| {
                let rt = tokio::runtime::Builder::new_multi_thread()
                    .enable_all()
                    .build()
                    .expect("failed to start tokio runtime");
                rt.block_on(async {
                    if let Err(err) = ws_server::run(ws_server::DEFAULT_BIND).await {
                        log::error!("cart ws server crashed: {err}");
                    }
                });
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_target_os,
            native_auth::native_auth_capabilities,
            native_auth::native_auth_open_authorization_url,
            native_auth::native_auth_take_callback,
            native_auth::open_external_url,
            photon_bridge::photon_engine_apply_operation,
            #[cfg(any(target_os = "macos", windows))]
            macos_desktop::list_courseboard_tabs,
            #[cfg(any(target_os = "macos", windows))]
            macos_desktop::create_courseboard_tab,
            #[cfg(any(target_os = "macos", windows))]
            macos_desktop::mark_courseboard_tab_content_ready,
            #[cfg(any(target_os = "macos", windows))]
            macos_desktop::activate_courseboard_tab,
            #[cfg(any(target_os = "macos", windows))]
            macos_desktop::close_courseboard_tab,
            #[cfg(any(target_os = "macos", windows))]
            macos_desktop::update_courseboard_tab_title,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
