pub mod commands;
pub mod ssh;

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use git2::{Repository, RepositoryOpenFlags};
use walkdir::WalkDir;

use crate::{AppError, ConflictBlock, ConflictFile, FileNode, GitStatus};

pub struct AppState {
    repo: Mutex<Option<Repository>>,
    repo_path: Mutex<Option<PathBuf>>,
    ssh_config: Mutex<Option<ssh::SshAuthConfig>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            repo: Mutex::new(None),
            repo_path: Mutex::new(None),
            ssh_config: Mutex::new(None),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

pub fn open_repo(path: &str, state: &AppState) -> Result<(), AppError> {
    let repo_path = Path::new(path);
    let repo = Repository::open_ext(
        repo_path,
        RepositoryOpenFlags::empty(),
        Vec::<&Path>::new(),
    )?;

    *state.repo.lock().unwrap() = Some(repo);
    *state.repo_path.lock().unwrap() = Some(repo_path.to_path_buf());

    Ok(())
}

pub fn build_file_tree(state: &AppState) -> Result<FileNode, AppError> {
    let repo_path_guard = state.repo_path.lock().unwrap();
    let repo_path = repo_path_guard.as_ref()
        .ok_or_else(|| AppError::PathError("No repository opened".to_string()))?;

    let root_name = repo_path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("root")
        .to_string();

    let root = FileNode {
        name: root_name,
        path: repo_path.to_string_lossy().to_string(),
        is_dir: true,
        children: Some(build_children(repo_path, repo_path)?),
    };

    Ok(root)
}

fn build_children(base: &Path, current: &Path) -> Result<Vec<FileNode>, AppError> {
    let mut entries = Vec::new();

    for entry in WalkDir::new(current)
        .min_depth(1)
        .max_depth(1)
        .sort_by(|a, b| a.file_name().cmp(b.file_name()))
    {
        let entry = entry?;
        let path = entry.path();
        let rel_path = path.strip_prefix(base)
            .map_err(|_| AppError::PathError("Failed to get relative path".to_string()))?;

        if entry.path_is_hidden() {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if name == ".git" {
                    continue;
                }
            }
        }

        let name = path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        let is_dir = entry.file_type().is_dir();

        let children = if is_dir {
            Some(build_children(base, path)?)
        } else {
            None
        };

        entries.push(FileNode {
            name,
            path: rel_path.to_string_lossy().to_string(),
            is_dir,
            children,
        });
    }

    Ok(entries)
}

pub fn read_file_content(rel_path: &str, state: &AppState) -> Result<String, AppError> {
    let repo_path_guard = state.repo_path.lock().unwrap();
    let repo_path = repo_path_guard.as_ref()
        .ok_or_else(|| AppError::PathError("No repository opened".to_string()))?;

    let full_path = repo_path.join(rel_path);
    let content = std::fs::read_to_string(&full_path)?;

    Ok(content)
}

pub fn write_file_content(rel_path: &str, content: &str, state: &AppState) -> Result<(), AppError> {
    let repo_path_guard = state.repo_path.lock().unwrap();
    let repo_path = repo_path_guard.as_ref()
        .ok_or_else(|| AppError::PathError("No repository opened".to_string()))?;

    let full_path = repo_path.join(rel_path);
    std::fs::write(&full_path, content)?;

    Ok(())
}

pub fn get_status(state: &AppState) -> Result<GitStatus, AppError> {
    let repo_guard = state.repo.lock().unwrap();
    let repo = repo_guard.as_ref()
        .ok_or_else(|| AppError::PathError("No repository opened".to_string()))?;

    let mut status_opts = git2::StatusOptions::new();
    status_opts.include_untracked(true);
    let statuses = repo.statuses(Some(&mut status_opts))?;

    let mut modified = Vec::new();
    let mut added = Vec::new();
    let mut deleted = Vec::new();

    for entry in statuses.iter() {
        if let Some(path) = entry.path() {
            let status = entry.status();
            if status.is_wt_modified() || status.is_index_modified() {
                modified.push(path.to_string());
            }
            if status.is_wt_new() || status.is_index_new() {
                added.push(path.to_string());
            }
            if status.is_wt_deleted() || status.is_index_deleted() {
                deleted.push(path.to_string());
            }
        }
    }

    Ok(GitStatus { modified, added, deleted })
}

