//! Desktop notifications for turns that end or stall while the window is in
//! the background.

use serde::Serialize;
use tauri::AppHandle;

/// Emitted to every window when the user clicks a notification. Payload is
/// the session id; the window that owns that session handles it.
pub const CLICK_EVENT: &str = "voktty:notification-click";

#[cfg(target_os = "macos")]
pub use platform::install_delegate;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Permission {
    /// Never asked, or not yet answered.
    Prompt,
    Granted,
    /// Declined at the prompt, or alerts switched off in System Settings.
    Denied,
    /// No notification backend on this platform.
    Unsupported,
}

#[tauri::command]
pub async fn notification_permission(app: AppHandle) -> Permission {
    platform::permission(&app).await
}

#[tauri::command]
pub async fn request_notification_permission(app: AppHandle) -> Permission {
    platform::request_permission(&app).await
}

/// Resolves only once the platform reports the banner as scheduled: the
/// frontend skips its own turn-finished cue on success, so returning early
/// would silence a turn that never got a notification.
#[tauri::command]
pub async fn show_notification(
    app: AppHandle,
    session_id: String,
    title: String,
    subtitle: String,
    body: String,
    sound: bool,
) -> Result<(), String> {
    platform::show(&app, &session_id, &title, &subtitle, &body, sound).await
}

/// Opens the app's page in the OS notification settings, where the user can
/// re-enable alerts after declining the prompt.
#[tauri::command]
pub fn open_notification_settings(app: AppHandle) -> Result<(), String> {
    platform::open_settings(&app)
}

#[cfg(target_os = "macos")]
mod platform {
    use std::cell::RefCell;
    use std::ptr::NonNull;
    use std::sync::mpsc;
    use std::time::Duration;

    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::{Bool, NSObject, NSObjectProtocol, ProtocolObject};
    use objc2::{define_class, ClassType, DefinedClass, MainThreadMarker};
    use objc2_foundation::{NSArray, NSError, NSSet, NSString};
    use objc2_user_notifications::{
        UNAlertStyle, UNAuthorizationOptions, UNAuthorizationStatus, UNMutableNotificationContent,
        UNNotification, UNNotificationAction, UNNotificationActionOptions, UNNotificationCategory,
        UNNotificationCategoryOptions, UNNotificationPresentationOptions, UNNotificationRequest,
        UNNotificationResponse, UNNotificationSetting, UNNotificationSettings, UNNotificationSound,
        UNUserNotificationCenter, UNUserNotificationCenterDelegate,
    };
    use tauri::{AppHandle, Emitter};

    use super::{Permission, CLICK_EVENT};

    const ID_PREFIX: &str = "session:";

    fn request_identifier(session_id: &str) -> String {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        format!("{ID_PREFIX}{session_id}/{nanos}")
    }

    fn session_from_identifier(identifier: &str) -> Option<&str> {
        let rest = identifier.strip_prefix(ID_PREFIX)?;
        Some(rest.split('/').next().unwrap_or(rest))
    }

    const CATEGORY: &str = "voktty.session";
    const SHOW_ACTION: &str = "voktty.session.show";

    fn options() -> UNAuthorizationOptions {
        UNAuthorizationOptions::Alert
            | UNAuthorizationOptions::Sound
            | UNAuthorizationOptions::Badge
    }

    fn map_permission(
        authorization: UNAuthorizationStatus,
        alert_setting: UNNotificationSetting,
        alert_style: UNAlertStyle,
    ) -> Permission {
        match authorization {
            UNAuthorizationStatus::NotDetermined => Permission::Prompt,
            UNAuthorizationStatus::Denied => Permission::Denied,
            _ if alert_setting == UNNotificationSetting::Disabled
                || alert_style == UNAlertStyle::None =>
            {
                Permission::Denied
            }
            _ => Permission::Granted,
        }
    }

    fn map_settings(settings: &UNNotificationSettings) -> Permission {
        map_permission(
            settings.authorizationStatus(),
            settings.alertSetting(),
            settings.alertStyle(),
        )
    }

    fn query_permission() -> mpsc::Receiver<Permission> {
        let (tx, rx) = mpsc::channel();
        let handler = RcBlock::new(move |settings: NonNull<UNNotificationSettings>| {
            let settings = unsafe { settings.as_ref() };
            let _ = tx.send(map_settings(settings));
        });
        UNUserNotificationCenter::currentNotificationCenter()
            .getNotificationSettingsWithCompletionHandler(&handler);
        rx
    }

