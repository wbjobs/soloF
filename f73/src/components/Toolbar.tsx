import React, { useState } from "react";
import type { GitStatus } from "../types";

interface ToolbarProps {
  onOpenRepo: () => void;
  onPull: () => void;
  onPush: () => void;
  onRefresh: () => void;
  onSshConfig: () => void;
  gitStatus: GitStatus | null;
  repoPath: string | null;
  loading: boolean;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  onOpenRepo,
  onPull,
  onPush,
  onRefresh,
  onSshConfig,
  gitStatus,
  repoPath,
  loading,
}) => {
  const [showStatus, setShowStatus] = useState(false);

  const buttonStyle: React.CSSProperties = {
    padding: "8px 16px",
    border: "none",
    borderRadius: "6px",
    cursor: loading ? "not-allowed" : "pointer",
    fontSize: "13px",
    fontWeight: 500,
    transition: "all 0.2s",
    opacity: loading ? 0.7 : 1,
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "12px 16px",
        backgroundColor: "#f8f9fa",
        borderBottom: "1px solid #e9ecef",
      }}
    >
      <button
        onClick={onOpenRepo}
        disabled={loading}
        style={{
          ...buttonStyle,
          backgroundColor: "#3498db",
          color: "white",
        }}
      >
        📂 打开仓库
      </button>

      {repoPath && (
        <>
          <button
            onClick={onPull}
            disabled={loading}
            style={{
              ...buttonStyle,
              backgroundColor: "#2ecc71",
              color: "white",
            }}
          >
            ⬇️ Pull
          </button>

          <button
            onClick={onPush}
            disabled={loading}
            style={{
              ...buttonStyle,
              backgroundColor: "#e74c3c",
              color: "white",
            }}
          >
            ⬆️ Push
          </button>

          <button
            onClick={onRefresh}
            disabled={loading}
            style={{
              ...buttonStyle,
              backgroundColor: "#95a5a6",
              color: "white",
            }}
          >
            🔄 刷新
          </button>

          <button
            onClick={onSshConfig}
            disabled={loading}
            style={{
              ...buttonStyle,
              backgroundColor: "#9b59b6",
              color: "white",
            }}
          >
            🔐 SSH 配置
          </button>

          <div style={{ flex: 1 }} />

          {gitStatus && (
            <button
              onClick={() => setShowStatus(!showStatus)}
              style={{
                ...buttonStyle,
                backgroundColor: "#f1c40f",
                color: "#333",
              }}
            >
              📊 状态 ({gitStatus.modified.length + gitStatus.added.length + gitStatus.deleted.length})
            </button>
          )}

          <div
            style={{
              fontSize: "12px",
              color: "#666",
              maxWidth: "300px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={repoPath}
          >
            📍 {repoPath}
          </div>
        </>
      )}

      {loading && (
        <div style={{ fontSize: "13px", color: "#3498db", marginLeft: "8px" }}>
          ⏳ 处理中...
        </div>
      )}

      {showStatus && gitStatus && (
        <div
          style={{
            position: "absolute",
            top: "60px",
            right: "16px",
            backgroundColor: "white",
            border: "1px solid #ddd",
            borderRadius: "8px",
            padding: "16px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            zIndex: 100,
            minWidth: "250px",
          }}
        >
          <h4 style={{ margin: "0 0 12px 0", color: "#333" }}>Git 状态</h4>
          {gitStatus.modified.length > 0 && (
            <div style={{ marginBottom: "8px" }}>
              <div style={{ color: "#e67e22", fontWeight: 600, marginBottom: "4px" }}>
                ✏️ 修改 ({gitStatus.modified.length})
              </div>
              {gitStatus.modified.map((f) => (
                <div key={f} style={{ fontSize: "12px", color: "#666", paddingLeft: "12px" }}>
                  {f}
                </div>
              ))}
            </div>
          )}
          {gitStatus.added.length > 0 && (
            <div style={{ marginBottom: "8px" }}>
              <div style={{ color: "#27ae60", fontWeight: 600, marginBottom: "4px" }}>
                ➕ 新增 ({gitStatus.added.length})
              </div>
              {gitStatus.added.map((f) => (
                <div key={f} style={{ fontSize: "12px", color: "#666", paddingLeft: "12px" }}>
                  {f}
                </div>
              ))}
            </div>
          )}
          {gitStatus.deleted.length > 0 && (
            <div>
              <div style={{ color: "#e74c3c", fontWeight: 600, marginBottom: "4px" }}>
                🗑️ 删除 ({gitStatus.deleted.length})
              </div>
              {gitStatus.deleted.map((f) => (
                <div key={f} style={{ fontSize: "12px", color: "#666", paddingLeft: "12px" }}>
                  {f}
                </div>
              ))}
            </div>
          )}
          {gitStatus.modified.length === 0 && gitStatus.added.length === 0 && gitStatus.deleted.length === 0 && (
            <div style={{ color: "#27ae60", fontSize: "13px" }}>
              ✅ 工作区干净
            </div>
          )}
        </div>
      )}
    </div>
  );
};
