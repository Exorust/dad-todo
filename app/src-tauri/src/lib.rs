mod sidecar;
mod watcher;

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

#[derive(Default)]
pub struct AppState {
    sidecar: Mutex<Option<sidecar::SidecarHandle>>,
    watcher: Mutex<Option<notify::RecommendedWatcher>>,
    watched_dir: Mutex<Option<String>>,
}

fn get_sidecar(state: &State<'_, AppState>) -> Result<sidecar::SidecarHandle, String> {
    state
        .sidecar
        .lock()
        .unwrap()
        .as_ref()
        .cloned()
        .ok_or_else(|| "Sidecar not running".to_string())
}

fn config_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".dadtodo")
}

#[derive(Serialize, Deserialize, Default)]
struct AppConfig {
    watched_dir: Option<String>,
}

fn load_config() -> AppConfig {
    let path = config_path().join("config.json");
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_config(config: &AppConfig) {
    let dir = config_path();
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("config.json");
    let _ = std::fs::write(path, serde_json::to_string_pretty(config).unwrap());
}

#[tauri::command]
fn get_watched_dir(state: State<'_, AppState>) -> Option<String> {
    state.watched_dir.lock().unwrap().clone()
}

#[tauri::command]
async fn set_watched_dir(app: AppHandle, state: State<'_, AppState>, dir: String) -> Result<(), String> {
    let path = PathBuf::from(&dir);
    if !path.is_dir() {
        return Err("Not a directory".to_string());
    }

    let w = watcher::start_watcher(&app, path)?;
    *state.watcher.lock().unwrap() = Some(w);
    *state.watched_dir.lock().unwrap() = Some(dir.clone());

    save_config(&AppConfig {
        watched_dir: Some(dir),
    });

    Ok(())
}

#[tauri::command]
async fn parse_files(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let sc = get_sidecar(&state)?;
    let dir = state
        .watched_dir
        .lock()
        .unwrap()
        .clone()
        .ok_or("No folder selected")?;
    sc.send(serde_json::json!({ "type": "parse-files", "dir": dir }))
        .await
}

#[tauri::command]
async fn categorize(
    state: State<'_, AppState>,
    view_name: String,
    tasks: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let sc = get_sidecar(&state)?;
    sc.send(serde_json::json!({
        "type": "categorize",
        "viewName": view_name,
        "tasks": tasks,
    }))
    .await
}

#[tauri::command]
async fn studio_chat(
    state: State<'_, AppState>,
    message: String,
    view_name: String,
    view_config: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let sc = get_sidecar(&state)?;
    sc.send(serde_json::json!({
        "type": "studio-chat",
        "message": message,
        "viewName": view_name,
        "viewConfig": view_config,
    }))
    .await
}

#[tauri::command]
async fn update_task(
    state: State<'_, AppState>,
    file_path: String,
    line_number: usize,
    new_content: String,
) -> Result<serde_json::Value, String> {
    let sc = get_sidecar(&state)?;
    sc.send(serde_json::json!({
        "type": "update-task",
        "filePath": file_path,
        "lineNumber": line_number,
        "newContent": new_content,
    }))
    .await
}

#[tauri::command]
async fn create_task(
    state: State<'_, AppState>,
    file_path: String,
    content: String,
) -> Result<serde_json::Value, String> {
    let sc = get_sidecar(&state)?;
    sc.send(serde_json::json!({
        "type": "create-task",
        "filePath": file_path,
        "content": content,
    }))
    .await
}

#[tauri::command]
async fn check_setup(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let sc = get_sidecar(&state)?;
    sc.send(serde_json::json!({ "type": "check-setup" })).await
}

#[tauri::command]
async fn create_custom_view(
    state: State<'_, AppState>,
    description: String,
) -> Result<serde_json::Value, String> {
    let sc = get_sidecar(&state)?;
    sc.send(serde_json::json!({
        "type": "create-custom-view",
        "description": description,
    }))
    .await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            get_watched_dir,
            set_watched_dir,
            check_setup,
            parse_files,
            categorize,
            studio_chat,
            update_task,
            create_task,
            create_custom_view,
        ])
        .setup(|app| {
            let config = load_config();
            let app_handle = app.handle().clone();

            if let Some(dir) = &config.watched_dir {
                let path = PathBuf::from(dir);
                if path.is_dir() {
                    if let Ok(w) = watcher::start_watcher(app.handle(), path) {
                        let state = app.state::<AppState>();
                        *state.watcher.lock().unwrap() = Some(w);
                        *state.watched_dir.lock().unwrap() = Some(dir.clone());
                    }
                }
            }

            tauri::async_runtime::spawn(async move {
                match sidecar::boot_sidecar(&app_handle).await {
                    Ok(handle) => {
                        let state = app_handle.state::<AppState>();
                        *state.sidecar.lock().unwrap() = Some(handle);
                        eprintln!("[dadtodo] sidecar started");
                    }
                    Err(e) => {
                        eprintln!("[dadtodo] sidecar failed to start: {}", e);
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
