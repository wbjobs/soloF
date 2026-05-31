mod git;
mod error;

use serde::{Deserialize, Serialize};
use tauri::Manager;

pub use error::AppError;

#[derive(Serialize, Deserialize)]
pub struct FileNode {
    name: String,
    path: String,
    is_dir: bool,
    children: Option<Vec<FileNode>>,
}

#[derive(Serialize, Deserialize)]
pub struct GitStatus {
    modified: Vec<String>,
    added: Vec<String>,
    deleted: Vec<String>,
}

#[derive(Serialize, Deserialize)]
pub struct SshConfig {
    private_key_path: String,
    passphrase: Option<String>,
    use_ssh_agent: bool,
}

#[derive(Serialize, Deserialize)]
pub struct ConflictBlock {
    pub start_line: usize,
    pub separator_line: usize,
    pub end_line: usize,
    pub local_content: String,
    pub remote_content: String,
}

#[derive(Serialize, Deserialize)]
pub struct ConflictFile {
    pub path: String,
    pub content: String,
    pub conflicts: Vec<ConflictBlock>,
}

#[derive(Serialize, Deserialize)]
pub struct MergeResult {
    pub success: bool,
    pub message: String,
    pub has_conflicts: bool,
    pub conflict_files: Option<Vec<ConflictFile>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(git::AppState::new())
        .invoke_handler(tauri::generate_handler![
            git::commands::open_repository,
            git::commands::get_file_tree,
            git::commands::read_file,
            git::commands::save_file,
            git::commands::git_pull,
            git::commands::git_push,
            git::commands::get_git_status,
            git::commands::set_ssh_config,
            git::commands::get_conflict_files,
            git::commands::resolve_conflict,
            git::commands::finalize_merge,
            git::commands::abort_merge,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
