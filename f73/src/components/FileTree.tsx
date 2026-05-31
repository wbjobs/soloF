import React, { useState } from "react";
import type { FileNode } from "../types";

interface FileTreeProps {
  node: FileNode;
  onSelectFile: (path: string) => void;
  selectedPath?: string;
}

const FileTreeItem: React.FC<FileTreeProps> = ({ node, onSelectFile, selectedPath }) => {
  const [expanded, setExpanded] = useState(true);

  const toggleExpand = () => {
    if (node.is_dir) {
      setExpanded(!expanded);
    }
  };

  const handleClick = () => {
    if (!node.is_dir) {
      onSelectFile(node.path);
    } else {
      toggleExpand();
    }
  };

  const isSelected = selectedPath === node.path;
  const isMarkdown = node.name.endsWith(".md");

  return (
    <div style={{ userSelect: "none" }}>
      <div
        onClick={handleClick}
        style={{
          padding: "4px 8px",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: "6px",
          backgroundColor: isSelected ? "#e8f0fe" : "transparent",
          borderRadius: "4px",
        }}
      >
        <span style={{ width: "16px", display: "inline-block" }}>
          {node.is_dir ? (expanded ? "▼" : "▶") : ""}
        </span>
        <span>{node.is_dir ? "📁" : isMarkdown ? "📝" : "📄"}</span>
        <span
          style={{
            color: isMarkdown ? "#2c3e50" : "#666",
            fontWeight: isSelected ? "600" : "normal",
          }}
        >
          {node.name}
        </span>
      </div>
      {node.is_dir && expanded && node.children && (
        <div style={{ marginLeft: "20px" }}>
          {node.children.map((child) => (
            <FileTreeItem
              key={child.path}
              node={child}
              onSelectFile={onSelectFile}
              selectedPath={selectedPath}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const FileTree: React.FC<FileTreeProps> = ({ node, onSelectFile, selectedPath }) => {
  return (
    <div style={{ padding: "8px" }}>
      <FileTreeItem node={node} onSelectFile={onSelectFile} selectedPath={selectedPath} />
    </div>
  );
};
