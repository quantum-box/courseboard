use std::{
    collections::{HashMap, HashSet},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};

use tauri::{
    menu::{Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu},
    utils::config::WebviewUrl,
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Runtime, Webview, WebviewBuilder,
};

const NEW_TAB_MENU_ID: &str = "new_tab";
const TAB_WEBVIEW_PREFIX: &str = "courseboard-tab-";
const TABS_CHANGED_EVENT: &str = "courseboard-tabs-changed";
static NEXT_TAB_ID: AtomicU64 = AtomicU64::new(1);

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CourseboardTab {
    label: String,
    title: String,
    selected: bool,
}

pub(crate) struct CourseboardTabsState {
    selected_label: Mutex<String>,
    titles: Mutex<HashMap<String, String>>,
    ready_labels: Mutex<HashSet<String>>,
    activate_when_ready: Mutex<HashSet<String>>,
}

impl Default for CourseboardTabsState {
    fn default() -> Self {
        Self {
            selected_label: Mutex::new("main".to_string()),
            titles: Mutex::new(HashMap::from([(
                "main".to_string(),
                "Course Board".to_string(),
            )])),
            ready_labels: Mutex::new(HashSet::from(["main".to_string()])),
            activate_when_ready: Mutex::new(HashSet::new()),
        }
    }
}

impl CourseboardTabsState {
    pub(crate) fn selected_label(&self) -> String {
        self.selected_label.lock().unwrap().clone()
    }

    fn select(&self, label: &str) {
        *self.selected_label.lock().unwrap() = label.to_string();
    }

    fn title(&self, label: &str) -> String {
        self.titles
            .lock()
            .unwrap()
            .get(label)
            .cloned()
            .unwrap_or_else(|| "Course Board".to_string())
    }

    fn set_title(&self, label: &str, title: String) {
        self.titles.lock().unwrap().insert(label.to_string(), title);
    }

    fn is_ready(&self, label: &str) -> bool {
        self.ready_labels.lock().unwrap().contains(label)
    }

    fn mark_ready(&self, label: &str) {
        self.ready_labels.lock().unwrap().insert(label.to_string());
    }

    fn set_activate_when_ready(&self, label: &str, activate: bool) {
        if activate {
            self.activate_when_ready
                .lock()
                .unwrap()
                .insert(label.to_string());
        }
    }

    fn take_activate_when_ready(&self, label: &str) -> bool {
        self.activate_when_ready.lock().unwrap().remove(label)
    }

    fn remove(&self, label: &str) {
        self.titles.lock().unwrap().remove(label);
        self.ready_labels.lock().unwrap().remove(label);
        self.activate_when_ready.lock().unwrap().remove(label);
    }
}

fn next_tab_label() -> String {
    let id = NEXT_TAB_ID.fetch_add(1, Ordering::Relaxed);
    format!("{TAB_WEBVIEW_PREFIX}{id}")
}

pub(crate) fn menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let menu = Menu::default(app)?;
    let new_tab = MenuItem::with_id(
        app,
        NEW_TAB_MENU_ID,
        "新しいタブ",
        true,
        Some("CmdOrCtrl+T"),
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let file_menu = menu.items()?.into_iter().find_map(|item| match item {
        MenuItemKind::Submenu(submenu) if submenu.text().ok().as_deref() == Some("File") => {
            Some(submenu)
        }
        _ => None,
    });
    if let Some(file_menu) = file_menu {
        file_menu.prepend_items(&[&new_tab, &separator])?;
    } else {
        let file_menu = Submenu::with_items(app, "File", true, &[&new_tab, &separator])?;
        menu.prepend(&file_menu)?;
    }

    #[cfg(feature = "web-distribution")]
    crate::updater::add_menu_item(app, &menu)?;

    Ok(menu)
}

pub(crate) fn handle_menu_event(app: &AppHandle, id: &str) {
    if id == NEW_TAB_MENU_ID {
        if let Err(error) = open_new_tab(app, None, true).and_then(|()| emit_tabs_changed(app)) {
            log::error!("failed to open a new tab: {error}");
        }
    }

    #[cfg(feature = "web-distribution")]
    if id == crate::updater::CHECK_FOR_UPDATES_MENU_ID {
        crate::updater::start_update_check(app.clone(), true);
    }
}

