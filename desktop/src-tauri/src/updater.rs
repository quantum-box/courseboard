use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{
    menu::{Menu, MenuItem, MenuItemKind},
    AppHandle, Runtime,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;

pub(crate) const CHECK_FOR_UPDATES_MENU_ID: &str = "check_for_updates";
static UPDATE_CHECK_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

pub(crate) fn add_menu_item<R: Runtime>(app: &AppHandle<R>, menu: &Menu<R>) -> tauri::Result<()> {
    let item = MenuItem::with_id(
        app,
        CHECK_FOR_UPDATES_MENU_ID,
        "アップデートを確認…",
        true,
        None::<&str>,
    )?;
    let app_menu = menu.items()?.into_iter().find_map(|item| match item {
        MenuItemKind::Submenu(submenu) if submenu.text().ok().as_deref() != Some("File") => {
            Some(submenu)
        }
        _ => None,
    });
    if let Some(app_menu) = app_menu {
        app_menu.insert(&item, 1)?;
    }
    Ok(())
}

fn show_message(app: &AppHandle, title: &str, message: impl Into<String>, kind: MessageDialogKind) {
    app.dialog()
        .message(message)
        .title(title)
        .kind(kind)
        .buttons(MessageDialogButtons::Ok)
        .show(|_| {});
}

pub(crate) fn start_update_check(app: AppHandle, manual: bool) {
    if UPDATE_CHECK_IN_PROGRESS.swap(true, Ordering::AcqRel) {
        if manual {
            show_message(
                &app,
                "Course Board",
                "アップデートを確認中です。",
                MessageDialogKind::Info,
            );
        }
        return;
    }

    tauri::async_runtime::spawn(async move {
        let update = match app.updater() {
            Ok(updater) => updater.check().await,
            Err(error) => Err(error),
        };
        match update {
            Ok(Some(update)) => {
                let notes = update
                    .body
                    .as_deref()
                    .filter(|notes| !notes.trim().is_empty())
                    .unwrap_or("改善と不具合修正を含む新しいバージョンです。");
                let message = format!(
                    "バージョン {} を利用できます。\n\n{}\n\n更新して再起動しますか？",
                    update.version, notes
                );
                let install_app = app.clone();
                app.dialog()
                    .message(message)
                    .title("Course Board アップデート")
                    .kind(MessageDialogKind::Info)
                    .buttons(MessageDialogButtons::OkCancelCustom(
                        "更新して再起動".to_string(),
                        "後で".to_string(),
                    ))
                    .show(move |confirmed| {
                        if !confirmed {
                            UPDATE_CHECK_IN_PROGRESS.store(false, Ordering::Release);
                            return;
                        }
                        tauri::async_runtime::spawn(async move {
                            let result = update.download_and_install(|_, _| {}, || {}).await;
                            UPDATE_CHECK_IN_PROGRESS.store(false, Ordering::Release);
                            match result {
                                Ok(()) => install_app.restart(),
                                Err(error) => show_message(
                                    &install_app,
                                    "アップデート失敗",
                                    format!(
                                        "アップデートをインストールできませんでした。\n\n{error}"
                                    ),
                                    MessageDialogKind::Error,
                                ),
                            }
                        });
                    });
            }
            Ok(None) => {
                UPDATE_CHECK_IN_PROGRESS.store(false, Ordering::Release);
                if manual {
                    show_message(
                        &app,
                        "Course Board",
                        "最新バージョンを利用しています。",
                        MessageDialogKind::Info,
                    );
                }
            }
            Err(error) => {
                UPDATE_CHECK_IN_PROGRESS.store(false, Ordering::Release);
                if manual {
                    show_message(
                        &app,
                        "アップデート確認失敗",
                        format!("アップデートを確認できませんでした。\n\n{error}"),
                        MessageDialogKind::Error,
                    );
                } else {
                    log::warn!("automatic update check failed: {error}");
                }
            }
        }
    });
}
