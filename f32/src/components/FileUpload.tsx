import React from 'react';
import type { GeoTIFFData } from '../types';

interface FileUploadProps {
  onFileLoaded: (data: GeoTIFFData, fileName: string) => void;
  isLoading: boolean;
}

const FileUpload: React.FC<FileUploadProps> = ({ onFileLoaded, isLoading }) => {
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const { parseGeoTIFF } = await import('../services/geotiffService');
      const data = await parseGeoTIFF(file);
      onFileLoaded(data, file.name);
    } catch (error) {
      console.error('解析 GeoTIFF 文件失败:', error);
      alert('GeoTIFF 文件解析失败，请检查文件格式');
    }
  };

  return (
    <div className="upload-section">
      <label className="file-input-wrapper">
        <input
          type="file"
          accept=".tif,.tiff"
          onChange={handleFileChange}
          disabled={isLoading}
        />
        {isLoading ? (
          <div className="loading">
            <div className="spinner" />
            <span>正在解析文件...</span>
          </div>
        ) : (
          <p>点击上传 GeoTIFF 遥感影像文件 (.tif, .tiff)</p>
        )}
      </label>
    </div>
  );
};

export default FileUpload;
