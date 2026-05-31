export interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileNode[];
}

export interface GitStatus {
  modified: string[];
  added: string[];
  deleted: string[];
}

export interface SshConfig {
  private_key_path: string;
  passphrase?: string;
  use_ssh_agent: boolean;
}

export interface ConflictBlock {
  start_line: number;
  separator_line: number;
  end_line: number;
  local_content: string;
  remote_content: string;
}

export interface ConflictFile {
  path: string;
  content: string;
  conflicts: ConflictBlock[];
}

export interface MergeResult {
  success: boolean;
  message: string;
  has_conflicts: boolean;
  conflict_files?: ConflictFile[];
}
