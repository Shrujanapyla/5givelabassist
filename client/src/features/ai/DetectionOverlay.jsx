import { useEffect, useMemo, useState } from 'react';
import { frameBoxToStageRect } from './aiGeometry';

export default function DetectionOverlay({ detections = [], videoRef, stageRef }) {
  const [dimensions, setDimensions] = useState({ videoW: 0, videoH: 0, stageW: 0, stageH: 0 });
  useEffect(() => {
    const video = videoRef.current;
    const stage = stageRef.current;
    if (!stage) return undefined;
    const update = () => setDimensions({
      videoW: video?.videoWidth || 0,
      videoH: video?.videoHeight || 0,
      stageW: stage.clientWidth,
      stageH: stage.clientHeight,
    });
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    video?.addEventListener('loadedmetadata', update);
    update();
    return () => {
      observer.disconnect();
      video?.removeEventListener('loadedmetadata', update);
    };
  }, [videoRef, stageRef]);

  const boxes = useMemo(() => detections.map((item, index) => ({
    ...item,
    key: `${item.label}-${index}`,
    rect: frameBoxToStageRect(item.box, dimensions.videoW, dimensions.videoH, dimensions.stageW, dimensions.stageH),
  })).filter((item) => item.rect), [detections, dimensions]);

  if (!boxes.length) return null;
  return (
    <div className="ai-detection-overlay" aria-label="AI object detections">
      {boxes.map((item) => (
        <div key={item.key} className="ai-detection-box" style={{
          left: `${item.rect.x * 100}%`, top: `${item.rect.y * 100}%`,
          width: `${item.rect.width * 100}%`, height: `${item.rect.height * 100}%`,
        }}>
          <span>{item.label} · {Math.round((item.confidence || 0) * 100)}%</span>
        </div>
      ))}
    </div>
  );
}
