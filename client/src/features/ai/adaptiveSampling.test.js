import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySamplingNetwork, nextSamplingProfile } from './adaptiveSampling.js';

test('classifies sustained poor and moderate MEC path conditions', () => {
  assert.equal(classifySamplingNetwork({ rttMs: 620 }), 'poor');
  assert.equal(classifySamplingNetwork({ uplinkMbps: 1 }), 'moderate');
  assert.equal(classifySamplingNetwork({ rttMs: 40, uplinkMbps: 20 }), 'good');
});

test('requires repeated degradation and hysteresis plus cooldown for recovery', () => {
  let state = { profile: 'good', changedAt: 0 };
  state = nextSamplingProfile({ rttMs: 600 }, state, 20_000);
  assert.equal(state.profile, 'good', 'one noisy sample does not change policy');
  state = nextSamplingProfile({ rttMs: 600 }, state, 20_001);
  assert.equal(state.profile, 'poor');
  state = nextSamplingProfile({ rttMs: 25, uplinkMbps: 20 }, state, 20_002);
  assert.equal(state.profile, 'poor', 'recovery requires several samples and cooldown');
});
