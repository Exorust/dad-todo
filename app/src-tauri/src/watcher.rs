use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::mpsc as std_mpsc;
use tauri::{AppHandle, Emitter};

pub fn start_watcher(app: &AppHandle, dir: PathBuf) -> Result<RecommendedWatcher, String> {
    let (tx, rx) = std_mpsc::channel::<Result<Event, notify::Error>>();

    let mut watcher = RecommendedWatcher::new(tx, Config::default())
        .map_err(|e| format!("watcher init failed: {}", e))?;

    watcher
        .watch(&dir, RecursiveMode::Recursive)
        .map_err(|e| format!("watch failed: {}", e))?;

    let app_handle = app.clone();
    std::thread::spawn(move || {
        for event in rx {
            match event {
                Ok(ev) => {
                    let dominated_by_md = ev.paths.iter().any(|p| {
                        let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
                        ext == "md" || ext == "txt"
                    });
                    if dominated_by_md {
                        let paths: Vec<String> = ev
                            .paths
                            .iter()
                            .map(|p| p.to_string_lossy().to_string())
                            .collect();
                        let _ = app_handle.emit(
                            "files-changed",
                            serde_json::json!({ "paths": paths, "kind": format!("{:?}", ev.kind) }),
                        );
                    }
                }
                Err(e) => eprintln!("[dadtodo] watch error: {}", e),
            }
        }
    });

    eprintln!("[dadtodo] watching {:?}", dir);
    Ok(watcher)
}
