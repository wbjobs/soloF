import React, { useState, useMemo, useCallback } from "react";
import type { ConflictFile, ConflictBlock } from "../types";

interface ConflictResolverProps {
  conflictFiles: ConflictFile[];
  onResolve: (resolvedFiles: { path: string; content: string }[]) => void;
  onAbort: () => void;
}

interface ResolvedBlock {
  choice: "local" | "remote" | "both" | "custom";
  customContent: string;
}

export const ConflictResolver: React.FC<ConflictResolverProps> = ({
  conflictFiles,
  onResolve,
  onAbort,
}) => {
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const [currentConflictIndex, setCurrentConflictIndex] = useState(0);
  const [fileResolutions, setFileResolutions] = useState<
    Record<string, Record<number, ResolvedBlock>>
  >({});

  const currentFile = conflictFiles[currentFileIndex];
  const currentConflict = currentFile?.conflicts[currentConflictIndex];

  const getResolution = useCallback(
    (filePath: string, conflictIdx: number): ResolvedBlock => {
      return (
        fileResolutions[filePath]?.[conflictIdx] ?? {
          choice: "local",
          customContent: currentFile?.conflicts[conflictIdx]?.local_content ?? "",
        }
      );
    },
    [fileResolutions, currentFile]
  );

  const setResolution = useCallback(
    (filePath: string, conflictIdx: number, resolution: ResolvedBlock) => {
      setFileResolutions((prev) => ({
        ...prev,
        [filePath]: {
          ...prev[filePath],
          [conflictIdx]: resolution,
        },
      }));
    },
    []
  );

  const resolvedContent = useMemo(() => {
    if (!currentFile || !currentConflict) return "";

    const resolution = getResolution(currentFile.path, currentConflictIndex);

    if (resolution.choice === "local") {
      return currentConflict.local_content;
    } else if (resolution.choice === "remote") {
      return currentConflict.remote_content;
    } else if (resolution.choice === "both") {
      return `${currentConflict.local_content}\n${currentConflict.remote_content}`;
    } else {
      return resolution.customContent;
    }
  }, [currentFile, currentConflict, currentConflictIndex, getResolution]);

  const fileCompleteStatus = useMemo(() => {
    return conflictFiles.map((file) => {
      const resolved = file.conflicts.filter(
        (_, idx) => fileResolutions[file.path]?.[idx] !== undefined
      ).length;
      return {
        path: file.path,
        resolved,
        total: file.conflicts.length,
        complete: resolved === file.conflicts.length,
      };
    });
  }, [conflictFiles, fileResolutions]);

  const allComplete = fileCompleteStatus.every((f) => f.complete);

  const buildResolvedFileContent = (file: ConflictFile): string => {
    const lines = file.content.split("\n");
    const result: string[] = [];
    let lineIdx = 0;

    file.conflicts.forEach((conflict, cIdx) => {
      while (lineIdx < conflict.start_line - 1) {
        result.push(lines[lineIdx]);
        lineIdx++;
      }

      const resolution = getResolution(file.path, cIdx);
      let resolved: string;

      if (resolution.choice === "local") {
        resolved = conflict.local_content;
      } else if (resolution.choice === "remote") {
        resolved = conflict.remote_content;
      } else if (resolution.choice === "both") {
        resolved = `${conflict.local_content}\n${conflict.remote_content}`;
      } else {
        resolved = resolution.customContent;
      }

      result.push(resolved);
      lineIdx = conflict.end_line;
    });

    while (lineIdx < lines.length) {
      result.push(lines[lineIdx]);
      lineIdx++;
    }

    return result.join("\n");
  };

  const handleResolveAll = () => {
    const resolved = conflictFiles.map((file) => ({
      path: file.path,
      content: buildResolvedFileContent(file),
    }));
    onResolve(resolved);
  };

  const goToNextConflict = () => {
    if (currentConflictIndex < currentFile.conflicts.length - 1) {
      setCurrentConflictIndex(currentConflictIndex + 1);
    } else if (currentFileIndex < conflictFiles.length - 1) {
      setCurrentFileIndex(currentFileIndex + 1);
      setCurrentConflictIndex(0);
    }
  };

  const goToPrevConflict = () => {
    if (currentConflictIndex > 0) {
      setCurrentConflictIndex(currentConflictIndex - 1);
    } else if (currentFileIndex > 0) {
      setCurrentFileIndex(currentFileIndex - 1);
      const prevFile = conflictFiles[currentFileIndex - 1];
      setCurrentConflictIndex(prevFile.conflicts.length - 1);
    }
  };

  if (!currentFile || !currentConflict) {
    return null;
  }

  const currentResolution = getResolution(currentFile.path, currentConflictIndex);

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "#f5f5f5",
        zIndex: 3000,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          padding: "16px 24px",
          backgroundColor: "#e74c3c",
          color: "white",
          display: "flex",
          alignItems: "center",
          gap: "16px",
        }}
      >
        <div style={{ fontSize: "20px", fontWeight: 600 }}>
          ⚠️ Git 合并冲突
        </div>
        <div style={{ fontSize: "14px", opacity: 0.9 }}>
          文件 {currentFileIndex + 1} / {conflictFiles.length} | 冲突{" "}
          {currentConflictIndex + 1} / {currentFile.conflicts.length}
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: "13px" }}>
          已解决: {fileCompleteStatus.filter((f) => f.complete).length} /{" "}
          {conflictFiles.length} 文件
        </div>
      </div>

      <div
        style={{
          display: "flex",
          padding: "12px 24px",
          backgroundColor: "white",
          borderBottom: "1px solid #ddd",
          gap: "12px",
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {conflictFiles.map((file, idx) => (
            <div
              key={file.path}
              onClick={() => {
                setCurrentFileIndex(idx);
                setCurrentConflictIndex(0);
              }}
              style={{
                padding: "6px 12px",
                borderRadius: "6px",
                cursor: "pointer",
                fontSize: "13px",
                backgroundColor:
                  idx === currentFileIndex
                    ? "#3498db"
                    : fileCompleteStatus[idx].complete
                    ? "#27ae60"
                    : "#ecf0f1",
                color:
                  idx === currentFileIndex || fileCompleteStatus[idx].complete
                    ? "white"
                    : "#333",
              }}
            >
              {fileCompleteStatus[idx].complete ? "✅" : "⏳"} {file.path} (
              {file.conflicts.length})
            </div>
          ))}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flex: 1,
          overflow: "hidden",
          padding: "16px",
          gap: "12px",
        }}
      >
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            backgroundColor: "white",
            borderRadius: "8px",
            border: "1px solid #ddd",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "10px 16px",
              backgroundColor: "#3498db",
              color: "white",
              fontWeight: 600,
              fontSize: "13px",
            }}
          >
            👤 本地版本 (HEAD)
          </div>
          <pre
            style={{
              flex: 1,
              margin: 0,
              padding: "16px",
              fontFamily: "Consolas, Monaco, monospace",
              fontSize: "13px",
              lineHeight: 1.6,
              overflow: "auto",
              backgroundColor: "#f8f9fa",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {currentConflict.local_content || "(空)"}
          </pre>
        </div>

        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            backgroundColor: "white",
            borderRadius: "8px",
            border: "2px solid #f39c12",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "10px 16px",
              backgroundColor: "#f39c12",
              color: "white",
              fontWeight: 600,
              fontSize: "13px",
              display: "flex",
              alignItems: "center",
              gap: "12px",
            }}
          >
            <span>🔀 合并结果</span>
            <div style={{ display: "flex", gap: "6px", marginLeft: "auto" }}>
              <button
                onClick={() =>
                  setResolution(currentFile.path, currentConflictIndex, {
                    ...currentResolution,
                    choice: "local",
                  })
                }
                style={{
                  padding: "4px 10px",
                  border: "none",
                  borderRadius: "4px",
                  backgroundColor:
                    currentResolution.choice === "local" ? "#3498db" : "white",
                  color: currentResolution.choice === "local" ? "white" : "#333",
                  cursor: "pointer",
                  fontSize: "12px",
                }}
              >
                保留本地
              </button>
              <button
                onClick={() =>
                  setResolution(currentFile.path, currentConflictIndex, {
                    ...currentResolution,
                    choice: "remote",
                  })
                }
                style={{
                  padding: "4px 10px",
                  border: "none",
                  borderRadius: "4px",
                  backgroundColor:
                    currentResolution.choice === "remote" ? "#27ae60" : "white",
                  color: currentResolution.choice === "remote" ? "white" : "#333",
                  cursor: "pointer",
                  fontSize: "12px",
                }}
              >
                保留远程
              </button>
              <button
                onClick={() =>
                  setResolution(currentFile.path, currentConflictIndex, {
                    ...currentResolution,
                    choice: "both",
                  })
                }
                style={{
                  padding: "4px 10px",
                  border: "none",
                  borderRadius: "4px",
                  backgroundColor:
                    currentResolution.choice === "both" ? "#9b59b6" : "white",
                  color: currentResolution.choice === "both" ? "white" : "#333",
                  cursor: "pointer",
                  fontSize: "12px",
                }}
              >
                保留两者
              </button>
              <button
                onClick={() =>
                  setResolution(currentFile.path, currentConflictIndex, {
                    ...currentResolution,
                    choice: "custom",
                  })
                }
                style={{
                  padding: "4px 10px",
                  border: "none",
                  borderRadius: "4px",
                  backgroundColor:
                    currentResolution.choice === "custom" ? "#e67e22" : "white",
                  color: currentResolution.choice === "custom" ? "white" : "#333",
                  cursor: "pointer",
                  fontSize: "12px",
                }}
              >
                手动编辑
              </button>
            </div>
          </div>
          {currentResolution.choice === "custom" ? (
            <textarea
              value={currentResolution.customContent}
              onChange={(e) =>
                setResolution(currentFile.path, currentConflictIndex, {
                  ...currentResolution,
                  customContent: e.target.value,
                })
              }
              style={{
                flex: 1,
                padding: "16px",
                fontFamily: "Consolas, Monaco, monospace",
                fontSize: "13px",
                lineHeight: 1.6,
                border: "none",
                outline: "none",
                resize: "none",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            />
          ) : (
            <pre
              style={{
                flex: 1,
                margin: 0,
                padding: "16px",
                fontFamily: "Consolas, Monaco, monospace",
                fontSize: "13px",
                lineHeight: 1.6,
                overflow: "auto",
                backgroundColor: "#fffef5",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {resolvedContent || "(空)"}
            </pre>
          )}
        </div>

        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            backgroundColor: "white",
            borderRadius: "8px",
            border: "1px solid #ddd",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "10px 16px",
              backgroundColor: "#27ae60",
              color: "white",
              fontWeight: 600,
              fontSize: "13px",
            }}
          >
            🌐 远程版本 (FETCH_HEAD)
          </div>
          <pre
            style={{
              flex: 1,
              margin: 0,
              padding: "16px",
              fontFamily: "Consolas, Monaco, monospace",
              fontSize: "13px",
              lineHeight: 1.6,
              overflow: "auto",
              backgroundColor: "#f8f9fa",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {currentConflict.remote_content || "(空)"}
          </pre>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "16px 24px",
          backgroundColor: "white",
          borderTop: "1px solid #ddd",
          gap: "12px",
        }}
      >
        <button
          onClick={goToPrevConflict}
          disabled={currentFileIndex === 0 && currentConflictIndex === 0}
          style={{
            padding: "10px 20px",
            border: "1px solid #ddd",
            borderRadius: "6px",
            backgroundColor: "white",
            cursor:
              currentFileIndex === 0 && currentConflictIndex === 0
                ? "not-allowed"
                : "pointer",
            fontSize: "14px",
            opacity:
              currentFileIndex === 0 && currentConflictIndex === 0 ? 0.5 : 1,
          }}
        >
          ← 上一个冲突
        </button>

        <button
          onClick={goToNextConflict}
          disabled={
            currentFileIndex === conflictFiles.length - 1 &&
            currentConflictIndex === currentFile.conflicts.length - 1
          }
          style={{
            padding: "10px 20px",
            border: "1px solid #ddd",
            borderRadius: "6px",
            backgroundColor: "white",
            cursor:
              currentFileIndex === conflictFiles.length - 1 &&
              currentConflictIndex === currentFile.conflicts.length - 1
                ? "not-allowed"
                : "pointer",
            fontSize: "14px",
            opacity:
              currentFileIndex === conflictFiles.length - 1 &&
              currentConflictIndex === currentFile.conflicts.length - 1
                ? 0.5
                : 1,
          }}
        >
          下一个冲突 →
        </button>

        <div style={{ flex: 1 }} />

        <button
          onClick={onAbort}
          style={{
            padding: "10px 24px",
            border: "1px solid #e74c3c",
            borderRadius: "6px",
            backgroundColor: "white",
            color: "#e74c3c",
            cursor: "pointer",
            fontSize: "14px",
          }}
        >
          取消合并
        </button>

        <button
          onClick={handleResolveAll}
          disabled={!allComplete}
          style={{
            padding: "10px 24px",
            border: "none",
            borderRadius: "6px",
            backgroundColor: allComplete ? "#27ae60" : "#bdc3c7",
            color: "white",
            cursor: allComplete ? "pointer" : "not-allowed",
            fontSize: "14px",
            fontWeight: 600,
          }}
        >
          ✅ 完成合并
        </button>
      </div>
    </div>
  );
};
