import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

interface MarkdownPreviewProps {
  content: string;
  filePath: string;
}

export const MarkdownPreview: React.FC<MarkdownPreviewProps> = ({ content, filePath }) => {
  return (
    <div
      style={{
        padding: "24px 40px",
        height: "100%",
        overflow: "auto",
        backgroundColor: "#fefefe",
      }}
    >
      <div
        style={{
          fontSize: "12px",
          color: "#888",
          marginBottom: "16px",
          paddingBottom: "8px",
          borderBottom: "1px solid #eee",
        }}
      >
        📄 {filePath}
      </div>
      <div
        style={{
          maxWidth: "800px",
          margin: "0 auto",
          lineHeight: 1.8,
        }}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={{
            h1: ({ children }) => (
              <h1 style={{ borderBottom: "2px solid #3498db", paddingBottom: "8px" }}>
                {children}
              </h1>
            ),
            h2: ({ children }) => (
              <h2 style={{ borderBottom: "1px solid #bdc3c7", paddingBottom: "6px" }}>
                {children}
              </h2>
            ),
            code: ({ className, children }) => {
              const isBlock = className?.includes("language-");
              return isBlock ? (
                <pre
                  style={{
                    backgroundColor: "#2d2d2d",
                    color: "#f8f8f2",
                    padding: "16px",
                    borderRadius: "8px",
                    overflowX: "auto",
                  }}
                >
                  <code className={className}>{children}</code>
                </pre>
              ) : (
                <code
                  style={{
                    backgroundColor: "#f0f0f0",
                    padding: "2px 6px",
                    borderRadius: "4px",
                    fontFamily: "Consolas, Monaco, monospace",
                  }}
                >
                  {children}
                </code>
              );
            },
            blockquote: ({ children }) => (
              <blockquote
                style={{
                  borderLeft: "4px solid #3498db",
                  margin: "16px 0",
                  padding: "8px 16px",
                  backgroundColor: "#f8f9fa",
                  color: "#555",
                }}
              >
                {children}
              </blockquote>
            ),
            table: ({ children }) => (
              <table
                style={{
                  borderCollapse: "collapse",
                  width: "100%",
                  margin: "16px 0",
                }}
              >
                {children}
              </table>
            ),
            th: ({ children }) => (
              <th
                style={{
                  border: "1px solid #ddd",
                  padding: "8px 12px",
                  backgroundColor: "#f5f5f5",
                  textAlign: "left",
                }}
              >
                {children}
              </th>
            ),
            td: ({ children }) => (
              <td
                style={{
                  border: "1px solid #ddd",
                  padding: "8px 12px",
                }}
              >
                {children}
              </td>
            ),
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
};
