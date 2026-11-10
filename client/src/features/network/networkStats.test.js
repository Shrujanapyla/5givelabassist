import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retainMetricsForPeers, summariseWebRtcStats } from './networkStats.js';
import { applyProfileToSender, nextAdaptiveDecision, QUALITY_PROFILES, smoothAdaptiveMetrics } from './adaptiveStreaming.js';

function report(records) { return new Map(records.map((item) => [item.id, item])); }

test('summarises selected candidate-pair RTT and video deltas', () => {
  const first = report([
    { id: 'pair', type: 'candidate-pair', state: 'succeeded', nominated: true, currentRoundTripTime: 0.04 },
    { id: 'in', type: 'inbound-rtp', kind: 'video', bytesReceived: 1000, packetsReceived: 100, packetsLost: 1, jitter: 0.01, framesDecoded: 10, timestamp: 1000, frameWidth: 640, frameHeight: 480 },
  ]);
  const initial = summariseWebRtcStats(first, new Map(), 1000, 'connected');
  const second = report([
    { id: 'pair', type: 'candidate-pair', state: 'succeeded', nominated: true, currentRoundTripTime: 0.05 },
    { id: 'in', type: 'inbound-rtp', kind: 'video', bytesReceived: 126000, packetsReceived: 199, packetsLost: 2, jitter: 0.012, framesDecoded: 35, timestamp: 2000, frameWidth: 640, frameHeight: 480 },
  ]);
  const result = summariseWebRtcStats(second, initial.counters, 2000, 'connected');
  assert.equal(result.metrics.rttMs, 50);
  assert.equal(result.metrics.jitterMs, 12);
  assert.equal(result.metrics.bitrateKbps, 1000);
  assert.equal(result.metrics.fps, 25);
  assert.equal(result.metrics.width, 640);
  assert.ok(result.metrics.packetLossPercent > 0);
});

test('adaptive policy steps down only after three poor samples', () => {
  let state = { profile: 'high', poorSamples: 0, goodSamples: 0, lastChangeAt: 0 };
  const poor = { packetLossPercent: 8, jitterMs: 55, bitrateKbps: 180, rttMs: 45, connectionState: 'connected' };
  state = nextAdaptiveDecision(poor, state, 6000);
  assert.equal(state.profile, 'high');
  state = nextAdaptiveDecision(poor, state, 7000);
  assert.equal(state.profile, 'high');
  state = nextAdaptiveDecision(poor, state, 8000);
  assert.equal(state.profile, 'medium');
  assert.equal(QUALITY_PROFILES.low.maxBitrate, 350000);
});

test('adaptive policy recovers one profile after sustained good samples', () => {
  let state = { profile: 'low', poorSamples: 0, goodSamples: 0, lastChangeAt: 0 };
  const good = { packetLossPercent: 0.2, jitterMs: 8, bitrateKbps: 900, rttMs: 30, connectionState: 'connected' };
  for (let i = 0; i < 8; i += 1) state = nextAdaptiveDecision(good, state, 7000 + i * 1000);
  assert.equal(state.profile, 'medium');
});


test('adaptive smoothing damps one noisy sample while retaining non-smoothed fields', () => {
  const next = smoothAdaptiveMetrics({ rttMs: 100, jitterMs: 30, packetLossPercent: 4, bitrateKbps: 500, fps: 24 }, { rttMs: 40, jitterMs: 10, packetLossPercent: 0, bitrateKbps: 1000 }, 0.25);
  assert.equal(next.rttMs, 55);
  assert.equal(next.jitterMs, 15);
  assert.equal(next.packetLossPercent, 1);
  assert.equal(next.bitrateKbps, 875);
  assert.equal(next.fps, 24);
});


test('uses remote-inbound feedback for sender-side loss and jitter when available', () => {
  const first = report([
    { id: 'pair', type: 'candidate-pair', state: 'succeeded', nominated: true, currentRoundTripTime: 0.04 },
    { id: 'out', type: 'outbound-rtp', kind: 'video', bytesSent: 1000, framesEncoded: 10, timestamp: 1000, frameWidth: 640, frameHeight: 480, remoteId: 'remote-in' },
    { id: 'remote-in', type: 'remote-inbound-rtp', kind: 'video', localId: 'out', packetsReceived: 100, packetsLost: 1, jitter: 0.01, timestamp: 1000 },
  ]);
  const initial = summariseWebRtcStats(first, new Map(), 1000, 'connected');
  const second = report([
    { id: 'pair', type: 'candidate-pair', state: 'succeeded', nominated: true, currentRoundTripTime: 0.05 },
    { id: 'out', type: 'outbound-rtp', kind: 'video', bytesSent: 126000, framesEncoded: 35, timestamp: 2000, frameWidth: 640, frameHeight: 480, remoteId: 'remote-in' },
    { id: 'remote-in', type: 'remote-inbound-rtp', kind: 'video', localId: 'out', packetsReceived: 199, packetsLost: 5, jitter: 0.012, timestamp: 2000 },
  ]);
  const result = summariseWebRtcStats(second, initial.counters, 2000, 'connected');
  assert.equal(result.metrics.direction, 'outbound');
  assert.equal(result.metrics.rttMs, 50);
  assert.equal(result.metrics.jitterMs, 12);
  assert.equal(result.metrics.bitrateKbps, 1000);
  assert.equal(result.metrics.fps, 25);
  assert.ok(result.metrics.packetLossPercent > 0);
});

test('applies the selected quality profile to supported sender encodings', async () => {
  let applied;
  const sender = {
    track: { kind: 'video' },
    getParameters: () => ({ encodings: [{ rid: 'f' }] }),
    setParameters: async (parameters) => { applied = parameters; },
  };
  assert.deepEqual(await applyProfileToSender(sender, 'low'), { applied: true });
  assert.equal(applied.encodings[0].maxBitrate, QUALITY_PROFILES.low.maxBitrate);
  assert.equal(applied.encodings[0].maxFramerate, QUALITY_PROFILES.low.maxFramerate);
  assert.equal(applied.encodings[0].scaleResolutionDownBy, QUALITY_PROFILES.low.scaleResolutionDownBy);
});

test('clears endpoint and sender metrics for peers no longer in the call', () => {
  const retained = retainMetricsForPeers({
    socketA: { rttMs: 20 },
    'remote-student-a': { rttMs: 25 },
    socketGone: { rttMs: 40 },
    'remote-student-gone': { rttMs: 45 },
  }, [{ socketId: 'socketA', participantId: 'student-a' }]);
  assert.deepEqual(Object.keys(retained), ['socketA', 'remote-student-a']);
});