fn validated_app_path(path: Option<&str>) -> Option<String> {
    let path = path?.trim();
    if path.starts_with("http:") || path.starts_with("https:") || path.starts_with("//") {
        return None;
    }
    Some(path.trim_start_matches('/').to_string())
}

fn open_new_tab<R: Runtime>(
    app: &AppHandle<R>,
    path: Option<&str>,
    activate: bool,
) -> tauri::Result<()> {
    let window = app.get_window("main").ok_or(tauri::Error::WindowNotFound)?;
    let state = app.state::<CourseboardTabsState>();
    let mut config = app
        .config()
        .app
        .windows
        .first()
        .cloned()
        .ok_or(tauri::Error::WindowNotFound)?;
    let label = next_tab_label();
    config.label.clone_from(&label);
    if let Some(path) = validated_app_path(path) {
        config.url = WebviewUrl::App(path.into());
    }
    state.set_title(&label, "Course Board".to_string());
    state.set_activate_when_ready(&label, activate);
    let size = window.inner_size()?;
    let offscreen_x = -i32::try_from(size.width).unwrap_or(i32::MAX);
    let builder = WebviewBuilder::from_config(&config).focused(false);
    if let Err(error) = window.add_child(
        builder,
        PhysicalPosition::new(offscreen_x, 0),
        PhysicalSize::new(size.width, size.height),
    ) {
        state.remove(&label);
        return Err(error);
    }
    Ok(())
}

fn emit_tabs_changed<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    app.emit(TABS_CHANGED_EVENT, ())
}

fn tab_sort_key(label: &str) -> u64 {
    if label == "main" {
        0
    } else {
        label
            .strip_prefix(TAB_WEBVIEW_PREFIX)
            .and_then(|id| id.parse::<u64>().ok())
            .unwrap_or(u64::MAX)
    }
}

fn sorted_webviews<R: Runtime>(app: &AppHandle<R>) -> Vec<Webview<R>> {
    let mut webviews = app
        .webviews()
        .into_values()
        .filter(|webview| {
            webview.label() == "main" || webview.label().starts_with(TAB_WEBVIEW_PREFIX)
        })
        .collect::<Vec<_>>();
    webviews.sort_by_key(|webview| tab_sort_key(webview.label()));
    webviews
}

fn show_tab_in_place<R: Runtime>(current: &Webview<R>, target: &Webview<R>) -> tauri::Result<()> {
    if current.label() == target.label() {
        return Ok(());
    }
    target.show()?;
    target.set_focus()?;
    current.hide()?;
    Ok(())
}

fn activate_tab<R: Runtime>(app: &AppHandle<R>, label: &str) -> tauri::Result<()> {
    let state = app.state::<CourseboardTabsState>();
    if !state.is_ready(label) {
        return Ok(());
    }
    let current = app
        .get_webview(&state.selected_label())
        .ok_or(tauri::Error::WindowNotFound)?;
    let target = app.get_webview(label).ok_or(tauri::Error::WindowNotFound)?;
    show_tab_in_place(&current, &target)?;
    state.select(label);
    target.window().set_title(&state.title(label))?;
    emit_tabs_changed(app)
}

fn preferred_successor_label<'a>(
    tabs: impl Iterator<Item = (&'a str, bool)>,
    closing_label: &str,
) -> Option<String> {
    let candidates = tabs
        .filter(|(label, _)| *label != closing_label)
        .collect::<Vec<_>>();
    candidates
        .iter()
        .find(|(_, ready)| *ready)
        .or_else(|| candidates.first())
        .map(|(label, _)| (*label).to_string())
}

pub(crate) fn close_tab<R: Runtime>(app: &AppHandle<R>, label: &str) -> tauri::Result<()> {
    let state = app.state::<CourseboardTabsState>();
    let tabs = sorted_webviews(app);
    if tabs.len() == 1 {
        tabs[0].window().destroy()?;
        return Ok(());
    }
    let target = app.get_webview(label).ok_or(tauri::Error::WindowNotFound)?;
    if label == state.selected_label() {
        let next_label = preferred_successor_label(
            tabs.iter()
                .map(|tab| (tab.label(), state.is_ready(tab.label()))),
            label,
        )
        .ok_or(tauri::Error::WindowNotFound)?;
        let next = app
            .get_webview(&next_label)
            .ok_or(tauri::Error::WindowNotFound)?;
        if state.is_ready(next.label()) {
            show_tab_in_place(&target, &next)?;
        } else {
            state.set_activate_when_ready(next.label(), true);
        }
        state.select(next.label());
        next.window().set_title(&state.title(next.label()))?;
    }
    target.close()?;
    state.remove(label);
    emit_tabs_changed(app)
}

