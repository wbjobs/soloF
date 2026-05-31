import React, { useState, useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "./api";
import { FileTree } from "./components/FileTree";
import { MarkdownPreview } from "./components/MarkdownPreview";
import { Toolbar } from "./components/Toolbar";
import { SshConfigModal } from "./components/SshConfigModal";
import { ConflictResolver } from "./components/ConflictResolver";
import type { ConflictFile, FileNode, GitStatus, SshConfig } from "./types";

const App: React.FC = () => {
  const [fileTree, setFileTree] = useState<FileNode | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [repoPath, setRepoPath] = useState<string | null>(null);
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [sshConfig, setSshConfig] = useState<SshConfig | null>(null);
  const [showSshModal, setShowSshModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [conflictFiles, setConflictFiles] = useState<ConflictFile[] | null>(null);

  const showMessage = useCallback((type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const status = await api.getGitStatus();
      setGitStatus(status);
    } catch (err) {
      console.error("Failed to get status:", err);
    }
  }, []);

  const handleOpenRepo = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "选择 Git 仓库目录",
      });

      if (selected && typeof selected === "string") {
        setLoading(true);
        await api.openRepository(selected);
        setRepoPath(selected);

        const tree = await api.getFileTree();
        setFileTree(tree);

        await refreshStatus();
        showMessage("success", "仓库已打开");
      }
    } catch (err) {
      console.error("Failed to open repo:", err);
      showMessage("error", `打开仓库失败: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectFile = async (path: string) => {
    if (!path.endsWith(".md")) {
      showMessage("error", "请选择 Markdown 文件");
      return;
    }

    try {
      setSelectedFile(path);
      const content = await api.readFile(path);
      setFileContent(content);
    } catch (err) {
      console.error("Failed to read file:", err);
      showMessage("error", `读取文件失败: ${err}`);
    }
  };

  const handlePull = async () => {
    try {
      setLoading(true);
      const result = await api.gitPull();

      if (result.has_conflicts && result.conflict_files) {
        setConflictFiles(result.conflict_files);
        showMessage("error", `发现 ${result.conflict_files.length} 个冲突文件，请解决冲突后继续`);
        return;
      }

      showMessage("success", result.message);

      const tree = await api.getFileTree();
      setFileTree(tree);
      if (selectedFile) {
        const content = await api.readFile(selectedFile);
        setFileContent(content);
      }
      await refreshStatus();
    } catch (err) {
      console.error("Pull failed:", err);
      showMessage("error", `Pull 失败: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const handleResolveConflicts = async (resolvedFiles: { path: string; content: string }[]) => {
    try {
      setLoading(true);

      for (const file of resolvedFiles) {
        await api.resolveConflict(file.path, file.content);
      }

      const mergeResult = await api.finalizeMerge();
      showMessage("success", mergeResult);
      setConflictFiles(null);

      const tree = await api.getFileTree();
      setFileTree(tree);
      if (selectedFile) {
        const content = await api.readFile(selectedFile);
        setFileContent(content);
      }
      await refreshStatus();
    } catch (err) {
      console.error("Resolve conflicts failed:", err);
      showMessage("error", `解决冲突失败: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const handleAbortMerge = async () => {
    try {
      setLoading(true);
      const result = await api.abortMerge();
      showMessage("success", result);
      setConflictFiles(null);

      const tree = await api.getFileTree();
      setFileTree(tree);
      if (selectedFile) {
        const content = await api.readFile(selectedFile);
        setFileContent(content);
      }
      await refreshStatus();
    } catch (err) {
      console.error("Abort merge failed:", err);
      showMessage("error", `取消合并失败: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const handlePush = async () => {
    try {
      setLoading(true);
      const result = await api.gitPush();
      showMessage("success", result);
      await refreshStatus();
    } catch (err) {
      console.error("Push failed:", err);
      showMessage("error", `Push 失败: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    try {
      setLoading(true);
      const tree = await api.getFileTree();
      setFileTree(tree);
      if (selectedFile) {
        const content = await api.readFile(selectedFile);
        setFileContent(content);
      }
      await refreshStatus();
      showMessage("success", "已刷新");
    } catch (err) {
      console.error("Refresh failed:", err);
      showMessage("error", `刷新失败: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSshConfigSave = async (config: SshConfig) => {
    try {
      await api.setSshConfig(config);
      setSshConfig(config);
      showMessage("success", `SSH 配置已保存${config.use_ssh_agent ? "（Agent 已启用）" : ""}`);
    } catch (err) {
      console.error("Failed to save SSH config:", err);
      showMessage("error", `保存 SSH 配置失败: ${err}`);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        margin: 0,
        padding: 0,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <Toolbar
        onOpenRepo={handleOpenRepo}
        onPull={handlePull}
        onPush={handlePush}
        onRefresh={handleRefresh}
        onSshConfig={() => setShowSshModal(true)}
        gitStatus={gitStatus}
        repoPath={repoPath}
        loading={loading}
      />

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <div
          style={{
            width: "280px",
            borderRight: "1px solid #e9ecef",
            overflow: "auto",
            backgroundColor: "#fafafa",
          }}
        >
          {fileTree ? (
            <FileTree
              node={fileTree}
              onSelectFile={handleSelectFile}
              selectedPath={selectedFile || undefined}
            />
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                color: "#999",
                fontSize: "14px",
                textAlign: "center",
                padding: "20px",
              }}
            >
              <div style={{ fontSize: "48px", marginBottom: "16px" }}>📁</div>
              <div>点击上方 "打开仓库" 按钮</div>
              <div style={{ marginTop: "8px" }}>选择一个 Git 仓库目录</div>
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflow: "hidden" }}>
          {selectedFile && fileContent ? (
            <MarkdownPreview content={fileContent} filePath={selectedFile} />
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                color: "#999",
                fontSize: "14px",
              }}
            >
              <div style={{ fontSize: "64px", marginBottom: "16px" }}>📝</div>
              <div>从左侧选择一个 Markdown 文件</div>
              <div style={{ marginTop: "8px" }}>文件内容将在此处预览</div>
            </div>
          )}
        </div>
      </div>

      {message && (
        <div
          style={{
            position: "fixed",
            bottom: "24px",
            right: "24px",
            padding: "12px 20px",
            borderRadius: "8px",
            color: "white",
            fontSize: "14px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
            zIndex: 2000,
            backgroundColor: message.type === "success" ? "#27ae60" : "#e74c3c",
          }}
        >
          {message.type === "success" ? "✅" : "❌"} {message.text}
        </div>
      )}

      <SshConfigModal
        isOpen={showSshModal}
        onClose={() => setShowSshModal(false)}
        onSave={handleSshConfigSave}
        currentConfig={sshConfig}
      />

      {conflictFiles && (
        <ConflictResolver
          conflictFiles={conflictFiles}
          onResolve={handleResolveConflicts}
          onAbort={handleAbortMerge}
        />
      )}
    </div>
  );
};

export default App;
