/** Convert normalized model-frame boxes to the visible stage when video uses object-fit: cover. */
export function coverTransform(videoW, videoH, stageW, stageH) {
  const scale = Math.max(stageW / videoW, stageH / videoH);
  const renderedW = videoW * scale;
  const renderedH = videoH * scale;
  return { scale, renderedW, renderedH, offsetX: (renderedW - stageW) / 2, offsetY: (renderedH - stageH) / 2 };
}

export function frameBoxToStageRect(box, videoW, videoH, stageW, stageH) {
  if (!videoW || !videoH || !stageW || !stageH || !box) return null;
  const { renderedW, renderedH, offsetX, offsetY } = coverTransform(videoW, videoH, stageW, stageH);
  const left = Math.max(0, box.x * renderedW - offsetX);
  const top = Math.max(0, box.y * renderedH - offsetY);
  const right = Math.min(stageW, (box.x + box.width) * renderedW - offsetX);
  const bottom = Math.min(stageH, (box.y + box.height) * renderedH - offsetY);
  if (right <= left || bottom <= top) return null;
  return { x: left / stageW, y: top / stageH, width: (right - left) / stageW, height: (bottom - top) / stageH };
}

export const AI_CLASSES = ['person', 'laptop', 'cell phone', 'keyboard', 'mouse', 'bottle', 'cup', 'scissors', 'book', 'clock'];
