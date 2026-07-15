use serde::Serialize;
use std::collections::VecDeque;
use std::sync::Mutex;
use tauri_plugin_opener::OpenerExt;

const CALLBACK_URL: &str = "courseboard://oauth/callback";
const MAX_PENDING_CALLBACKS: usize = 8;

#[derive(Default)]
pub struct NativeAuthCallbackState {
    pending: Mutex<VecDeque<String>>,
}

impl NativeAuthCallbackState {
    // The Tauri deep-link plugin calls this for cold starts and for URLs opened
    // while the app is running. JavaScript still validates redirect, expiry,
    // and OAuth state before exchanging the code.
    pub fn push_callback(&self, callback_url: String) -> Result<(), String> {
        if !is_callback_url(&callback_url) {
            return Err("unregistered native auth callback".to_owned());
        }
        let mut pending = self
            .pending
            .lock()
            .map_err(|_| "native auth callback lock is unavailable".to_owned())?;
        if pending.contains(&callback_url) {
            return Ok(());
        }
        if pending.len() == MAX_PENDING_CALLBACKS {
            pending.pop_front();
        }
        pending.push_back(callback_url);
        Ok(())
    }

    fn take_callback(&self) -> Result<Option<String>, String> {
        self.pending
            .lock()
            .map_err(|_| "native auth callback lock is unavailable".to_owned())
            .map(|mut pending| pending.pop_front())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAuthCapabilities {
    external_browser: bool,
    callback_mode: &'static str,
}

fn is_callback_url(candidate: &str) -> bool {
    if candidate.len() > 4096
        || candidate.chars().any(|character| {
            character.is_control() || character.is_whitespace() || character == '\\'
        })
    {
        return false;
    }
    let Ok(url) = tauri::Url::parse(candidate) else {
        return false;
    };
    let expected = tauri::Url::parse(CALLBACK_URL).expect("native callback constant must be a URL");
    url.scheme() == expected.scheme()
        && url.username() == expected.username()
        && url.password() == expected.password()
        && url.host_str() == expected.host_str()
        && url.port() == expected.port()
        && url.path() == expected.path()
        && url.fragment().is_none()
}

fn validate_external_https_url(url: &str) -> Result<(), String> {
    let parsed =
        tauri::Url::parse(url).map_err(|_| "external URL must be a valid HTTPS URL".to_owned())?;
    if url.len() > 4096
        || parsed.scheme() != "https"
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || url.chars().any(|character| {
            character.is_control() || character.is_whitespace() || character == '\\'
        })
    {
        return Err("external URL must be a valid HTTPS URL".to_owned());
    }
    Ok(())
}

#[tauri::command]
pub fn native_auth_capabilities() -> NativeAuthCapabilities {
    #[cfg(any(target_os = "ios", target_os = "android"))]
    return NativeAuthCapabilities {
        external_browser: true,
        callback_mode: "tauri-deep-link",
    };

    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    NativeAuthCapabilities {
        external_browser: true,
        callback_mode: "tauri-deep-link-single-instance",
    }
}

#[tauri::command]
pub fn native_auth_take_callback(
    state: tauri::State<'_, NativeAuthCallbackState>,
) -> Result<Option<String>, String> {
    state.take_callback()
}

#[tauri::command]
pub fn open_external_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    validate_external_https_url(&url)?;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|error| format!("failed to open the system browser: {error}"))
}

#[tauri::command]
pub fn native_auth_open_authorization_url(
    app: tauri::AppHandle,
    url: String,
) -> Result<(), String> {
    open_external_url(app, url)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_registered_callback_is_collected() {
        assert!(is_callback_url(CALLBACK_URL));
        assert!(is_callback_url(
            "courseboard://oauth/callback?code=code&state=state"
        ));
        assert!(!is_callback_url(
            "courseboard://attacker/callback?code=code"
        ));
        assert!(!is_callback_url(
            "courseboard://oauth/callback/extra?code=code"
        ));
        assert!(!is_callback_url(
            "courseboard://oauth/callback?code=code#fragment"
        ));
        assert!(!is_callback_url("https://example.com/oauth/callback"));
    }

    #[test]
    fn callbacks_are_deduplicated_and_taken_in_order() {
        let state = NativeAuthCallbackState::default();
        let first = "courseboard://oauth/callback?code=first&state=state";
        let second = "courseboard://oauth/callback?code=second&state=state";

        state.push_callback(first.to_owned()).unwrap();
        state.push_callback(first.to_owned()).unwrap();
        state.push_callback(second.to_owned()).unwrap();

        assert_eq!(state.take_callback().unwrap().as_deref(), Some(first));
        assert_eq!(state.take_callback().unwrap().as_deref(), Some(second));
        assert_eq!(state.take_callback().unwrap(), None);
    }

    #[test]
    fn browser_url_must_be_https_without_control_characters() {
        assert!(validate_external_https_url("https://auth.example.com/oauth2/authorize").is_ok());
        assert!(validate_external_https_url("http://auth.example.com").is_err());
        assert!(validate_external_https_url("https://user:password@auth.example.com").is_err());
        assert!(validate_external_https_url("https://").is_err());
        assert!(validate_external_https_url("https://auth.example.com/\nattack").is_err());
    }
}
