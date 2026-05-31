import React from 'react';

interface BandSelectorProps {
  bandNames: string[];
  redBandIndex: number;
  nirBandIndex: number;
  onRedBandChange: (index: number) => void;
  onNirBandChange: (index: number) => void;
  onCalculate: () => void;
  isCalculating: boolean;
}

const BandSelector: React.FC<BandSelectorProps> = ({
  bandNames,
  redBandIndex,
  nirBandIndex,
  onRedBandChange,
  onNirBandChange,
  onCalculate,
  isCalculating,
}) => {
  return (
    <div className="upload-section">
      <div className="band-selector">
        <div>
          <label style={{ display: 'block', marginBottom: '8px', color: '#94a3b8' }}>
            红波段 (Red)
          </label>
          <select
            value={redBandIndex}
            onChange={(e) => onRedBandChange(Number(e.target.value))}
            disabled={isCalculating}
          >
            {bandNames.map((name, index) => (
              <option key={index} value={index}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: '8px', color: '#94a3b8' }}>
            近红外波段 (NIR)
          </label>
          <select
            value={nirBandIndex}
            onChange={(e) => onNirBandChange(Number(e.target.value))}
            disabled={isCalculating}
          >
            {bandNames.map((name, index) => (
              <option key={index} value={index}>
                {name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <button
        className="calculate-btn"
        onClick={onCalculate}
        disabled={isCalculating || redBandIndex === nirBandIndex}
      >
        {isCalculating ? '计算中...' : '计算 NDVI (WASM)'}
      </button>
    </div>
  );
};

export default BandSelector;
