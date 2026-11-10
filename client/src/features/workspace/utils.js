export const MIN_W = 240;
export const MIN_H = 200;
export const MIN_SCALE = 0.5;
export const MAX_SCALE = 8;
export const COMPACT_BREAKPOINT = 720;

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

export function uid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function formatTimestamp(ts) {
  if (!ts) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(ts));
}

export function formatShort(ts) {
  if (!ts) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(ts));
}

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function zoomAt(view, cx, cy, factor) {
  const scale = clamp(view.scale * factor, MIN_SCALE, MAX_SCALE);
  const r = scale / view.scale;
  return { scale, tx: cx - (cx - view.tx) * r, ty: cy - (cy - view.ty) * r };
}

export function clampLayout(l, b) {
  if (!b || !b.w || !b.h) return l;
  const w = clamp(l.w, MIN_W, Math.max(MIN_W, b.w));
  const h = clamp(l.h, MIN_H, Math.max(MIN_H, b.h));
  return {
    w,
    h,
    x: clamp(l.x, 0, Math.max(0, b.w - w)),
    y: clamp(l.y, 0, Math.max(0, b.h - h)),
  };
}
