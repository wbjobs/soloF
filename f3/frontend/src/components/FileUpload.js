import React, { useState, useRef } from 'react';
import { uploadPDF } from '../services/api';
import './FileUpload.css';

const FileUpload = ({ onUploadStart, onUploadProgress, onUploadComplete, onUploadError }) => {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFile(files[0]);
    }
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e) => {
    const files = e.target.files;
    if (files.length > 0) {
      handleFile(files[0]);
    }
  };

  const handleFile = async (file) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      onUploadError?.({ message: '请选择PDF文件' });
      return;
    }

    const maxSize = 20 * 1024 * 1024;
    if (file.size > maxSize) {
      onUploadError?.({ message: '文件大小不能超过20MB' });
      return;
    }

    try {
      onUploadStart?.();
      const result = await uploadPDF(file, onUploadProgress);
      onUploadComplete?.(result);
    } catch (error) {
      onUploadError?.({
        message: error.response?.data?.detail || error.message || '上传失败'
      });
    }
  };

  return (
    <div className="upload-container">
      <div
        className={`upload-area ${isDragging ? 'dragover' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClick}
      >
        <div className="upload-icon">📁</div>
        <h3>点击或拖拽上传PDF文件</h3>
        <p>支持科研论文，自动识别数学公式</p>
        <p className="upload-hint">最大文件大小: 20MB</p>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf"
        className="file-input"
        onChange={handleFileChange}
      />
    </div>
  );
};

export default FileUpload;
