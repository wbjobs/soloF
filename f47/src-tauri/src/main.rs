use git2::{Commit, Diff, DiffFindOptions, Repository};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::mpsc;
use std::thread;

#[derive(Debug, Serialize, Deserialize, Clone)]
struct CommitInfo {
    id: String,
    author: String,
    email: String,
    message: String,
    timestamp: i64,
    lines_added: usize,
    lines_deleted: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct AuthorStats {
    total_commits: usize,
    total_lines_added: usize,
    total_lines_deleted: usize,
    first_commit: i64,
    last_commit: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct CodeOwnership {
    author: String,
    lines: usize,
    percentage: f64,
}

#[derive(Debug, Serialize, Deserialize)]
struct AnalysisResult {
    commits: Vec<CommitInfo>,
    author_stats: HashMap<String, AuthorStats>,
    code_ownership: Vec<CodeOwnership>,
}

#[derive(Debug, Serialize, Clone)]
struct ProgressUpdate {
    stage: String,
    current: usize,
    total: usize,
    message: String,
}

#[derive(Debug, Clone)]
struct CommitData {
    id: git2::Oid,
    author_name: String,
    author_email: String,
    message: String,
    timestamp: i64,
    tree_id: git2::Oid,
    parent_tree_id: Option<git2::Oid>,
}

fn get_commit_stats_from_trees(
    repo: &Repository,
    tree_id: git2::Oid,
    parent_tree_id: Option<git2::Oid>,
) -> (usize, usize) {
    let mut lines_added = 0;
    let mut lines_deleted = 0;

    let commit_tree = match repo.find_tree(tree_id) {
        Ok(tree) => tree,
        Err(_) => return (0, 0),
    };

    let parent_tree = parent_tree_id.and_then(|id| repo.find_tree(id).ok());

    let mut diff = match Diff::tree_to_tree(
        repo,
        parent_tree.as_ref(),
        Some(&commit_tree),
        None,
    ) {
        Ok(d) => d,
        Err(_) => return (0, 0),
    };

    let mut find_opts = DiffFindOptions::new();
    find_opts.renames(true).copies(true);
    let _ = diff.find_similar(Some(&mut find_opts));

    let _ = diff.foreach(
        &mut |_, _| true,
        None,
        None,
        Some(&mut |_, hunk| {
            lines_added += hunk.new_lines() as usize;
            lines_deleted += hunk.old_lines() as usize;
            true
        }),
    );

    (lines_added, lines_deleted)
}

fn collect_commit_data(
    repo: &Repository,
    progress_sender: &mpsc::Sender<ProgressUpdate>,
) -> Result<Vec<CommitData>, String> {
    let mut revwalk = repo.revwalk().map_err(|e| e.to_string())?;
    revwalk.push_head().map_err(|e| e.to_string())?;
    revwalk.set_sorting(git2::Sort::TIME).map_err(|e| e.to_string())?;

    let oids: Vec<git2::Oid> = revwalk
        .map(|oid| oid.map_err(|e| e.to_string()))
        .collect::<Result<_, _>>()?;

    let total = oids.len();

    let _ = progress_sender.send(ProgressUpdate {
        stage: "collecting".to_string(),
        current: 0,
        total,
        message: format!("正在收集 {} 次提交的元数据...", total),
    });

    let mut commit_data = Vec::with_capacity(total);

    for (idx, oid) in oids.iter().enumerate() {
        let commit = repo.find_commit(*oid).map_err(|e| e.to_string())?;
        let author = commit.author();

        let parent_tree_id = if commit.parent_count() > 0 {
            commit.parent(0).ok().and_then(|p| p.tree_id())
        } else {
            None
        };

        commit_data.push(CommitData {
            id: *oid,
            author_name: author.name().unwrap_or("Unknown").to_string(),
            author_email: author.email().unwrap_or("unknown").to_string(),
            message: commit.message().unwrap_or("").to_string(),
            timestamp: commit.time().seconds(),
            tree_id: commit.tree_id(),
            parent_tree_id,
        });

        if (idx + 1) % 100 == 0 || idx + 1 == total {
            let _ = progress_sender.send(ProgressUpdate {
                stage: "collecting".to_string(),
                current: idx + 1,
                total,
                message: format!("正在收集提交元数据: {}/{}", idx + 1, total),
            });
        }
    }

    Ok(commit_data)
}

fn process_commit_diffs(
    repo: &Repository,
    commit_data: &[CommitData],
    progress_sender: &mpsc::Sender<ProgressUpdate>,
) -> Result<Vec<CommitInfo>, String> {
    let total = commit_data.len();
    let (result_sender, result_receiver) = mpsc::channel();

    let _ = progress_sender.send(ProgressUpdate {
        stage: "processing".to_string(),
        current: 0,
        total,
        message: format!("正在分析 {} 次提交的代码差异...", total),
    });

    let num_threads = num_cpus::get();
    let chunk_size = (total / num_threads).max(1);
    let chunks: Vec<&[CommitData]> = commit_data.chunks(chunk_size).collect();

    let repo_path = repo.path().to_path_buf();

    thread::scope(|s| {
        for chunk in chunks {
            let result_sender = result_sender.clone();
            let repo_path = repo_path.clone();

            s.spawn(move || {
                let repo = match Repository::open(&repo_path) {
                    Ok(r) => r,
                    Err(_) => return,
                };

                for data in chunk {
                    let (lines_added, lines_deleted) =
                        get_commit_stats_from_trees(&repo, data.tree_id, data.parent_tree_id);

                    let commit_info = CommitInfo {
                        id: data.id.to_string(),
                        author: data.author_name.clone(),
                        email: data.author_email.clone(),
                        message: data.message.clone(),
                        timestamp: data.timestamp,
                        lines_added,
                        lines_deleted,
                    };

                    let _ = result_sender.send(commit_info);
                }
            });
        }
    });

    drop(result_sender);

    let mut commits: Vec<CommitInfo> = result_receiver.iter().collect();

    commits.sort_by_key(|c| std::cmp::Reverse(c.timestamp));

    let _ = progress_sender.send(ProgressUpdate {
        stage: "processing".to_string(),
        current: total,
        total,
        message: "提交分析完成！".to_string(),
    });

    Ok(commits)
}

fn calculate_author_stats_parallel(commits: &[CommitInfo]) -> HashMap<String, AuthorStats> {
    let chunk_size = (commits.len() / num_cpus::get()).max(100);

    let partial_stats: Vec<HashMap<String, AuthorStats>> = commits
        .par_chunks(chunk_size)
        .map(|chunk| {
            let mut stats: HashMap<String, AuthorStats> = HashMap::new();
            for commit in chunk {
                let entry = stats.entry(commit.author.clone()).or_insert(AuthorStats {
                    total_commits: 0,
                    total_lines_added: 0,
                    total_lines_deleted: 0,
                    first_commit: i64::MAX,
                    last_commit: i64::MIN,
                });
                entry.total_commits += 1;
                entry.total_lines_added += commit.lines_added;
                entry.total_lines_deleted += commit.lines_deleted;
                entry.first_commit = entry.first_commit.min(commit.timestamp);
                entry.last_commit = entry.last_commit.max(commit.timestamp);
            }
            stats
        })
        .collect();

    let mut final_stats: HashMap<String, AuthorStats> = HashMap::new();
    for partial in partial_stats {
        for (author, stats) in partial {
            let entry = final_stats.entry(author).or_insert(AuthorStats {
                total_commits: 0,
                total_lines_added: 0,
                total_lines_deleted: 0,
                first_commit: i64::MAX,
                last_commit: i64::MIN,
            });
            entry.total_commits += stats.total_commits;
            entry.total_lines_added += stats.total_lines_added;
            entry.total_lines_deleted += stats.total_lines_deleted;
            entry.first_commit = entry.first_commit.min(stats.first_commit);
            entry.last_commit = entry.last_commit.max(stats.last_commit);
        }
    }

    final_stats
}

fn collect_files_from_tree(
    repo: &Repository,
    tree: &git2::Tree,
    prefix: &str,
    files: &mut Vec<String>,
) -> Result<(), String> {
    for entry in tree.iter() {
        let name = entry.name().ok_or("无效文件名")?.to_string();
        let path = if prefix.is_empty() {
            name
        } else {
            format!("{}/{}", prefix, name)
        };
        
        let object = entry.to_object(repo).map_err(|e| e.to_string())?;
        if let Some(subtree) = object.as_tree() {
            collect_files_from_tree(repo, subtree, &path, files)?;
        } else if object.as_blob().is_some() {
            files.push(path);
        }
    }
    Ok(())
}

fn analyze_code_ownership(
    repo: &Repository,
    progress_sender: &mpsc::Sender<ProgressUpdate>,
) -> Result<Vec<CodeOwnership>, String> {
    let head = repo.head().map_err(|e| format!("无法获取 HEAD: {}", e))?;
    let head_commit = head.peel_to_commit().map_err(|e| e.to_string())?;
    let tree = head_commit.tree().map_err(|e| e.to_string())?;

    let mut files = Vec::new();
    collect_files_from_tree(repo, &tree, "", &mut files)?;

    let total_files = files.len();
    let mut author_lines: HashMap<String, usize> = HashMap::new();
    let mut total_lines = 0;

    let _ = progress_sender.send(ProgressUpdate {
        stage: "ownership".to_string(),
        current: 0,
        total: total_files,
        message: format!("正在分析 {} 个文件的代码所有权...", total_files),
    });

    for (idx, file_path) in files.iter().enumerate() {
        let blame = match repo.blame_file(file_path, None) {
            Ok(b) => b,
            Err(_) => continue,
        };

        for hunk in blame.iter() {
            let lines = hunk.lines_in_hunk();
            let commit = match repo.find_commit(hunk.final_commit_id()) {
                Ok(c) => c,
                Err(_) => continue,
            };
            let author = commit.author();
            let author_name = author.name().unwrap_or("Unknown").to_string();
            
            *author_lines.entry(author_name).or_insert(0) += lines;
            total_lines += lines;
        }

        if (idx + 1) % 50 == 0 || idx + 1 == total_files {
            let _ = progress_sender.send(ProgressUpdate {
                stage: "ownership".to_string(),
                current: idx + 1,
                total: total_files,
                message: format!("代码所有权分析: {}/{} 文件", idx + 1, total_files),
            });
        }
    }

    let mut ownership: Vec<CodeOwnership> = author_lines
        .into_iter()
        .map(|(author, lines)| CodeOwnership {
            author,
            lines,
            percentage: if total_lines > 0 {
                (lines as f64 / total_lines as f64) * 100.0
            } else {
                0.0
            },
        })
        .collect();

    ownership.sort_by(|a, b| b.lines.cmp(&a.lines));

    Ok(ownership)
}

fn run_analysis(
    repo_path: PathBuf,
    progress_sender: mpsc::Sender<ProgressUpdate>,
) -> Result<AnalysisResult, String> {
    let _ = progress_sender.send(ProgressUpdate {
        stage: "loading".to_string(),
        current: 0,
        total: 100,
        message: "正在打开 Git 仓库...".to_string(),
    });

    let repo = Repository::open(&repo_path).map_err(|e| format!("无法打开仓库: {}", e))?;

    let commit_data = collect_commit_data(&repo, &progress_sender)?;

    let commits = process_commit_diffs(&repo, &commit_data, &progress_sender)?;

    let _ = progress_sender.send(ProgressUpdate {
        stage: "stats".to_string(),
        current: 0,
        total: 100,
        message: "正在计算作者统计...".to_string(),
    });

    let author_stats = calculate_author_stats_parallel(&commits);

    let code_ownership = analyze_code_ownership(&repo, &progress_sender)?;

    let _ = progress_sender.send(ProgressUpdate {
        stage: "complete".to_string(),
        current: 100,
        total: 100,
        message: "分析完成！".to_string(),
    });

    Ok(AnalysisResult {
        commits,
        author_stats,
        code_ownership,
    })
}

#[tauri::command]
fn analyze_repo(path: &str, window: tauri::Window) -> Result<AnalysisResult, String> {
    let repo_path = PathBuf::from(path);

    let (progress_sender, progress_receiver) = mpsc::channel();
    let (result_sender, result_receiver) = mpsc::channel();

    thread::spawn(move || {
        let result = run_analysis(repo_path, progress_sender);
        let _ = result_sender.send(result);
    });

    let window_clone = window.clone();
    thread::spawn(move || {
        for progress in progress_receiver {
            let _ = window_clone.emit("analysis_progress", progress);
        }
    });

    result_receiver.recv().map_err(|e| e.to_string())?
}

fn main() {
    rayon::ThreadPoolBuilder::new()
        .num_threads(num_cpus::get())
        .build_global()
        .unwrap();

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![analyze_repo])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
