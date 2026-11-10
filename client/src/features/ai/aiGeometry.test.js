import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameBoxToStageRect } from './aiGeometry.js';

test('frame boxes preserve coordinates when video and stage aspect ratios match', () => {
  const rect = frameBoxToStageRect({ x: .1, y: .2, width: .3, height: .4 }, 1000, 500, 1000, 500);
  assert.ok(Math.abs(rect.x - .1) < 1e-9);
  assert.ok(Math.abs(rect.y - .2) < 1e-9);
  assert.ok(Math.abs(rect.width - .3) < 1e-9);
  assert.ok(Math.abs(rect.height - .4) < 1e-9);
});

test('frame boxes are clipped to the visible cover-cropped stage', () => {
  const rect = frameBoxToStageRect({ x: .3, y: .2, width: .2, height: .2 }, 1000, 500, 500, 500);
  assert.ok(rect);
  assert.ok(rect.x >= 0 && rect.y >= 0 && rect.width <= 1 && rect.height <= 1);
});

test('boxes fully outside the cover-cropped frame are discarded', () => {
  const rect = frameBoxToStageRect({ x: 0, y: 0, width: .1, height: .1 }, 100, 100, 1000, 300);
  assert.equal(rect, null);
});
