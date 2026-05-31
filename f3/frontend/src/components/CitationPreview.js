import React, { useState } from 'react';
import './CitationPreview.css';

const CitationPreview = ({ citations, citationCount, citationWithDoi }) => {
  const [selectedCitation, setSelectedCitation] = useState(null);
  const [filter, setFilter] = useState('all');
  const [copiedIndex, setCopiedIndex] = useState(null);

  const filteredCitations = citations.filter(c => {
    if (filter === 'all') return true;
    if (filter === 'with_doi') return c.doi;
    if (filter === 'without_doi') return !c.doi;
    if (filter === 'numeric') return c.type === 'numeric';
    if (filter === 'author_year') return c.type === 'author_year';
    return true;
  });

  const copyBibTeX = (bibtex, index) => {
    navigator.clipboard.writeText(bibtex);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const copyAllBibTeX = () => {
    const allBibtex = citations
      .filter(c => c.bibtex)
      .map(c => c.bibtex)
      .join('\n');
    navigator.clipboard.writeText(allBibtex);
  };

  return (
    <div className="citation-preview-container">
      <div className="citation-header">
        <h3>📚 参考文献</h3>
        <div className="citation-stats">
          <span className="stat-item">
            <span className="stat-number">{citationCount}</span>
            <span className="stat-label">已识别</span>
          </span>
          <span className="stat-item">
            <span className="stat-number">{citationWithDoi}</span>
            <span className="stat-label">已匹配</span>
          </span>
        </div>
        
        {citations.length > 0 && (
          <button className="copy-all-btn" onClick={copyAllBibTeX}>
            📋 复制全部 BibTeX
          </button>
        )}

        <div className="filter-group">
          <span className="filter-label">筛选:</span>
          <button
            className={`filter-btn ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >
            全部
          </button>
          <button
            className={`filter-btn ${filter === 'with_doi' ? 'active' : ''}`}
            onClick={() => setFilter('with_doi')}
          >
            已匹配 DOI
          </button>
          <button
            className={`filter-btn ${filter === 'without_doi' ? 'active' : ''}`}
            onClick={() => setFilter('without_doi')}
          >
            未匹配
          </button>
        </div>

        <div className="filter-group">
          <span className="filter-label">类型:</span>
          <button
            className={`filter-btn ${filter === 'numeric' ? 'active' : ''}`}
            onClick={() => setFilter('numeric')}
          >
            数字引用
          </button>
          <button
            className={`filter-btn ${filter === 'author_year' ? 'active' : ''}`}
            onClick={() => setFilter('author_year')}
          >
            作者年份
          </button>
        </div>
      </div>

      <div className="citation-list">
        {filteredCitations.length === 0 ? (
          <div className="no-citations">
            <p>未找到参考文献引用</p>
            <p className="hint">尝试上传包含引用标记的学术论文</p>
          </div>
        ) : (
          filteredCitations.map((citation, index) => (
            <div
              key={index}
              className={`citation-item ${selectedCitation === index ? 'selected' : ''}`}
              onClick={() => setSelectedCitation(selectedCitation === index ? null : index)}
            >
              <div className="citation-main">
                <div className="citation-marker">
                  <span className={`citation-type ${citation.type}`}>
                    {citation.type === 'numeric' ? '🔢' : '👤'}
                  </span>
                  <span className="citation-raw">{citation.raw_text}</span>
                </div>
                
                {citation.title && (
                  <div className="citation-title">
                    {citation.title}
                  </div>
                )}
                
                {citation.authors && citation.authors.length > 0 && (
                  <div className="citation-authors">
                    {citation.authors.slice(0, 3).join(', ')}
                    {citation.authors.length > 3 && ` 等`}
                  </div>
                )}
                
                {citation.doi && (
                  <div className="citation-doi">
                    <a 
                      href={`https://doi.org/${citation.doi}`} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      🔗 {citation.doi}
                    </a>
                  </div>
                )}
              </div>

              {selectedCitation === index && citation.bibtex && (
                <div className="citation-detail">
                  <div className="bibtex-header">
                    <span>BibTeX</span>
                    <button
                      className="copy-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        copyBibTeX(citation.bibtex, index);
                      }}
                    >
                      {copiedIndex === index ? '✓ 已复制' : '📋 复制'}
                    </button>
                  </div>
                  <pre className="bibtex-code">{citation.bibtex}</pre>
                  
                  {citation.journal && (
                    <div className="journal-info">
                      <strong>期刊:</strong> {citation.journal}
                    </div>
                  )}
                  
                  {citation.year && (
                    <div className="year-info">
                      <strong>年份:</strong> {citation.year}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default CitationPreview;
