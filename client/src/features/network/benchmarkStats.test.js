import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeSamples } from './benchmarkStats.js';

test('summarizes samples with arithmetic mean, even median and nearest-rank P95', () => {
  assert.deepEqual(summarizeSamples([8, 1, 4, 2]), { average: 3.75, median: 3, p95: 8 });
  assert.equal(summarizeSamples([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).p95, 10);
});

test('ignores non-finite values and reports no summary without measurements', () => {
  assert.deepEqual(summarizeSamples([2, Number.NaN, 4]), { average: 3, median: 3, p95: 4 });
  assert.equal(summarizeSamples([]), null);
});