    fn start_request() -> mpsc::Receiver<()> {
        let (tx, rx) = mpsc::channel();
        let handler = RcBlock::new(move |_granted: Bool, _error: *mut NSError| {
            let _ = tx.send(());
        });
        UNUserNotificationCenter::currentNotificationCenter()
            .requestAuthorizationWithOptions_completionHandler(options(), &handler);
        rx
    }

    const DISPATCH_TIMEOUT: Duration = Duration::from_secs(5);

    async fn wait<T: Send + 'static>(
        rx: mpsc::Receiver<T>,
        timeout: Option<Duration>,
    ) -> Option<T> {
        tauri::async_runtime::spawn_blocking(move || match timeout {
            Some(timeout) => rx.recv_timeout(timeout).ok(),
            None => rx.recv().ok(),
        })
        .await
        .ok()
        .flatten()
    }

    pub(super) async fn permission(_app: &AppHandle) -> Permission {
        wait(query_permission(), None)
            .await
            .unwrap_or(Permission::Denied)
    }

    pub(super) async fn request_permission(app: &AppHandle) -> Permission {
        wait(start_request(), None).await;
        permission(app).await
    }

    fn start_show(
        session_id: &str,
        title: &str,
        subtitle: &str,
        body: &str,
        sound: bool,
    ) -> mpsc::Receiver<Result<(), String>> {
        let content = UNMutableNotificationContent::new();
        content.setTitle(&NSString::from_str(title));
        content.setSubtitle(&NSString::from_str(subtitle));
        content.setBody(&NSString::from_str(body));
        content.setCategoryIdentifier(&NSString::from_str(CATEGORY));
        if sound {
            content.setSound(Some(&UNNotificationSound::defaultSound()));
        }
        let identifier = NSString::from_str(&request_identifier(session_id));
        let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
            &identifier,
            &content,
            None,
        );
        let (tx, rx) = mpsc::channel();
        let handler = RcBlock::new(move |error: *mut NSError| {
            let result = match NonNull::new(error) {
                Some(error) => Err(format!("notification rejected: {}", unsafe {
                    error.as_ref()
                })),
                None => Ok(()),
            };
            let _ = tx.send(result);
        });
        UNUserNotificationCenter::currentNotificationCenter()
            .addNotificationRequest_withCompletionHandler(&request, Some(&handler));
        rx
    }

    pub(super) async fn show(
        _app: &AppHandle,
        session_id: &str,
        title: &str,
        subtitle: &str,
        body: &str,
        sound: bool,
    ) -> Result<(), String> {
        if wait(query_permission(), Some(DISPATCH_TIMEOUT)).await != Some(Permission::Granted) {
            return Err("notifications are not authorized".into());
        }
        wait(
            start_show(session_id, title, subtitle, body, sound),
            Some(DISPATCH_TIMEOUT),
        )
        .await
        .unwrap_or_else(|| Err("notification dispatch timed out".into()))
    }

    pub(super) fn open_settings(app: &AppHandle) -> Result<(), String> {
        let url = format!(
            "x-apple.systempreferences:com.apple.Notifications-Settings.extension?id={}",
            app.config().identifier
        );
        std::process::Command::new("open")
            .arg(url)
            .spawn()
            .map(|_| ())
            .map_err(|err| err.to_string())
    }

    struct DelegateIvars {
        app: AppHandle,
    }

    define_class!(
        #[unsafe(super(NSObject))]
        #[name = "VokttyNotificationDelegate"]
        #[ivars = DelegateIvars]
        struct Delegate;

        unsafe impl NSObjectProtocol for Delegate {}

        unsafe impl UNUserNotificationCenterDelegate for Delegate {
            #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
            fn will_present(
                &self,
                _center: &UNUserNotificationCenter,
                _notification: &UNNotification,
                completion: &block2::DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
            ) {
                completion.call((UNNotificationPresentationOptions::Banner
                    | UNNotificationPresentationOptions::List
                    | UNNotificationPresentationOptions::Sound,));
            }

            #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
            fn did_receive(
                &self,
                _center: &UNUserNotificationCenter,
                response: &UNNotificationResponse,
                completion: &block2::DynBlock<dyn Fn()>,
            ) {
                let identifier = response.notification().request().identifier().to_string();
                if let Some(session_id) = session_from_identifier(&identifier) {
                    let _ = self.ivars().app.emit(CLICK_EVENT, session_id);
                }
                completion.call(());
            }
        }
    );

    thread_local! {
        static DELEGATE: RefCell<Option<Retained<Delegate>>> = const { RefCell::new(None) };
    }

    pub fn install_delegate(app: &AppHandle) {
        if MainThreadMarker::new().is_none() {
            return;
        }
        let delegate = Delegate::alloc().set_ivars(DelegateIvars { app: app.clone() });
        let delegate: Retained<Delegate> = unsafe { objc2::msg_send![super(delegate), init] };
        let center = UNUserNotificationCenter::currentNotificationCenter();
        center.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
        DELEGATE.with(|slot| *slot.borrow_mut() = Some(delegate));

        let show = UNNotificationAction::actionWithIdentifier_title_options(
            &NSString::from_str(SHOW_ACTION),
            &NSString::from_str("Show"),
            UNNotificationActionOptions::Foreground,
        );
        let category =
            UNNotificationCategory::categoryWithIdentifier_actions_intentIdentifiers_options(
                &NSString::from_str(CATEGORY),
                &NSArray::from_retained_slice(&[show]),
                &NSArray::new(),
                UNNotificationCategoryOptions::empty(),
            );
        center.setNotificationCategories(&NSSet::from_retained_slice(&[category]));
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use tauri::AppHandle;
    use tauri_plugin_notification::NotificationExt;

    use super::Permission;

    pub(super) async fn permission(app: &AppHandle) -> Permission {
        match app.notification().permission_state() {
            Ok(tauri_plugin_notification::PermissionState::Granted) => Permission::Granted,
            Ok(tauri_plugin_notification::PermissionState::Denied) => Permission::Denied,
            Ok(tauri_plugin_notification::PermissionState::Prompt)
            | Ok(tauri_plugin_notification::PermissionState::PromptWithRationale) => {
                Permission::Prompt
            }
            Err(_) => Permission::Granted,
        }
    }

    pub(super) async fn request_permission(app: &AppHandle) -> Permission {
        match app.notification().request_permission() {
            Ok(tauri_plugin_notification::PermissionState::Granted) => Permission::Granted,
            Ok(tauri_plugin_notification::PermissionState::Denied) => Permission::Denied,
            _ => Permission::Granted,
        }
    }

    pub(super) async fn show(
        app: &AppHandle,
        _session_id: &str,
        title: &str,
        subtitle: &str,
        body: &str,
        sound: bool,
    ) -> Result<(), String> {
        let full_title = if subtitle.is_empty() {
            title.to_string()
        } else {
            format!("{title} · {subtitle}")
        };
        let mut builder = app.notification().builder();
        builder = builder.title(full_title).body(body);
        if sound {
            builder = builder.sound("Default".to_string());
        }
        builder.show().map_err(|e| e.to_string())
    }

    pub(super) fn open_settings(_app: &AppHandle) -> Result<(), String> {
        std::process::Command::new("cmd")
            .args(["/c", "start", "ms-settings:notifications"])
            .spawn()
            .map(|_| ())
            .map_err(|err| err.to_string())
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod platform {
    use tauri::AppHandle;
    use tauri_plugin_notification::NotificationExt;

    use super::Permission;

    pub(super) async fn permission(app: &AppHandle) -> Permission {
        match app.notification().permission_state() {
            Ok(tauri_plugin_notification::PermissionState::Granted) => Permission::Granted,
            Ok(tauri_plugin_notification::PermissionState::Denied) => Permission::Denied,
            _ => Permission::Prompt,
        }
    }

    pub(super) async fn request_permission(app: &AppHandle) -> Permission {
        match app.notification().request_permission() {
            Ok(tauri_plugin_notification::PermissionState::Granted) => Permission::Granted,
            Ok(tauri_plugin_notification::PermissionState::Denied) => Permission::Denied,
            _ => Permission::Granted,
        }
    }

    pub(super) async fn show(
        app: &AppHandle,
        _session_id: &str,
        title: &str,
        subtitle: &str,
        body: &str,
        sound: bool,
    ) -> Result<(), String> {
        let full_title = if subtitle.is_empty() {
            title.to_string()
        } else {
            format!("{title}: {subtitle}")
        };
        let mut builder = app.notification().builder();
        builder = builder.title(full_title).body(body);
        if sound {
            builder = builder.sound("Default".to_string());
        }
        builder.show().map_err(|e| e.to_string())
    }

    pub(super) fn open_settings(_app: &AppHandle) -> Result<(), String> {
        Err("notifications settings not supported on this platform".into())
    }
}
