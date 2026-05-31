use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};
use tauri::AppHandle;

pub struct FileWatcher {
    watcher: Arc<Mutex<Option<RecommendedWatcher>>>,
    path: PathBuf,
    running: Arc<Mutex<bool>>,
}

impl FileWatcher {
    pub async fn new(path: &str, app_handle: AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let (tx, mut rx) = mpsc::channel::<Result<Event, notify::Error>>(100);
        let path = PathBuf::from(path);
        let running = Arc::new(Mutex::new(true));
        let running_clone = running.clone();

        let mut watcher = RecommendedWatcher::new(
            move |res| {
                let _ = tx.blocking_send(res);
            },
            Config::default(),
        )?;

        watcher.watch(&path, RecursiveMode::Recursive)?;

        let running_task = running.clone();
        tokio::spawn(async move {
            while *running_task.lock().await {
                if let Some(res) = rx.recv().await {
                    match res {
                        Ok(event) => {
                            let event_type = match event.kind {
                                notify::EventKind::Create(_) => "create",
                                notify::EventKind::Modify(_) => "modify",
                                notify::EventKind::Remove(_) => "delete",
                                _ => continue,
                            };
                            
                            for path in event.paths {
                                let _ = app_handle.emit_all("file_change", serde_json::json!({
                                    "type": event_type,
                                    "path": path.to_string_lossy().to_string(),
                                }));
                            }
                        }
                        Err(e) => eprintln!("watch error: {:?}", e),
                    }
                }
            }
        });

        Ok(Self {
            watcher: Arc::new(Mutex::new(Some(watcher))),
            path,
            running: running_clone,
        })
    }

    pub async fn stop(&self) {
        *self.running.lock().await = false;
        let mut watcher = self.watcher.lock().await;
        if let Some(w) = watcher.take() {
            let _ = w.unwatch(&self.path);
        }
    }
}