#[tauri::command]
pub(crate) fn list_courseboard_tabs(app: AppHandle) -> Vec<CourseboardTab> {
    let state = app.state::<CourseboardTabsState>();
    let selected_label = state.selected_label();
    sorted_webviews(&app)
        .into_iter()
        .map(|tab| CourseboardTab {
            label: tab.label().to_string(),
            title: state.title(tab.label()),
            selected: tab.label() == selected_label,
        })
        .collect()
}

#[tauri::command]
pub(crate) fn create_courseboard_tab(
    app: AppHandle,
    path: Option<String>,
    activate: bool,
) -> tauri::Result<()> {
    open_new_tab(&app, path.as_deref(), activate)?;
    emit_tabs_changed(&app)
}

#[tauri::command]
pub(crate) fn mark_courseboard_tab_content_ready(
    app: AppHandle,
    webview: Webview,
) -> tauri::Result<()> {
    let state = app.state::<CourseboardTabsState>();
    if state.is_ready(webview.label()) {
        return Ok(());
    }
    let activate = state.take_activate_when_ready(webview.label());
    if activate {
        let current = app.get_webview(&state.selected_label());
        webview.set_position(PhysicalPosition::new(0, 0))?;
        webview.set_auto_resize(true)?;
        state.mark_ready(webview.label());
        webview.show()?;
        webview.set_focus()?;
        if let Some(current) = current {
            if current.label() != webview.label() {
                current.hide()?;
            }
        }
        state.select(webview.label());
        webview.window().set_title(&state.title(webview.label()))?;
    } else {
        webview.hide()?;
        webview.set_position(PhysicalPosition::new(0, 0))?;
        webview.set_auto_resize(true)?;
        state.mark_ready(webview.label());
    }
    emit_tabs_changed(&app)
}

#[tauri::command]
pub(crate) fn activate_courseboard_tab(app: AppHandle, label: String) -> tauri::Result<()> {
    activate_tab(&app, &label)
}

#[tauri::command]
pub(crate) fn close_courseboard_tab(app: AppHandle, label: String) -> tauri::Result<()> {
    close_tab(&app, &label)
}

#[tauri::command]
pub(crate) fn update_courseboard_tab_title(
    app: AppHandle,
    webview: Webview,
    title: String,
) -> tauri::Result<()> {
    let state = app.state::<CourseboardTabsState>();
    state.set_title(webview.label(), title.clone());
    if webview.label() == state.selected_label() {
        webview.window().set_title(&title)?;
    }
    emit_tabs_changed(&app)
}

#[cfg(test)]
mod tests {
    use super::{
        next_tab_label, preferred_successor_label, tab_sort_key, validated_app_path,
        CourseboardTabsState, TAB_WEBVIEW_PREFIX,
    };

    #[test]
    fn tab_labels_are_unique_and_prefixed() {
        let first = next_tab_label();
        let second = next_tab_label();
        assert!(first.starts_with(TAB_WEBVIEW_PREFIX));
        assert_ne!(first, second);
    }

    #[test]
    fn tab_sort_keeps_main_first() {
        assert_eq!(tab_sort_key("main"), 0);
        assert_eq!(tab_sort_key("courseboard-tab-10"), 10);
    }

    #[test]
    fn activation_waits_for_ready_and_is_consumed_once() {
        let state = CourseboardTabsState::default();
        state.set_activate_when_ready("courseboard-tab-1", true);
        assert!(!state.is_ready("courseboard-tab-1"));
        assert!(state.take_activate_when_ready("courseboard-tab-1"));
        assert!(!state.take_activate_when_ready("courseboard-tab-1"));
    }

    #[test]
    fn close_prefers_a_ready_successor() {
        let next = preferred_successor_label(
            [("main", true), ("courseboard-tab-1", false)].into_iter(),
            "courseboard-tab-1",
        );
        assert_eq!(next.as_deref(), Some("main"));
    }

    #[test]
    fn new_tabs_only_accept_app_paths() {
        assert_eq!(validated_app_path(Some("/#/golf")), Some("#/golf".into()));
        assert_eq!(validated_app_path(Some("https://example.com")), None);
    }
}
