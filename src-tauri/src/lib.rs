pub(crate) mod identity;
pub(crate) mod launch;
pub mod modules;

use modules::{
    agent, agent_history, api_client, collab, control, dap, docker, extensions, fs, git, git_review, history, lsp, mcp, net,
    pty, rdp, remote, secrets, serial, shell, tray, tunnel, vibrancy, web_server, workspace,
};
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(target_os = "macos")]
use tauri::PhysicalPosition;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_window_state::StateFlags;

#[derive(Default)]
struct ExitCoordinator(AtomicBool);

#[tauri::command]
fn app_exit_after_flush(app: tauri::AppHandle, state: tauri::State<'_, ExitCoordinator>) {
    state.0.store(true, Ordering::Release);
    app.exit(0);
}

#[tauri::command]
async fn open_settings_window(app: tauri::AppHandle, tab: Option<String>) -> Result<(), String> {
    let url_path = match tab.as_deref() {
        Some(t) if !t.is_empty() => format!("settings.html?tab={}", t),
        _ => "settings.html".to_string(),
    };

    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.set_always_on_top(true);
        let _ = window.show();
        let _ = window.set_focus();
        if let Some(t) = tab.as_deref().filter(|s| !s.is_empty()) {
            // emit() serializes via JSON — no string-escape footgun, unlike
            // eval() with format!(). Frontend listens via Tauri event API.
            let _ = window.emit("voktty:settings-tab", t);
        }
        return Ok(());
    }

    let builder = WebviewWindowBuilder::new(&app, "settings", WebviewUrl::App(url_path.into()))
        .title("Settings")
        .inner_size(1020.0, 720.0)
        .min_inner_size(880.0, 600.0)
        .resizable(true)
        .center()
        .visible(false)
        // Keep settings above the main app window so it doesn't get hidden
        // when the user clicks back into the editor or terminal (#33).
        .always_on_top(true);

    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);

    // On Linux/Windows we render our own titlebar, so drop native chrome
    // and make the window transparent.
    #[cfg(any(target_os = "linux", target_os = "windows"))]
    let builder = builder.decorations(false).transparent(true);

    let window = builder.build().map_err(|e| e.to_string())?;

    // Some Linux compositors (GNOME/Mutter with CSD-by-default) ignore the
    // builder-time decorations flag — re-assert it after realize.
    #[cfg(target_os = "linux")]
    {
        let _ = window.set_decorations(false);
    }

    #[cfg(target_os = "windows")]
    {
        let _ = vibrancy::apply_rounded_corners(&window.as_ref().window());
    }

    #[cfg(target_os = "macos")]
    if let Some(main) = app.get_webview_window("main") {
        if let (Ok(main_pos), Ok(main_size), Ok(settings_size)) = (
            main.outer_position(),
            main.outer_size(),
            window.outer_size(),
        ) {
            let x = main_pos.x
                + ((main_size.width as i32).saturating_sub(settings_size.width as i32)) / 2;
            let y = main_pos.y
                + ((main_size.height as i32).saturating_sub(settings_size.height as i32)) / 2;
            let _ = window.set_position(PhysicalPosition::new(x, y));
        } else {
            let _ = window.center();
        }
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    let _ = window;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(windows)]
    {
        let args: Vec<String> = std::env::args().collect();
        if matches!(
            args.get(1).map(String::as_str),
            Some("__voktty_notify" | "__terax_notify")
        ) {
            if let (Some(agent), Some(event)) = (args.get(2), args.get(3)) {
                agent::emit_conout_marker(agent, event);
            }
            use std::io::Write;
            let mut out = std::io::stdout();
            let _ = out.write_all(b"{}");
            let _ = out.flush();
            std::process::exit(0);
        }
    }

    let launch_queue = launch::LaunchQueue::default();
    let initial_request = launch::parse_argv(
        launch::LaunchSource::ColdStart,
        std::env::args(),
        std::env::current_dir()
            .ok()
            .map(|path| path.to_string_lossy().into_owned()),
    );
    let cli_dir = launch::workspace_dir(&initial_request);
    launch_queue.enqueue(initial_request);
    workspace::init_launch_cwd(cli_dir.as_deref());
    let control_state = control::ControlState::default();
    let control_for_setup = control_state.clone();

    let builder = tauri::Builder::default();
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
        launch::focus_main_window(app);
        let request = launch::parse_argv(launch::LaunchSource::SecondInstance, args, Some(cwd));
        launch::enqueue_and_emit(app, request);
    }));
    #[cfg(target_os = "linux")]
    let builder = builder.plugin(tauri_plugin_clipboard_manager::init());
    builder
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Skip restoring VISIBLE — frontend calls window.show() after first
        // paint so the user never sees a transparent window-shadow flash on
        // Windows/Linux.
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                .build(),
        )
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(tauri_plugin_log::log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .setup(move |_app| {
            if let Err(error) = control::start(_app.handle().clone(), control_for_setup.clone()) {
                log::warn!("could not start Voktty control server: {error}");
            }
            if let Err(e) = tray::setup_tray(_app.handle()) {
                log::warn!("could not setup system tray: {e}");
            }
            // Tie settings lifecycle to the main window so settings closes when main closes.
            if let Some(main) = _app.get_webview_window("main") {
                #[cfg(target_os = "windows")]
                {
                    let _ = vibrancy::apply_rounded_corners(&main.as_ref().window());
                }
                let handle = _app.handle().clone();
                main.on_window_event(move |event| {
                    if matches!(
                        event,
                        WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed
                    ) {
                        if let Some(settings) = handle.get_webview_window("settings") {
                            let _ = settings.close();
                        }
                    }
                });
            }
            Ok(())
        })
        .manage(pty::PtyState::default())
        .manage(serial::SerialState::default())
        .manage(remote::RemoteState::default())
        .manage(tunnel::TunnelState::default())
        .manage(control_state)
        .manage(shell::ShellState::default())
        .manage(dap::DapState::default())
        .manage(secrets::SecretsState::default())
        .manage(fs::watch::FsWatchState::default())
        .manage(history::HistoryState::default())
        .manage(web_server::WebServerState::default())
        .manage(lsp::LspState::default())
        .manage(fs::grep::ContentSearchState::default())
        .manage({
            let registry = workspace::WorkspaceRegistry::default();
            workspace::bootstrap_registry(&registry);
            if let Some(ref launch_dir) = cli_dir {
                let _ = registry.authorize(launch_dir);
            }
            registry
        })
        .manage(launch_queue)
        .manage(ExitCoordinator::default())
        .manage(fs::replace::WorkspaceReplaceState::default())
        .manage(rdp::RdpState::default())
        .manage(collab::CollabState::default())
        .manage(collab::CollabGuestState::default())
        .manage(mcp::McpManagerState::default())
        .manage(agent_history::AgentHistoryState::new())
        .manage(git_review::GitReviewState::default())
        .invoke_handler(tauri::generate_handler![
            launch::launch_bootstrap,
            launch::launch_frontend_ready,
            launch::launch_acknowledge,
            app_exit_after_flush,
            pty::pty_open,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_close,
            pty::pty_close_all,
            pty::pty_has_foreground_process,
            pty::pty_has_foreground_job,
            pty::pty_shell_name,
            pty::pty_list_shells,
            remote::remote_open,
            remote::remote_request,
            remote::remote_close,
            remote::remote_pty_open,
            remote::remote_pty_write,
            remote::remote_pty_resize,
            remote::remote_pty_close,
            remote::remote_watch_add,
            remote::remote_watch_remove,
            remote::ssh_ping,
            remote::ssh_fetch_metrics,
            remote::ssh_upload_files,
            remote::ssh_download_files,
            remote::host_local_metrics,
            fs::tree::list_subdirs,
            fs::tree::fs_read_dir,
            fs::file::fs_pick_file,
            fs::file::fs_pick_folder,
            fs::file::fs_read_file,
            fs::file::fs_is_network_path,
            fs::file::fs_read_binary_file,
            fs::file::fs_write_file,
            fs::file::fs_stat,
            fs::file::fs_canonicalize,
            fs::mutate::fs_create_file,
            fs::mutate::fs_create_dir,
            fs::mutate::fs_rename,
            fs::mutate::fs_delete,
            fs::mutate::fs_inspect_operation_path,
            fs::mutate::fs_write_operation_file,
            fs::mutate::fs_remove_operation_file,
            fs::mutate::fs_remove_empty_operation_directory,
            fs::mutate::fs_copy,
            fs::watch::fs_watch_add,
            fs::watch::fs_watch_remove,
            lsp::lsp_detect,
            lsp::lsp_host_pid,
            lsp::lsp_resolve_root,
            lsp::lsp_spawn,
            lsp::lsp_send,
            lsp::lsp_kill,
            fs::search::fs_search,
            fs::search::fs_list_files,
            fs::grep::fs_grep,
            fs::grep::fs_grep_interactive,
            fs::grep::fs_grep_workspace,
            fs::grep::fs_grep_workspace_cancel,
            fs::replace::fs_replace_preview,
            fs::replace::fs_replace_apply,
            fs::replace::fs_workspace_edit_preview,
            fs::replace::fs_workspace_edit_apply,
            fs::grep::fs_glob,
            git::commands::git_resolve_repo,
            git::commands::git_panel_snapshot,
            git::commands::git_status,
            git::commands::git_diff,
            git::commands::git_diff_content,
            git::commands::git_stage,
            git::commands::git_unstage,
            git::commands::git_discard,
            git::commands::git_commit,
            git::commands::git_fetch,
            git::commands::git_pull_ff_only,
            git::commands::git_push,
            git::commands::git_log,
            git::commands::git_show_commit,
            git::commands::git_commit_files,
            git::commands::git_commit_file_diff,
            git::commands::git_remote_url,
            git::commands::git_list_branches,
            git::commands::git_checkout_branch,
            git::commands::git_add_safe_directory,
            git::commands::git_init,
            shell::shell_run_command,
            shell::shell_session_open,
            shell::shell_session_run,
            shell::shell_session_close,
            shell::shell_bg_spawn,
            shell::shell_bg_logs,
            shell::shell_bg_kill,
            shell::shell_bg_list,
            dap::dap_start,
            dap::dap_send,
            dap::dap_poll,
            dap::dap_stop,
            workspace::wsl_list_distros,
            workspace::wsl_default_distro,
            workspace::wsl_home,
            workspace::workspace_authorize,
            workspace::workspace_current_dir,
            control::control_frontend_ready,
            control::control_respond,
            open_settings_window,
            agent::agent_enable_hooks,
            agent::agent_hooks_status,
            secrets::secrets_get,
            secrets::secrets_set,
            secrets::secrets_delete,
            secrets::secrets_get_all,
            mcp::manager::mcp_upsert_server,
            mcp::manager::mcp_list_servers,
            mcp::manager::mcp_connect_server,
            mcp::manager::mcp_disconnect_server,
            mcp::manager::mcp_restart_server,
            mcp::manager::mcp_remove_server,
            mcp::manager::mcp_set_bearer_credential,
            mcp::manager::mcp_credential_status,
            mcp::manager::mcp_revoke_credentials,
            mcp::manager::mcp_begin_oauth,
            mcp::manager::mcp_oauth_flow_status,
            mcp::runtime::mcp_create_tool_snapshot,
            mcp::runtime::mcp_get_tool_snapshot,
            mcp::runtime::mcp_decide_tool_call,
            mcp::runtime::mcp_resolve_tool_approval,
            mcp::runtime::mcp_call_snapshot_tool,
            mcp::runtime::mcp_cancel_tool_call,
            mcp::runtime::mcp_recent_tool_audit,
            net::lm_ping,
            net::ai_http_request,
            net::ai_http_stream,
            api_client::api_client_send_request,
            api_client::api_client_stream_request,
            api_client::api_client_cancel_request,
            api_client::api_client_run_scenario,
            api_client::api_client_dispatch_webhook,
            history::history_suggest,
            history::history_commands,
            history::history_record,
            history::history_list,
            history::history_export,
            history::history_import,
            history::history_delete_entry,
            history::history_clear,
            vibrancy::window_backdrop_kind,
            vibrancy::window_set_backdrop,
            web_server::web_server_start,
            web_server::web_server_stop,
            web_server::web_server_get_for_path,
            web_server::web_server_list,
            tray::tray_toggle_window,
            tray::tray_hide_window,
            tray::tray_show_window,
            tray::tray_set_language,
            extensions::extensions_get_dir,
            extensions::extensions_list,
            extensions::extensions_read_code,
            extensions::extensions_open_dir,
            extensions::extensions_delete,
            serial::serial_list_ports,
            serial::serial_open,
            serial::serial_write,
            serial::serial_close,
            serial::serial_set_signals,
            docker::docker_ping,
            docker::docker_list_containers,
            docker::docker_container_action,
            docker::docker_get_stats,
            docker::docker_get_logs,
            tunnel::ssh_tunnel_start,
            tunnel::ssh_tunnel_stop,
            tunnel::ssh_tunnel_list,
            tunnel::ssh_tunnel_stop_all,
            rdp::rdp_connect,
            rdp::rdp_send_input,
            rdp::rdp_disconnect,
            rdp::rdp_launch_native,
            rdp::rdp_probe_host,
            collab::requirements::collab_cloudflared_status,
            collab::collab_host_start,
            collab::collab_host_stop,
            collab::collab_host_snapshot_barrier,
            collab::collab_host_set_snapshot,
            collab::collab_host_snapshot_required,
            collab::collab_host_publish,
            collab::collab_host_unpublish,
            collab::collab_host_participants,
            collab::collab_host_grant_control,
            collab::collab_host_revoke_control,
            collab::collab_host_remove_participant,
            collab::collab_host_ban_participant,
            collab::collab_guest_connect,
            collab::collab_guest_write,
            collab::collab_guest_request_control,
            collab::collab_guest_release_control,
            collab::collab_guest_file_search,
            collab::collab_guest_file_read,
            collab::collab_guest_close,
            agent_history::agent_history_get_sessions,
            agent_history::agent_history_get_messages,
            agent_history::agent_history_rescan,
            agent_history::agent_history_delete_session,
            agent_history::agent_history_clear_all,
            agent_history::agent_history_get_resume_command,
            agent_history::agent_history_export_markdown,
            agent_history::agent_history_get_stats,
            git_review::git_review_open_session,
            git_review::git_review_mark_file,
            git_review::git_review_mark_range,
            git_review::git_review_unmark_range,
            git_review::git_review_reconcile_file,
            git_review::git_review_get_session_overview,
            git_review::git_review_prune_sessions,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            match event {
                // Servers exit on stdin EOF, but destructors are not guaranteed
                // on process exit; kill explicitly.
                tauri::RunEvent::Exit => {
                    if let Some(state) = app.try_state::<tunnel::TunnelState>() {
                        let _ = state.0.stop_all_tunnels();
                    }
                    if let Some(state) = app.try_state::<web_server::WebServerState>() {
                        state.stop_all();
                    }
                    if let Some(state) = app.try_state::<lsp::LspState>() {
                        state.kill_all();
                    }
                    if let Some(state) = app.try_state::<dap::DapState>() {
                        state.kill_all();
                    }
                    if let Some(state) = app.try_state::<control::ControlState>() {
                        state.shutdown();
                    }
                }
                tauri::RunEvent::ExitRequested { api, .. } => {
                    let allowed = app
                        .try_state::<ExitCoordinator>()
                        .is_some_and(|state| state.0.load(Ordering::Acquire));
                    if !allowed {
                        api.prevent_exit();
                        let _ = app.emit("voktty:request-app-close", ());
                    }
                }
                #[cfg(target_os = "macos")]
                tauri::RunEvent::Opened { urls } => {
                    let paths = urls
                        .iter()
                        .filter_map(|u| u.to_file_path().ok())
                        .collect::<Vec<_>>();
                    if paths.is_empty() {
                        return;
                    }
                    let cold = app
                        .try_state::<launch::LaunchQueue>()
                        .is_some_and(|queue| queue.has_pending_restore());
                    let request = launch::parse_opened_paths(paths, None, cold);
                    if request.paths.is_empty() {
                        return;
                    }
                    if let Some(registry) = app.try_state::<workspace::WorkspaceRegistry>() {
                        for path in &request.paths {
                            if let Some(parent) = std::path::Path::new(path).parent() {
                                let _ = registry.authorize(parent);
                            }
                        }
                    }
                    launch::focus_main_window(app);
                    launch::enqueue_and_emit(app, request);
                }
                _ => {}
            }
        });
}
