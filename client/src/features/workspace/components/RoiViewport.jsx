import { useEffect, useRef } from 'react';
import { zoomAt, MIN_SCALE, MAX_SCALE } from '../utils';

/** Zoomable/pannable snapshot viewport with an optional shared drawing overlay. */
export default function RoiViewport({
  src,
  alt,
  view,
  onViewChange,
  annotations = [],
  drawingEnabled = false,
  drawColor = '#ff3333',
  onDrawComplete,
}) {
  const ref = useRef(null);
  const viewRef = useRef(view);
  const cbRef = useRef(onViewChange);
  const pointers = useRef(new Map());
  const prev = useRef(null);
  const strokeRef = useRef(null);

  viewRef.current = view;
  cbRef.current = onViewChange;

  const local = (clientX, clientY) => {
    const r = ref.current.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  };

  useEffect(() => {
    const el = ref.current;
    if (!el || drawingEnabled) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const { x, y } = local(e.clientX, e.clientY);
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      cbRef.current(zoomAt(viewRef.current, x, y, factor));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [drawingEnabled]);

  const gestureState = () => {
    const pts = [...pointers.current.values()];
    if (pts.length === 1) return { mid: pts[0], dist: 0 };
    const [a, b] = pts;
    return {
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      dist: Math.hypot(a.x - b.x, a.y - b.y),
    };
  };

  const onPointerDown = (e) => {
    if (drawingEnabled) {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.preventDefault();
      e.stopPropagation();
      const r = ref.current.getBoundingClientRect();
      const currentView = viewRef.current;
      const point = {
        x: Math.max(0, Math.min(1000, (((e.clientX - r.left - currentView.tx) / currentView.scale) / r.width) * 1000)),
        y: Math.max(0, Math.min(1000, (((e.clientY - r.top - currentView.ty) / currentView.scale) / r.height) * 1000)),
      };
      strokeRef.current = { id: `${Date.now()}-${Math.random()}`, color: drawColor, points: [point] };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, local(e.clientX, e.clientY));
    prev.current = gestureState();
  };

  const onPointerMove = (e) => {
    if (drawingEnabled && strokeRef.current) {
      const r = ref.current.getBoundingClientRect();
      const currentView = viewRef.current;
      const point = {
        x: Math.max(0, Math.min(1000, (((e.clientX - r.left - currentView.tx) / currentView.scale) / r.width) * 1000)),
        y: Math.max(0, Math.min(1000, (((e.clientY - r.top - currentView.ty) / currentView.scale) / r.height) * 1000)),
      };
      strokeRef.current.points.push(point);
      // Force a lightweight SVG update through a temporary attribute state.
      e.currentTarget.querySelector('[data-live-stroke]')?.setAttribute(
        'points',
        strokeRef.current.points.map((p) => `${p.x},${p.y}`).join(' ')
      );
      return;
    }

    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, local(e.clientX, e.clientY));
    const next = gestureState();
    const previous = prev.current;
    if (!previous) return;

    let nextView = viewRef.current;
    if (pointers.current.size >= 2 && previous.dist > 0) {
      nextView = zoomAt(nextView, next.mid.x, next.mid.y, next.dist / previous.dist);
    }
    nextView = {
      ...nextView,
      tx: nextView.tx + (next.mid.x - previous.mid.x),
      ty: nextView.ty + (next.mid.y - previous.mid.y),
    };
    prev.current = next;
    cbRef.current(nextView);
  };

  const onPointerUp = (e) => {
    if (drawingEnabled && strokeRef.current) {
      const stroke = strokeRef.current;
      strokeRef.current = null;
      if (stroke.points.length > 1) {
        onDrawComplete?.([...annotations, stroke]);
      }
      return;
    }
    pointers.current.delete(e.pointerId);
    prev.current = pointers.current.size ? gestureState() : null;
  };

  const zoomBy = (factor) => {
    const r = ref.current.getBoundingClientRect();
    onViewChange(zoomAt(view, r.width / 2, r.height / 2, factor));
  };
  const reset = () => onViewChange({ scale: 1, tx: 0, ty: 0 });

  return (
    <div
      ref={ref}
      className={`mrw-viewport${drawingEnabled ? ' is-drawing' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={drawingEnabled ? undefined : reset}
    >
      <div
        className="mrw-viewport__content"
        style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})` }}
      >
        {src ? <img src={src} alt={alt} draggable={false} /> : null}
        {src && (
          <svg
            className="mrw-ink"
            viewBox="0 0 1000 1000"
            preserveAspectRatio="none"
            aria-label="Snapshot annotations"
          >
            {annotations.map((stroke) => (
              <polyline
                key={stroke.id}
                points={stroke.points.map((point) => `${point.x},${point.y}`).join(' ')}
                fill="none"
                stroke={stroke.color || '#ff3333'}
                strokeWidth="5"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <polyline
              data-live-stroke
              fill="none"
              stroke={drawColor}
              strokeWidth="5"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        )}
      </div>
      {!src && <div className="mrw-viewport__empty">No snapshot</div>}
      {!drawingEnabled && (
        <div className="mrw-zoom" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => zoomBy(1 / 1.25)} disabled={view.scale <= MIN_SCALE} aria-label="Zoom out">−</button>
          <span aria-live="polite">{Math.round(view.scale * 100)}%</span>
          <button type="button" onClick={() => zoomBy(1.25)} disabled={view.scale >= MAX_SCALE} aria-label="Zoom in">+</button>
          <button type="button" onClick={reset} aria-label="Reset view">⟲</button>
        </div>
      )}
    </div>
  );
}
