use git2::{build::RepoBuilder, FetchOptions, PushOptions, RemoteCallbacks};
use tauri::State;

use crate::{AppError, ConflictFile, FileNode, GitStatus, MergeResult, SshConfig};

use super::{ssh, AppState};

#[tauri::command]
pub fn open_repository(path: &str, state: State<AppState>) -> Result<(), AppError> {
    super::open_repo(path, &state)
}

#[tauri::command]
pub fn get_file_tree(state: State<AppState>) -> Result<FileNode, AppError> {
    super::build_file_tree(&state)
}

#[tauri::command]
pub fn read_file(path: &str, state: State<AppState>) -> Result<String, AppError> {
    super::read_file_content(path, &state)
}

#[tauri::command]
pub fn save_file(path: &str, content: &str, state: State<AppState>) -> Result<(), AppError> {
    super::write_file_content(path, content, &state)
}

#[tauri::command]
pub fn get_git_status(state: State<AppState>) -> Result<GitStatus, AppError> {
    super::get_status(&state)
}

#[tauri::command]
pub fn set_ssh_config(config: SshConfig, state: State<AppState>) -> Result<(), AppError> {
    *state.ssh_config.lock().unwrap() = Some(ssh::SshAuthConfig {
        private_key_path: config.private_key_path,
        passphrase: config.passphrase,
        use_ssh_agent: config.use_ssh_agent,
    });
    Ok(())
}

#[tauri::command]
pub fn git_pull(remote: Option<&str>, branch: Option<&str>, state: State<AppState>) -> Result<MergeResult, AppError> {
    let repo_guard = state.repo.lock().unwrap();
    let repo = repo_guard.as_ref()
        .ok_or_else(|| AppError::PathError("No repository opened".to_string()))?;

    let ssh_config_opt = state.ssh_config.lock().unwrap().clone();
    let remote_name = remote.unwrap_or("origin");
    let branch_name = branch.unwrap_or("main");

    let mut remote = repo.find_remote(remote_name)?;

    let mut callbacks = RemoteCallbacks::new();
    let ssh_config_clone = ssh_config_opt.clone();
    callbacks.credentials(move |url, username_from_url, allowed_types| {
        ssh::create_ssh_credentials(
            ssh_config_clone.as_ref(),
            url,
            username_from_url,
            allowed_types,
        )
    });
    callbacks.transfer_progress(|stats| {
        if stats.received_objects() == stats.total_objects() {
            println!("Resolving deltas {}/{}", stats.indexed_deltas(), stats.total_deltas());
        } else if stats.total_objects() > 0 {
            println!("Received {}/{} objects ({}) in {} bytes",
                stats.received_objects(),
                stats.total_objects(),
                stats.indexed_objects(),
                stats.received_bytes());
        }
        true
    });

    let mut fetch_opts = FetchOptions::new();
    fetch_opts.remote_callbacks(callbacks);

    println!("Fetching from {}...", remote_name);
    remote.fetch(&[branch_name], Some(&mut fetch_opts), None)?;

    let fetch_head = repo.find_reference("FETCH_HEAD")?;
    let fetch_commit = repo.reference_to_annotated_commit(&fetch_head)?;

    let analysis = repo.merge_analysis(&[&fetch_commit])?;

    if analysis.0.is_up_to_date() {
        return Ok(MergeResult {
            success: true,
            message: "Already up to date".to_string(),
            has_conflicts: false,
            conflict_files: None,
        });
    } else if analysis.0.is_fast_forward() {
        let refname = format!("refs/heads/{}", branch_name);
        let mut reference = repo.find_reference(&refname)?;
        reference.set_target(fetch_commit.id(), "Fast forward")?;
        repo.set_head(&refname)?;
        repo.checkout_head(Some(git2::build::CheckoutBuilder::default().force()))?;
        return Ok(MergeResult {
            success: true,
            message: "Fast forward merge completed".to_string(),
            has_conflicts: false,
            conflict_files: None,
        });
    } else {
        repo.merge(&[&fetch_commit], None, None)?;

        let conflict_files = super::get_conflict_files(&state)?;
        if !conflict_files.is_empty() {
            return Ok(MergeResult {
                success: true,
                message: format!("Merge has {} conflict files to resolve", conflict_files.len()),
                has_conflicts: true,
                conflict_files: Some(conflict_files),
            });
        }

        let signature = repo.signature()?;
        let mut index = repo.index()?;
        let tree_id = index.write_tree()?;
        let tree = repo.find_tree(tree_id)?;

        let head_commit = repo.head()?.peel_to_commit()?;
        let parent_refs: [&git2::Commit; 1] = [&head_commit];

        repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            "Auto merge",
            &tree,
            &parent_refs,
        )?;

        Ok(MergeResult {
            success: true,
            message: "Merge completed successfully".to_string(),
            has_conflicts: false,
            conflict_files: None,
        })
    }
}

#[tauri::command]
pub fn git_push(remote: Option<&str>, branch: Option<&str>, state: State<AppState>) -> Result<String, AppError> {
    let repo_guard = state.repo.lock().unwrap();
    let repo = repo_guard.as_ref()
        .ok_or_else(|| AppError::PathError("No repository opened".to_string()))?;

    let ssh_config_opt = state.ssh_config.lock().unwrap().clone();
    let remote_name = remote.unwrap_or("origin");
    let branch_name = branch.unwrap_or("main");

    let mut remote = repo.find_remote(remote_name)?;

    let mut callbacks = RemoteCallbacks::new();
    let ssh_config_clone = ssh_config_opt.clone();
    callbacks.credentials(move |url, username_from_url, allowed_types| {
        ssh::create_ssh_credentials(
            ssh_config_clone.as_ref(),
            url,
            username_from_url,
            allowed_types,
        )
    });
    callbacks.push_transfer_progress(|current, total, bytes| {
        println!("Pushing: {}/{} objects ({} bytes)", current, total, bytes);
        true
    });

    let mut push_opts = PushOptions::new();
    push_opts.remote_callbacks(callbacks);

    let refspec = format!("refs/heads/{}:refs/heads/{}", branch_name, branch_name);
    println!("Pushing {} to {}...", branch_name, remote_name);
    remote.push(&[&refspec], Some(&mut push_opts))?;

    Ok("Push completed successfully".to_string())
}

#[tauri::command]
pub fn get_conflict_files(state: State<AppState>) -> Result<Vec<ConflictFile>, AppError> {
    super::get_conflict_files(&state)
}

#[tauri::command]
pub fn resolve_conflict(
    path: &str,
    resolved_content: &str,
    state: State<AppState>,
) -> Result<(), AppError> {
    super::resolve_conflict(path, resolved_content, &state)
}

#[tauri::command]
pub fn finalize_merge(commit_message: Option<&str>, state: State<AppState>) -> Result<String, AppError> {
    super::finalize_merge(&state, commit_message)
}

#[tauri::command]
pub fn abort_merge(state: State<AppState>) -> Result<String, AppError> {
    super::abort_merge(&state)
}
