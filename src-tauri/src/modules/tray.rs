use tauri::{
    menu::{Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Runtime,
};

const TRAY_ID: &str = "main-tray";

#[derive(Clone, Copy)]
struct TrayLabels {
    show_hide: &'static str,
    new_terminal: &'static str,
    new_preview: &'static str,
    quit: &'static str,
    tooltip: &'static str,
}

fn tray_labels(language: &str) -> TrayLabels {
    match language {
        "es" => TrayLabels {
            show_hide: "Mostrar / Ocultar Voktty",
            new_terminal: "Nueva terminal",
            new_preview: "Nueva vista previa web",
            quit: "Salir de Voktty",
            tooltip: "Voktty - Terminal y espacio de trabajo con IA",
        },
        "pt" => TrayLabels {
            show_hide: "Mostrar / Ocultar Voktty",
            new_terminal: "Novo terminal",
            new_preview: "Nova pré-visualização web",
            quit: "Sair do Voktty",
            tooltip: "Voktty - Terminal e espaço de trabalho com IA",
        },
        "fr" => TrayLabels {
            show_hide: "Afficher / Masquer Voktty",
            new_terminal: "Nouveau terminal",
            new_preview: "Nouvel aperçu web",
            quit: "Quitter Voktty",
            tooltip: "Voktty - Terminal et espace de travail IA",
        },
        "de" => TrayLabels {
            show_hide: "Voktty anzeigen / ausblenden",
            new_terminal: "Neues Terminal",
            new_preview: "Neue Webvorschau",
            quit: "Voktty beenden",
            tooltip: "Voktty - KI-Terminal und Arbeitsbereich",
        },
        "it" => TrayLabels {
            show_hide: "Mostra / Nascondi Voktty",
            new_terminal: "Nuovo terminale",
            new_preview: "Nuova anteprima web",
            quit: "Esci da Voktty",
            tooltip: "Voktty - Terminal e spazio di lavoro con IA",
        },
        "zh" => TrayLabels {
            show_hide: "显示 / 隐藏 Voktty",
            new_terminal: "新建终端",
            new_preview: "新建网页预览",
            quit: "退出 Voktty",
            tooltip: "Voktty - AI 终端和工作区",
        },
        "ja" => TrayLabels {
            show_hide: "Voktty を表示 / 非表示",
            new_terminal: "新しいターミナル",
            new_preview: "新しい Web プレビュー",
            quit: "Voktty を終了",
            tooltip: "Voktty - AI ターミナルとワークスペース",
        },
        "ko" => TrayLabels {
            show_hide: "Voktty 표시 / 숨기기",
            new_terminal: "새 터미널",
            new_preview: "새 웹 미리보기",
            quit: "Voktty 종료",
            tooltip: "Voktty - AI 터미널 및 작업 공간",
        },
        "ru" => TrayLabels {
            show_hide: "Показать / скрыть Voktty",
            new_terminal: "Новый терминал",
            new_preview: "Новое веб-превью",
            quit: "Выйти из Voktty",
            tooltip: "Voktty - ИИ-терминал и рабочее пространство",
        },
        "hi" => TrayLabels {
            show_hide: "Voktty दिखाएं / छिपाएं",
            new_terminal: "नया टर्मिनल",
            new_preview: "नया वेब प्रीव्यू",
            quit: "Voktty से बाहर निकलें",
            tooltip: "Voktty - AI टर्मिनल और कार्यक्षेत्र",
        },
        "ar" => TrayLabels {
            show_hide: "إظهار / إخفاء Voktty",
            new_terminal: "طرفية جديدة",
            new_preview: "معاينة ويب جديدة",
            quit: "الخروج من Voktty",
            tooltip: "Voktty - طرفية ومساحة عمل بالذكاء الاصطناعي",
        },
        _ => TrayLabels {
            show_hide: "Show / Hide Voktty",
            new_terminal: "New terminal",
            new_preview: "New web preview",
            quit: "Quit Voktty",
            tooltip: "Voktty - AI Terminal and Workspace",
        },
    }
}

fn build_menu<R: Runtime>(app: &AppHandle<R>, labels: TrayLabels) -> tauri::Result<Menu<R>> {
    let show_hide = MenuItemBuilder::with_id("show_hide", labels.show_hide).build(app)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let new_terminal = MenuItemBuilder::with_id("new_terminal", labels.new_terminal).build(app)?;
    let new_preview = MenuItemBuilder::with_id("new_preview", labels.new_preview).build(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItemBuilder::with_id("quit", labels.quit).build(app)?;

    MenuBuilder::new(app)
        .item(&show_hide)
        .item(&sep1)
        .item(&new_terminal)
        .item(&new_preview)
        .item(&sep2)
        .item(&quit)
        .build()
}

pub fn setup_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let labels = tray_labels("en");
    let menu = build_menu(app, labels)?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip(labels.tooltip)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show_hide" => {
                toggle_window(app);
            }
            "new_terminal" => {
                show_and_focus(app);
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.emit("tray-new-terminal", ());
                }
            }
            "new_preview" => {
                show_and_focus(app);
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.emit("tray-new-preview", ());
                }
            }
            "quit" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.emit("voktty:request-app-close", ());
                }
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                toggle_window(app);
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app)?;

    Ok(())
}

#[tauri::command]
pub async fn tray_set_language(app: AppHandle, language: String) -> Result<(), String> {
    let labels = tray_labels(&language);
    let menu = build_menu(&app, labels).map_err(|error| error.to_string())?;
    let tray = app
        .tray_by_id(TRAY_ID)
        .ok_or_else(|| "system tray is not available".to_string())?;
    tray.set_menu(Some(menu))
        .map_err(|error| error.to_string())?;
    tray.set_tooltip(Some(labels.tooltip))
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn toggle_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let is_visible = window.is_visible().unwrap_or(false);
        let is_minimized = window.is_minimized().unwrap_or(false);
        if is_visible && !is_minimized {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }
}

pub fn show_and_focus<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[tauri::command]
pub async fn tray_toggle_window(app: AppHandle) -> Result<(), String> {
    toggle_window(&app);
    Ok(())
}

#[tauri::command]
pub async fn tray_hide_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn tray_show_window(app: AppHandle) -> Result<(), String> {
    show_and_focus(&app);
    Ok(())
}
