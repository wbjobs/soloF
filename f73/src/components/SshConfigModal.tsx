import React, { useState } from "react";
import type { SshConfig } from "../types";

interface SshConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: SshConfig) => void;
  currentConfig?: SshConfig | null;
}

export const SshConfigModal: React.FC<SshConfigModalProps> = ({
  isOpen,
  onClose,
  onSave,
  currentConfig,
}) => {
  const [privateKeyPath, setPrivateKeyPath] = useState(currentConfig?.private_key_path || "");
  const [passphrase, setPassphrase] = useState(currentConfig?.passphrase || "");
  const [useSshAgent, setUseSshAgent] = useState(currentConfig?.use_ssh_agent ?? true);

  if (!isOpen) return null;

  const handleSave = () => {
    onSave({
      private_key_path: privateKeyPath,
      passphrase: passphrase || undefined,
      use_ssh_agent: useSshAgent,
    });
    onClose();
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: "white",
          borderRadius: "12px",
          padding: "24px",
          width: "480px",
          maxWidth: "90%",
          boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: "0 0 20px 0", color: "#333" }}>🔐 SSH 密钥配置</h2>

        <div style={{ marginBottom: "16px" }}>
          <label style={{ display: "block", marginBottom: "8px", color: "#555", fontSize: "14px" }}>
            私钥文件路径
          </label>
          <input
            type="text"
            value={privateKeyPath}
            onChange={(e) => setPrivateKeyPath(e.target.value)}
            placeholder="例如: C:\Users\username\.ssh\id_rsa"
            style={{
              width: "100%",
              padding: "10px 12px",
              border: "1px solid #ddd",
              borderRadius: "6px",
              fontSize: "14px",
              boxSizing: "border-box",
            }}
          />
          <div style={{ fontSize: "12px", color: "#888", marginTop: "4px" }}>
            提示: Windows 下通常是 %USERPROFILE%\.ssh\id_rsa
          </div>
        </div>

        <div style={{ marginBottom: "16px" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "10px", color: "#555", fontSize: "14px", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={useSshAgent}
              onChange={(e) => setUseSshAgent(e.target.checked)}
              style={{ width: "18px", height: "18px", cursor: "pointer" }}
            />
            <div>
              <div style={{ fontWeight: 500 }}>启用 SSH Agent 认证</div>
              <div style={{ fontSize: "12px", color: "#888" }}>优先使用系统 SSH Agent（Windows 推荐启用）</div>
            </div>
          </label>
        </div>

        <div style={{ marginBottom: "24px" }}>
          <label style={{ display: "block", marginBottom: "8px", color: "#555", fontSize: "14px" }}>
            密钥密码 (可选)
          </label>
          <input
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder="如果密钥有密码，请在此输入"
            style={{
              width: "100%",
              padding: "10px 12px",
              border: "1px solid #ddd",
              borderRadius: "6px",
              fontSize: "14px",
              boxSizing: "border-box",
            }}
          />
        </div>

        <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{
              padding: "10px 20px",
              border: "1px solid #ddd",
              borderRadius: "6px",
              backgroundColor: "white",
              cursor: "pointer",
              fontSize: "14px",
            }}
          >
            取消
          </button>
          <button
            onClick={handleSave}
            style={{
              padding: "10px 20px",
              border: "none",
              borderRadius: "6px",
              backgroundColor: "#3498db",
              color: "white",
              cursor: "pointer",
              fontSize: "14px",
              fontWeight: 500,
            }}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
};