pub fn parse_conflict_file(content: &str) -> Vec<ConflictBlock> {
    let mut conflicts = Vec::new();
    let lines: Vec<&str> = content.lines().collect();
    let mut i = 0;

    while i < lines.len() {
        if lines[i].starts_with("<<<<<<<") {
            let start_line = i + 1;
            let mut local_lines = Vec::new();
            i += 1;

            while i < lines.len() && !lines[i].starts_with("=======") {
                local_lines.push(lines[i]);
                i += 1;
            }

            let separator_line = i + 1;
            let mut remote_lines = Vec::new();
            i += 1;

            while i < lines.len() && !lines[i].starts_with(">>>>>>>") {
                remote_lines.push(lines[i]);
                i += 1;
            }

            let end_line = i + 1;

            conflicts.push(ConflictBlock {
                start_line,
                separator_line,
                end_line,
                local_content: local_lines.join("\n"),
                remote_content: remote_lines.join("\n"),
            });
        }
        i += 1;
    }

    conflicts
}

pub fn get_conflict_files(state: &AppState) -> Result<Vec<ConflictFile>, AppError> {
    let repo_path_guard = state.repo_path.lock().unwrap();
    let repo_path = repo_path_guard.as_ref()
        .ok_or_else(|| AppError::PathError("No repository opened".to_string()))?;

    let repo_guard = state.repo.lock().unwrap();
    let repo = repo_guard.as_ref()
        .ok_or_else(|| AppError::PathError("No repository opened".to_string()))?;

    let mut status_opts = git2::StatusOptions::new();
    status_opts.include_untracked(false);
    let statuses = repo.statuses(Some(&mut status_opts))?;

    let mut conflict_files = Vec::new();

    for entry in statuses.iter() {
        let status = entry.status();
        if status.is_conflicted() {
            if let Some(path) = entry.path() {
                let full_path = repo_path.join(path);
                if full_path.exists() {
                    let content = std::fs::read_to_string(&full_path)?;
                    let conflicts = parse_conflict_file(&content);
                    if !conflicts.is_empty() {
                        conflict_files.push(ConflictFile {
                            path: path.to_string(),
                            content,
                            conflicts,
                        });
                    }
                }
            }
        }
    }

    Ok(conflict_files)
}

pub fn resolve_conflict(
    rel_path: &str,
    resolved_content: &str,
    state: &AppState,
) -> Result<(), AppError> {
    let repo_path_guard = state.repo_path.lock().unwrap();
    let repo_path = repo_path_guard.as_ref()
        .ok_or_else(|| AppError::PathError("No repository opened".to_string()))?;

    let full_path = repo_path.join(rel_path);
    std::fs::write(&full_path, resolved_content)?;

    let repo_guard = state.repo.lock().unwrap();
    let repo = repo_guard.as_ref()
        .ok_or_else(|| AppError::PathError("No repository opened".to_string()))?;

    let mut index = repo.index()?;
    index.add_path(std::path::Path::new(rel_path))?;
    index.write()?;

    Ok(())
}

pub fn finalize_merge(state: &AppState, commit_message: Option<&str>) -> Result<String, AppError> {
    let repo_guard = state.repo.lock().unwrap();
    let repo = repo_guard.as_ref()
        .ok_or_else(|| AppError::PathError("No repository opened".to_string()))?;

    let conflicts = get_conflict_files(state)?;
    if !conflicts.is_empty() {
        return Err(AppError::PathError(format!(
            "There are still {} unresolved conflict files",
            conflicts.len()
        )));
    }

    let signature = repo.signature()?;
    let mut index = repo.index()?;
    let tree_id = index.write_tree()?;
    let tree = repo.find_tree(tree_id)?;

    let parents = {
        let head = repo.head()?.peel_to_commit()?;
        let merge_head = repo.find_reference("MERGE_HEAD")?.peel_to_commit()?;
        vec![head, merge_head]
    };

    let parent_refs: Vec<&git2::Commit> = parents.iter().collect();
    let message = commit_message.unwrap_or("Merge resolved conflicts");

    repo.commit(
        Some("HEAD"),
        &signature,
        &signature,
        message,
        &tree,
        &parent_refs,
    )?;

    if let Ok(mut merge_head) = repo.find_reference("MERGE_HEAD") {
        merge_head.delete()?;
    }

    Ok("Merge completed successfully".to_string())
}

pub fn abort_merge(state: &AppState) -> Result<String, AppError> {
    let repo_guard = state.repo.lock().unwrap();
    let repo = repo_guard.as_ref()
        .ok_or_else(|| AppError::PathError("No repository opened".to_string()))?;

    repo.cleanup_state()?;

    let mut checkout_opts = git2::build::CheckoutBuilder::new();
    checkout_opts.force();
    repo.checkout_head(Some(&mut checkout_opts))?;

    Ok("Merge aborted successfully".to_string())
}
