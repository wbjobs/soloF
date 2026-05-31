import { useEffect, useRef, useState, useCallback } from 'react';
import { DepthOverlay } from './DepthOverlay';
import { ScaleBar } from './ScaleBar';

interface MicroscopeViewProps {
  stream: MediaStream | null;
  isLocal?: boolean;
  label?: string;
  scaleBarLength?: number;
  magnification?: number;
  scaleUnit?: string;
  onMagnificationChange?: (value: number) => void;
}

export function MicroscopeView({
  stream,
  isLocal = false,
  label,
  scaleBarLength = 0.2,
  magnification = 100,
  scaleUnit = 'μm',
  onMagnificationChange,
}: MicroscopeViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scaleBarContainerRef = useRef<HTMLDivElement>(null);
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);
  const [showDepth, setShowDepth] = useState(true);
  const [showWireframe, setShowWireframe] = useState(false);
  const [depthIntensity, setDepthIntensity] = useState(0.5);
  const [showScaleBar, setShowScaleBar] = useState(true);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [isPlaying, setIsPlaying] = useState(false);

  const attemptPlay = useCallback(async () => {
    if (!videoRef.current) return;
    try {
      await videoRef.current.play();
      setIsPlaying(true);
    } catch (err) {
      console.warn('Auto-play prevented:', err);
      setIsPlaying(false);
    }
  }, []);

  useEffect(() => {
    if (videoRef.current) {
      setVideoElement(videoRef.current);
    }
  }, []);

  useEffect(() => {
    if (!stream || !videoRef.current) return;

    setIsPlaying(false);
    videoRef.current.pause();
    videoRef.current.srcObject = null;

    const hasVideo = stream.getVideoTracks().length > 0;
    const hasAudio = stream.getAudioTracks().length > 0;

    const checkTracksReady = () => {
      const videoReady = !hasVideo || stream.getVideoTracks()[0].readyState === 'live';
      const audioReady = !hasAudio || stream.getAudioTracks()[0].readyState === 'live';
      return videoReady && audioReady;
    };

    if (checkTracksReady()) {
      videoRef.current.srcObject = stream;
      attemptPlay();
    } else {
      const checkInterval = setInterval(() => {
        if (checkTracksReady() && videoRef.current) {
          clearInterval(checkInterval);
          videoRef.current.srcObject = stream;
          attemptPlay();
        }
      }, 50);

      const timeout = setTimeout(() => {
        clearInterval(checkInterval);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          attemptPlay();
        }
      }, 1000);

      return () => {
        clearInterval(checkInterval);
        clearTimeout(timeout);
      };
    }
  }, [stream, attemptPlay]);

  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const { width, height } = containerRef.current.getBoundingClientRect();
        setDimensions({ width, height });
      }
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  return (
    <div className="microscope-view-container" style={containerStyle}>
      <div
        ref={containerRef}
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          backgroundColor: '#000',
          borderRadius: '8px',
          overflow: 'hidden',
        }}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
        />

        {showDepth && videoElement && (
          <DepthOverlay
            videoElement={videoElement}
            width={dimensions.width}
            height={dimensions.height}
            depthIntensity={depthIntensity}
            showWireframe={showWireframe}
          />
        )}

        {showScaleBar && (
          <div
            ref={scaleBarContainerRef}
            style={scaleBarContainerStyle}
          />
        )}

        {showScaleBar && (
          <ScaleBar
            container={scaleBarContainerRef.current}
            scaleBarLength={scaleBarLength}
            magnification={magnification}
            unit={scaleUnit}
            width={dimensions.width}
            height={dimensions.height}
          />
        )}

        {label && (
          <div style={labelStyle}>
            {label}
            {isLocal && ' (You)'}
          </div>
        )}

        {magnification > 0 && (
          <div style={magnificationStyle}>
            🔬 {magnification}x
          </div>
        )}

        {!isPlaying && !isLocal && stream && (
          <button
            onClick={attemptPlay}
            style={playButtonStyle}
          >
            ▶️ 点击播放
          </button>
        )}

        <div style={controlsStyle}>
          <label style={controlItemStyle}>
            <input
              type="checkbox"
              checked={showDepth}
              onChange={(e) => setShowDepth(e.target.checked)}
            />
            景深叠加
          </label>
          <label style={controlItemStyle}>
            <input
              type="checkbox"
              checked={showWireframe}
              onChange={(e) => setShowWireframe(e.target.checked)}
            />
            线框模式
          </label>
          <label style={controlItemStyle}>
            <input
              type="checkbox"
              checked={showScaleBar}
              onChange={(e) => setShowScaleBar(e.target.checked)}
            />
            数字标尺
          </label>
          <div style={sliderContainerStyle}>
            <span>景深强度:</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={depthIntensity}
              onChange={(e) => setDepthIntensity(parseFloat(e.target.value))}
            />
          </div>
          {onMagnificationChange && (
            <div style={sliderContainerStyle}>
              <span>倍率:</span>
              <input
                type="range"
                min="10"
                max="1000"
                step="10"
                value={magnification}
                onChange={(e) => onMagnificationChange(parseInt(e.target.value))}
              />
              <span style={{ minWidth: '40px', textAlign: 'right' }}>{magnification}x</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
};

const labelStyle: React.CSSProperties = {
  position: 'absolute',
  top: '12px',
  left: '12px',
  backgroundColor: 'rgba(0, 0, 0, 0.7)',
  color: '#fff',
  padding: '6px 12px',
  borderRadius: '4px',
  fontSize: '14px',
  zIndex: 10,
};

const controlsStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: '12px',
  right: '12px',
  backgroundColor: 'rgba(0, 0, 0, 0.7)',
  color: '#fff',
  padding: '10px',
  borderRadius: '6px',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  fontSize: '12px',
  zIndex: 10,
};

const controlItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  cursor: 'pointer',
};

const sliderContainerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
};

const playButtonStyle: React.CSSProperties = {
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  padding: '16px 32px',
  backgroundColor: 'rgba(0, 0, 0, 0.8)',
  color: '#fff',
  border: '2px solid rgba(255, 255, 255, 0.3)',
  borderRadius: '8px',
  fontSize: '18px',
  fontWeight: '600',
  cursor: 'pointer',
  zIndex: 20,
  backdropFilter: 'blur(4px)',
};

const scaleBarContainerStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  pointerEvents: 'none',
  zIndex: 5,
};

const magnificationStyle: React.CSSProperties = {
  position: 'absolute',
  top: '12px',
  right: '12px',
  backgroundColor: 'rgba(0, 0, 0, 0.7)',
  color: '#4ade80',
  padding: '6px 12px',
  borderRadius: '4px',
  fontSize: '14px',
  fontWeight: '600',
  zIndex: 10,
};
