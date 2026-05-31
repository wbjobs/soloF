import React from 'react';
import './ProgressBar.css';

const ProgressBar = ({ progress, label }) => {
  return (
    <div className="progress-bar-container">
      {label && <div className="progress-label">{label}</div>}
      <div className="progress-bar-wrapper">
        <div
          className="progress-bar-fill"
          style={{ width: `${Math.min(progress, 100)}%` }}
        >
          <span className="progress-percent">{Math.round(progress)}%</span>
        </div>
      </div>
    </div>
  );
};

export default ProgressBar;
