import { invoke } from "@tauri-apps/api/core";
import type { ConflictFile, FileNode, GitStatus, MergeResult, SshConfig } from "./types";

export const api = {
  openRepository: (path: string): Promise<void> =>
    invoke("open_repository", { path }),

  getFileTree: (): Promise<FileNode> =>
    invoke("get_file_tree"),

  readFile: (path: string): Promise<string> =>
    invoke("read_file", { path }),

  saveFile: (path: string, content: string): Promise<void> =>
    invoke("save_file", { path, content }),

  gitPull: (remote?: string, branch?: string): Promise<MergeResult> =>
    invoke("git_pull", { remote, branch }),

  gitPush: (remote?: string, branch?: string): Promise<string> =>
    invoke("git_push", { remote, branch }),

  getGitStatus: (): Promise<GitStatus> =>
    invoke("get_git_status"),

  setSshConfig: (config: SshConfig): Promise<void> =>
    invoke("set_ssh_config", { config }),

  getConflictFiles: (): Promise<ConflictFile[]> =>
    invoke("get_conflict_files"),

  resolveConflict: (path: string, resolvedContent: string): Promise<void> =>
    invoke("resolve_conflict", { path, resolvedContent }),

  finalizeMerge: (commitMessage?: string): Promise<string> =>
    invoke("finalize_merge", { commitMessage }),

  abortMerge: (): Promise<string> =>
    invoke("abort_merge"),
};
