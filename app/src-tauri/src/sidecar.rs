use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::{mpsc, oneshot, Mutex};
use tauri::{AppHandle, Emitter};

#[derive(Clone)]
pub struct SidecarHandle {
    tx: mpsc::Sender<(u64, Value, oneshot::Sender<Value>)>,
    next_req_id: Arc<AtomicU64>,
}

fn attach_req_id(msg: &mut Value, req_id: u64) {
    if let Some(obj) = msg.as_object_mut() {
        obj.insert("reqId".to_string(), serde_json::json!(req_id));
    }
}

fn extract_req_id(value: &Value) -> Option<u64> {
    value.get("reqId").and_then(|v| v.as_u64())
}

impl SidecarHandle {
    pub async fn send(&self, mut msg: Value) -> Result<Value, String> {
        let req_id = self.next_req_id.fetch_add(1, Ordering::Relaxed);
        attach_req_id(&mut msg, req_id);
        let (resp_tx, resp_rx) = oneshot::channel();
        self.tx
            .send((req_id, msg, resp_tx))
            .await
            .map_err(|_| "sidecar channel closed".to_string())?;
        tokio::time::timeout(std::time::Duration::from_secs(30), resp_rx)
            .await
            .map_err(|_| "sidecar call timed out after 30s".to_string())?
            .map_err(|_| "sidecar response dropped".to_string())
    }
}

fn find_bun() -> Option<std::path::PathBuf> {
    let candidates = [
        std::env::var("HOME").ok().map(|h| std::path::PathBuf::from(h).join(".bun/bin/bun")),
        Some(std::path::PathBuf::from("/usr/local/bin/bun")),
        Some(std::path::PathBuf::from("/opt/homebrew/bin/bun")),
    ];
    for candidate in candidates.into_iter().flatten() {
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

pub async fn boot_sidecar(app: &AppHandle) -> Result<SidecarHandle, String> {
    let sidecar_dir = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .parent()
        .ok_or("no parent dir")?
        .join("../../../sidecar");

    let sidecar_dir = if sidecar_dir.join("index.ts").exists() {
        sidecar_dir
    } else {
        let manifest_dir = std::env!("CARGO_MANIFEST_DIR");
        std::path::PathBuf::from(manifest_dir).join("../../sidecar")
    };

    let sidecar_entry = sidecar_dir.join("index.ts");
    if !sidecar_entry.exists() {
        return Err(format!("sidecar not found at {:?}", sidecar_entry));
    }

    let bun = find_bun().ok_or("bun not found in PATH or common locations")?;

    let mut child = Command::new(&bun)
        .arg("run")
        .arg(&sidecar_entry)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::inherit())
        .spawn()
        .map_err(|e| format!("failed to spawn bun at {:?}: {}", bun, e))?;

    let stdin = child.stdin.take().ok_or("no stdin")?;
    let stdout = child.stdout.take().ok_or("no stdout")?;

    let stdin = Arc::new(Mutex::new(stdin));
    let (tx, mut rx) = mpsc::channel::<(u64, Value, oneshot::Sender<Value>)>(64);

    let app_handle = app.clone();
    let reader_stdin = stdin.clone();

    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        let mut pending_responses: HashMap<u64, oneshot::Sender<Value>> = HashMap::new();

        loop {
            tokio::select! {
                msg = rx.recv() => {
                    match msg {
                        Some((req_id, value, resp_tx)) => {
                            let mut json_str = serde_json::to_string(&value).unwrap();
                            json_str.push('\n');
                            let mut stdin = reader_stdin.lock().await;
                            if let Err(e) = stdin.write_all(json_str.as_bytes()).await {
                                eprintln!("[dadtodo] write to sidecar failed: {}", e);
                                let _ = resp_tx.send(serde_json::json!({"error": e.to_string()}));
                                continue;
                            }
                            let _ = stdin.flush().await;
                            pending_responses.insert(req_id, resp_tx);
                        }
                        None => break,
                    }
                }
                result = reader.read_line(&mut line) => {
                    match result {
                        Ok(0) => {
                            eprintln!("[dadtodo] sidecar stdout closed");
                            break;
                        }
                        Ok(_) => {
                            if let Ok(value) = serde_json::from_str::<Value>(&line) {
                                let msg_type = value.get("type").and_then(|v| v.as_str()).unwrap_or("");
                                match msg_type {
                                    "response" => {
                                        if let Some(id) = extract_req_id(&value) {
                                            if let Some(resp_tx) = pending_responses.remove(&id) {
                                                let _ = resp_tx.send(value);
                                            }
                                        }
                                    }
                                    "studio-event" | "tasks-updated" => {
                                        let _ = app_handle.emit(msg_type, &value);
                                    }
                                    _ => {
                                        eprintln!("[dadtodo] unknown sidecar msg: {}", msg_type);
                                    }
                                }
                            }
                            line.clear();
                        }
                        Err(e) => {
                            eprintln!("[dadtodo] read from sidecar failed: {}", e);
                            break;
                        }
                    }
                }
            }
        }
    });

    Ok(SidecarHandle {
        tx,
        next_req_id: Arc::new(AtomicU64::new(1)),
    })
}
