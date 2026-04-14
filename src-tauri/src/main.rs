#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod api;
mod compact;
mod context;
mod credentials;
mod notifications;
mod server;
mod sessions;

use server::{PermissionResponse, SharedState};
use std::sync::Arc;
use tauri::{
    image::Image,
    menu::{CheckMenuItem, Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_autostart::ManagerExt;
use tokio::sync::Mutex;

struct UsageState {
    data: Mutex<Option<serde_json::Value>>,
}

struct TrayMetricState {
    metric: Mutex<String>, // "session", "weekly", "sonnet"
}

// Session commands
#[tauri::command]
async fn list_sessions() -> Result<Vec<sessions::SessionInfo>, String> {
    Ok(sessions::list_sessions())
}

#[tauri::command]
async fn get_context(session_id: String) -> Result<Option<context::ContextInfo>, String> {
    Ok(context::get_context(&session_id))
}

#[tauri::command]
async fn trigger_compact(pid: u32) -> Result<String, String> {
    compact::trigger_compact(pid)
}

// Permission commands
#[tauri::command]
async fn respond_permission(
    id: String,
    decision: String,
    state: tauri::State<'_, SharedState>,
) -> Result<(), String> {
    // Always remove from pending display list
    {
        let mut pending = state.pending.lock().await;
        pending.remove(&id);
    }
    // Try to send decision through channel (may already be closed if CLI handled it)
    let mut channels = state.response_channels.lock().await;
    if let Some(tx) = channels.remove(&id) {
        let _ = tx.send(PermissionResponse { decision });
    }
    // Always succeed - even if channel gone, we cleaned up the UI
    Ok(())
}

#[tauri::command]
async fn get_pending_permissions(
    state: tauri::State<'_, SharedState>,
) -> Result<Vec<server::PendingPermission>, String> {
    let pending = state.pending.lock().await;
    Ok(pending.values().cloned().collect())
}

// Usage (Burnrate) commands
#[tauri::command]
async fn get_usage(
    usage_state: tauri::State<'_, UsageState>,
) -> Result<serde_json::Value, String> {
    let data = usage_state.data.lock().await;
    Ok(data.clone().unwrap_or(serde_json::json!({})))
}

#[tauri::command]
async fn refresh_usage(
    usage_state: tauri::State<'_, UsageState>,
) -> Result<serde_json::Value, String> {
    let result = fetch_usage_data().await?;
    let mut data = usage_state.data.lock().await;
    *data = Some(result.clone());
    Ok(result)
}

#[tauri::command]
async fn set_tray_metric(
    metric: String,
    state: tauri::State<'_, TrayMetricState>,
) -> Result<(), String> {
    *state.metric.lock().await = metric;
    Ok(())
}

async fn fetch_usage_data() -> Result<serde_json::Value, String> {
    let creds = credentials::Credentials::load()?;
    let token = &creds.claude_ai_oauth.access_token;
    let tier = creds.tier_display();
    let usage = api::fetch_usage(token).await?;

    Ok(serde_json::json!({
        "usage": usage,
        "tier": tier,
    }))
}

fn create_tray_icon(count: u32, has_pending: bool) -> Vec<u8> {
    let size = 16u32;
    let mut pixels = vec![0u8; (size * size * 4) as usize];

    for y in 0..size {
        for x in 0..size {
            let idx = ((y * size + x) * 4) as usize;
            pixels[idx] = 15;
            pixels[idx + 1] = 15;
            pixels[idx + 2] = 15;
            pixels[idx + 3] = 160;
        }
    }

    let (r, g, b) = if count > 0 { (0u8, 255u8, 136u8) } else { (100, 100, 100) };

    let font_4x6: [[u8; 6]; 10] = [
        [0b0110, 0b1001, 0b1001, 0b1001, 0b1001, 0b0110],
        [0b0010, 0b0110, 0b0010, 0b0010, 0b0010, 0b0111],
        [0b0110, 0b1001, 0b0010, 0b0100, 0b1000, 0b1111],
        [0b1110, 0b0001, 0b0110, 0b0001, 0b0001, 0b1110],
        [0b1010, 0b1010, 0b1010, 0b1111, 0b0010, 0b0010],
        [0b1111, 0b1000, 0b1110, 0b0001, 0b0001, 0b1110],
        [0b0110, 0b1000, 0b1110, 0b1001, 0b1001, 0b0110],
        [0b1111, 0b0001, 0b0010, 0b0010, 0b0100, 0b0100],
        [0b0110, 0b1001, 0b0110, 0b1001, 0b1001, 0b0110],
        [0b0110, 0b1001, 0b1001, 0b0111, 0b0001, 0b0110],
    ];

    let text = format!("{}", count.min(99));
    let char_w = 5i32;
    let total_w = text.len() as i32 * char_w - 1;
    let start_x = (size as i32 - total_w) / 2;
    let start_y = (size as i32 - 6) / 2;

    for (ci, ch) in text.chars().enumerate() {
        let digit = match ch {
            '0'..='9' => (ch as u8 - b'0') as usize,
            _ => continue,
        };
        let glyph = &font_4x6[digit];
        let ox = start_x + ci as i32 * char_w;

        for (row, &bits) in glyph.iter().enumerate() {
            for col in 0..4 {
                if bits & (1 << (3 - col)) != 0 {
                    let px = ox + col;
                    let py = start_y + row as i32;
                    if px >= 0 && px < size as i32 && py >= 0 && py < size as i32 {
                        let idx = ((py as u32 * size + px as u32) * 4) as usize;
                        pixels[idx] = r;
                        pixels[idx + 1] = g;
                        pixels[idx + 2] = b;
                        pixels[idx + 3] = 255;
                    }
                    for (dx, dy) in [(-1i32, 0i32), (1, 0), (0, -1), (0, 1)] {
                        let gx = px + dx;
                        let gy = py + dy;
                        if gx >= 0 && gx < size as i32 && gy >= 0 && gy < size as i32 {
                            let gidx = ((gy as u32 * size + gx as u32) * 4) as usize;
                            if pixels[gidx + 3] < 255 {
                                pixels[gidx] = (pixels[gidx] as u16 + r as u16 / 4).min(255) as u8;
                                pixels[gidx + 1] = (pixels[gidx + 1] as u16 + g as u16 / 4).min(255) as u8;
                                pixels[gidx + 2] = (pixels[gidx + 2] as u16 + b as u16 / 4).min(255) as u8;
                                pixels[gidx + 3] = 200;
                            }
                        }
                    }
                }
            }
        }
    }

    // Draw pending badge: yellow dot in top-right corner (3x3 pixels)
    if has_pending {
        let badge_color: (u8, u8, u8) = (255, 220, 0); // yellow
        for dy in 0..3u32 {
            for dx in 0..3u32 {
                let px = size - 1 - dx;
                let py = dy;
                let idx = ((py * size + px) * 4) as usize;
                pixels[idx] = badge_color.0;
                pixels[idx + 1] = badge_color.1;
                pixels[idx + 2] = badge_color.2;
                pixels[idx + 3] = 255;
            }
        }
    }

    pixels
}

fn main() {
    let server_state: SharedState = Arc::new(server::ServerState::new());
    let server_state_tauri = server_state.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .plugin(tauri_plugin_notification::init())
        .manage(server_state_tauri.clone())
        .manage(UsageState {
            data: Mutex::new(None),
        })
        .manage(TrayMetricState {
            metric: Mutex::new("weekly".to_string()),
        })
        .invoke_handler(tauri::generate_handler![
            list_sessions,
            get_context,
            trigger_compact,
            respond_permission,
            get_pending_permissions,
            get_usage,
            refresh_usage,
            set_tray_metric
        ])
        .setup(move |app| {
            // Set app handle in server state
            {
                let state = server_state.clone();
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    *state.app_handle.lock().await = Some(handle);
                });
            }

            // Start HTTP server
            {
                let state = server_state.clone();
                tauri::async_runtime::spawn(async move {
                    server::start_server(state).await;
                });
            }

            // Start stale permission cleanup loop
            {
                let state = server_state.clone();
                tauri::async_runtime::spawn(async move {
                    server::cleanup_stale_permissions(state).await;
                });
            }

            // Tray setup
            let is_autostart = app.autolaunch().is_enabled().unwrap_or(false);
            let autostart_item = CheckMenuItem::with_id(
                app,
                "autostart",
                "Start with Windows",
                true,
                is_autostart,
                None::<&str>,
            )?;
            let quit = MenuItem::with_id(app, "quit", "Quit Pulse", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&autostart_item, &quit])?;

            let icon_pixels = create_tray_icon(0, false);
            let icon = Image::new_owned(icon_pixels, 16, 16);

            let popup_w = 700.0;
            let popup_h = 480.0;

            let _tray = TrayIconBuilder::with_id("pulse-tray")
                .icon(icon)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("Auralis Pulse")
                .on_menu_event(|app, event| {
                    if event.id == "quit" {
                        app.exit(0);
                    } else if event.id == "autostart" {
                        let mgr = app.autolaunch();
                        let currently_enabled = mgr.is_enabled().unwrap_or(false);
                        if currently_enabled {
                            let _ = mgr.disable();
                        } else {
                            let _ = mgr.enable();
                        }
                    }
                })
                .on_tray_icon_event(move |tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();

                        // Close any duplicate windows first
                        let windows: Vec<_> = app.webview_windows()
                            .keys()
                            .filter(|k| k.as_str() == "pulse")
                            .cloned()
                            .collect();

                        if let Some(window) = app.get_webview_window("pulse") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                if let Ok(Some(monitor)) = window.primary_monitor() {
                                    let screen = monitor.size();
                                    let scale = monitor.scale_factor();
                                    let x = (screen.width as f64 / scale) - popup_w - 12.0;
                                    let y = (screen.height as f64 / scale) - popup_h - 52.0;
                                    let _ = window.set_position(tauri::Position::Logical(
                                        tauri::LogicalPosition::new(x, y),
                                    ));
                                }
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                            return; // Don't create another window
                        } else {
                            let (x, y) = {
                                let primary = app.primary_monitor().ok().flatten();
                                match primary {
                                    Some(monitor) => {
                                        let screen = monitor.size();
                                        let scale = monitor.scale_factor();
                                        (
                                            (screen.width as f64 / scale) - popup_w - 12.0,
                                            (screen.height as f64 / scale) - popup_h - 52.0,
                                        )
                                    }
                                    None => (800.0, 400.0),
                                }
                            };

                            let _window = WebviewWindowBuilder::new(
                                app,
                                "pulse",
                                WebviewUrl::App("index.html".into()),
                            )
                            .title("Auralis Pulse")
                            .inner_size(popup_w, popup_h)
                            .position(x, y)
                            .resizable(false)
                            .decorations(false)
                            .always_on_top(true)
                            .skip_taskbar(true)
                            .build()
                            .expect("Failed to create window");
                        }
                    }
                })
                .build(app)?;

            // Sessions refresh loop: every 30s (local, free)
            let app_handle = app.handle().clone();
            let threshold_state = notifications::ThresholdState::new();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
                loop {
                    let sessions = sessions::list_sessions();
                    let session_count = sessions.len();

                    // Check context thresholds for each alive session
                    {
                        let alive_ids: Vec<String> =
                            sessions.iter().map(|s| s.session_id.clone()).collect();
                        for s in &sessions {
                            if let Some(ctx) = context::get_context(&s.session_id) {
                                notifications::check_and_notify(
                                    &threshold_state,
                                    &s.session_id,
                                    &s.name,
                                    ctx.used_tokens,
                                    s.pid,
                                )
                                .await;
                            }
                        }
                        notifications::cleanup_stale_sessions(&threshold_state, &alive_ids).await;
                    }

                    // Update tray tooltip with session count
                    if let Some(tray) = app_handle.tray_by_id("pulse-tray") {
                        // Read selected metric and cached usage
                        let usage_state: tauri::State<UsageState> = app_handle.state();
                        let metric_state: tauri::State<TrayMetricState> = app_handle.state();
                        let metric = metric_state.metric.lock().await.clone();

                        let (cached_pct, metric_label) = {
                            let data = usage_state.data.lock().await;
                            let usage = data.as_ref().and_then(|d| d.get("usage"));
                            match metric.as_str() {
                                "session" => {
                                    let pct = usage
                                        .and_then(|u| u.get("five_hour"))
                                        .and_then(|s| s.get("utilization"))
                                        .and_then(|v| v.as_f64())
                                        .map(|v| v.round() as u32)
                                        .unwrap_or(0);
                                    (pct, "5h")
                                }
                                "sonnet" => {
                                    let pct = usage
                                        .and_then(|u| u.get("seven_day_sonnet"))
                                        .and_then(|s| s.get("utilization"))
                                        .and_then(|v| v.as_f64())
                                        .map(|v| v.round() as u32)
                                        .unwrap_or(0);
                                    (pct, "sonnet")
                                }
                                _ => {
                                    let pct = usage
                                        .and_then(|u| u.get("seven_day"))
                                        .and_then(|s| s.get("utilization"))
                                        .and_then(|v| v.as_f64())
                                        .map(|v| v.round() as u32)
                                        .unwrap_or(0);
                                    (pct, "weekly")
                                }
                            }
                        };

                        // Check pending permissions for badge
                        let pending_count = {
                            let server_state: tauri::State<SharedState> = app_handle.state();
                            let pending = server_state.pending.lock().await;
                            pending.len()
                        };
                        let has_pending = pending_count > 0;

                        let icon_pixels = create_tray_icon(cached_pct, has_pending);
                        let icon = Image::new_owned(icon_pixels, 16, 16);
                        let _ = tray.set_icon(Some(icon));

                        let tooltip = if has_pending {
                            format!(
                                "Pulse: {}% {} | {} pending | {} session{}",
                                cached_pct, metric_label, pending_count,
                                session_count, if session_count == 1 { "" } else { "s" }
                            )
                        } else {
                            format!(
                                "Pulse: {}% {}, {} session{}",
                                cached_pct, metric_label,
                                session_count, if session_count == 1 { "" } else { "s" }
                            )
                        };
                        let _ = tray.set_tooltip(Some(&tooltip));
                    }

                    if let Some(window) = app_handle.get_webview_window("pulse") {
                        let _ = window.emit("sessions-updated", &sessions);
                    }

                    tokio::time::sleep(tokio::time::Duration::from_secs(30)).await;
                }
            });

            // Usage refresh loop: every 5 min (API call)
            let app_handle2 = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
                loop {
                    if let Ok(data) = fetch_usage_data().await {
                        let state: tauri::State<UsageState> = app_handle2.state();
                        *state.data.lock().await = Some(data);

                        if let Some(window) = app_handle2.get_webview_window("pulse") {
                            let _ = window.emit("usage-updated", ());
                        }
                    }

                    tokio::time::sleep(tokio::time::Duration::from_secs(300)).await;
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error building app")
        .run(|app, event| match event {
            tauri::RunEvent::ExitRequested { api, code, .. } => {
                if code.is_none() {
                    api.prevent_exit();
                }
            }
            tauri::RunEvent::WindowEvent {
                event: tauri::WindowEvent::CloseRequested { api, .. },
                label,
                ..
            } => {
                api.prevent_close();
                if let Some(window) = app.get_webview_window(&label) {
                    let _ = window.hide();
                }
            }
            _ => {}
        });
}
