import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import './FormulaPreview.css';

const FormulaPreview = ({ formulas }) => {
  const [selectedFormula, setSelectedFormula] = useState(null);
  const [filter, setFilter] = useState('all');
  const [columnFilter, setColumnFilter] = useState('all');

  const displayFormulas = formulas.slice(0, 50);

  const inlineFormulas = displayFormulas.filter(f => f.is_inline);
  const blockFormulas = displayFormulas.filter(f => !f.is_inline);
  const leftColumnFormulas = displayFormulas.filter(f => f.column === 0);
  const rightColumnFormulas = displayFormulas.filter(f => f.column === 1);

  let formulasToShow = displayFormulas;
  
  if (filter === 'inline') {
    formulasToShow = inlineFormulas;
  } else if (filter === 'block') {
    formulasToShow = blockFormulas;
  }
  
  if (columnFilter === 'left') {
    formulasToShow = formulasToShow.filter(f => f.column === 0);
  } else if (columnFilter === 'right') {
    formulasToShow = formulasToShow.filter(f => f.column === 1);
  }

  const copyToClipboard = (latex) => {
    navigator.clipboard.writeText(latex);
  };

  return (
    <div className="formula-preview-container">
      <div className="formula-header">
        <h3>🔢 识别的数学公式</h3>
        <div className="formula-filter">
          <div className="filter-group">
            <span className="filter-label">类型:</span>
            <button
              className={`filter-btn ${filter === 'all' ? 'active' : ''}`}
              onClick={() => setFilter('all')}
            >
              全部 ({displayFormulas.length})
            </button>
            <button
              className={`filter-btn ${filter === 'inline' ? 'active' : ''}`}
              onClick={() => setFilter('inline')}
            >
              行内 ({inlineFormulas.length})
            </button>
            <button
              className={`filter-btn ${filter === 'block' ? 'active' : ''}`}
              onClick={() => setFilter('block')}
            >
              行间 ({blockFormulas.length})
            </button>
          </div>
          <div className="filter-group">
            <span className="filter-label">栏目:</span>
            <button
              className={`filter-btn ${columnFilter === 'all' ? 'active' : ''}`}
              onClick={() => setColumnFilter('all')}
            >
              全部
            </button>
            <button
              className={`filter-btn ${columnFilter === 'left' ? 'active' : ''}`}
              onClick={() => setColumnFilter('left')}
            >
              左栏 ({leftColumnFormulas.length})
            </button>
            <button
              className={`filter-btn ${columnFilter === 'right' ? 'active' : ''}`}
              onClick={() => setColumnFilter('right')}
            >
              右栏 ({rightColumnFormulas.length})
            </button>
          </div>
        </div>
      </div>

      <div className="formula-list">
        {formulasToShow.length === 0 ? (
          <div className="no-formulas">
            <p>暂未检测到数学公式</p>
          </div>
        ) : (
          formulasToShow.map((formula, index) => (
            <div
              key={index}
              className={`formula-item ${selectedFormula === index ? 'selected' : ''}`}
              onClick={() => setSelectedFormula(selectedFormula === index ? null : index)}
            >
              <div className="formula-preview">
                {formula.is_inline ? (
                  <span className="inline-formula">
                    <ReactMarkdown
                      remarkPlugins={[remarkMath]}
                      rehypePlugins={[rehypeKatex]}
                    >
                      {`$${formula.latex}$`}
                    </ReactMarkdown>
                  </span>
                ) : (
                  <div className="block-formula">
                    <ReactMarkdown
                      remarkPlugins={[remarkMath]}
                      rehypePlugins={[rehypeKatex]}
                    >
                      {`$$\n${formula.latex}\n$$`}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
              <div className="formula-info">
                <span className="formula-page">第 {formula.page} 页</span>
                <span className={`formula-type ${formula.is_inline ? 'inline' : 'block'}`}>
                  {formula.is_inline ? '行内' : '行间'}
                </span>
                <span className={`formula-column ${formula.column === 0 ? 'left' : 'right'}`}>
                  {formula.column === 0 ? '左栏' : '右栏'}
                </span>
              </div>
              {selectedFormula === index && (
                <div className="formula-detail">
                  <div className="latex-code">
                    <code>{formula.latex}</code>
                  </div>
                  <button
                    className="copy-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      copyToClipboard(formula.latex);
                    }}
                  >
                    📋 复制LaTeX
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default FormulaPreview;
