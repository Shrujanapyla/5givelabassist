/** Summarise browser WebRTC getStats() into endpoint metrics. Values are not 5G radio KPIs. */
export function summariseWebRtcStats(report, previous = new Map(), now = Date.now(), connectionState = 'unknown') {
  const records = [...report.values()];
  const pair = records.find((item) => item.type === 'candidate-pair' && (item.selected || (item.nominated && item.state === 'succeeded')))
    || records.find((item) => item.type === 'candidate-pair' && item.state === 'succeeded');
  const inbound = records.filter((item) => item.type === 'inbound-rtp' && (item.kind === 'video' || item.mediaType === 'video') && !item.isRemote);
  const outbound = records.filter((item) => item.type === 'outbound-rtp' && (item.kind === 'video' || item.mediaType === 'video') && !item.isRemote);
  const remoteInbound = records.filter((item) => item.type === 'remote-inbound-rtp' && (item.kind === 'video' || item.mediaType === 'video'));
  const video = inbound[0] || outbound[0] || null;
  const direction = inbound.length ? 'inbound' : outbound.length ? 'outbound' : 'unknown';

  // For a sender, packet-loss/jitter feedback is exposed (when supported) by
  // remote-inbound-rtp. Match it to the outbound stream via remoteId/localId.
  const feedbackById = new Map(remoteInbound.map((item) => [item.id, item]));
  const senderFeedback = outbound
    .map((item) => feedbackById.get(item.remoteId) || remoteInbound.find((feedback) => feedback.localId === item.id))
    .filter(Boolean);
  const packetReports = inbound.length ? inbound : senderFeedback;
  const byteAndFrameReports = inbound.length ? inbound : outbound;

  const currentCounters = new Map();
  let byteDelta = 0;
  let packetsReceivedDelta = 0;
  let packetsLostDelta = 0;
  let framesDelta = 0;
  let elapsedMs = 1000;

  for (const item of byteAndFrameReports) {
    const bytes = Number(item.bytesReceived ?? item.bytesSent ?? 0);
    const frames = Number(item.framesDecoded ?? item.framesEncoded ?? 0);
    const timestamp = Number(item.timestamp ?? now);
    const old = previous.get(item.id);
    currentCounters.set(item.id, { bytes, frames, timestamp });
    if (old) {
      const dt = Math.max(1, timestamp - old.timestamp);
      elapsedMs = dt;
      byteDelta += Math.max(0, bytes - old.bytes);
      framesDelta += Math.max(0, frames - old.frames);
    }
  }

  for (const item of packetReports) {
    const received = Math.max(0, Number(item.packetsReceived ?? 0));
    const lost = Math.max(0, Number(item.packetsLost ?? 0));
    const timestamp = Number(item.timestamp ?? now);
    const old = previous.get(item.id);
    currentCounters.set(item.id, { ...(currentCounters.get(item.id) || {}), received, lost, timestamp });
    if (old) {
      packetsReceivedDelta += Math.max(0, received - (old.received || 0));
      packetsLostDelta += Math.max(0, lost - (old.lost || 0));
      elapsedMs = Math.max(1, timestamp - old.timestamp);
    }
  }

  const packetTotal = packetsReceivedDelta + packetsLostDelta;
  const loss = packetTotal > 0 ? (packetsLostDelta / packetTotal) * 100 : null;
  const fps = video?.framesPerSecond != null
    ? Number(video.framesPerSecond)
    : elapsedMs > 0 && framesDelta > 0 ? (framesDelta * 1000) / elapsedMs : null;
  const bitrateKbps = byteDelta > 0 ? (byteDelta * 8) / Math.max(1, elapsedMs) : null;
  const feedback = senderFeedback[0];
  const rttSeconds = pair?.currentRoundTripTime ?? feedback?.roundTripTime;
  const jitterSource = inbound[0]?.jitter ?? feedback?.jitter;
  const jitterMs = jitterSource != null ? Number(jitterSource) * 1000 : null;
  const width = video?.frameWidth ? Number(video.frameWidth) : null;
  const height = video?.frameHeight ? Number(video.frameHeight) : null;

  let quality = 'unknown';
  if (connectionState === 'failed' || (loss != null && loss >= 8) || (jitterMs != null && jitterMs >= 60)) quality = 'poor';
  else if (connectionState === 'connected' && (loss == null || loss < 3) && (jitterMs == null || jitterMs < 30)) quality = 'good';
  else if (connectionState === 'connecting' || connectionState === 'new') quality = 'connecting';
  else if (connectionState !== 'unknown') quality = 'degraded';

  return {
    metrics: {
      rttMs: finiteOrNull(rttSeconds == null ? null : Number(rttSeconds) * 1000),
      jitterMs: finiteOrNull(jitterMs),
      packetLossPercent: finiteOrNull(loss), bitrateKbps: finiteOrNull(bitrateKbps),
      fps: finiteOrNull(fps), width, height, direction, quality,
      connectionState,
    },
    counters: currentCounters,
  };
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

export function formatMetric(value, suffix = '') {
  return Number.isFinite(value) ? `${Math.round(value * 10) / 10}${suffix}` : 'Unavailable';
}

/** Drop endpoint and sender rows as soon as their peer leaves the current call. */
export function retainMetricsForPeers(metrics, peers = []) {
  const sockets = new Set(peers.map((peer) => peer.socketId));
  const participants = new Set(peers.map((peer) => peer.participantId).filter(Boolean));
  return Object.fromEntries(Object.entries(metrics).filter(([key]) => (
    key.startsWith('remote-')
      ? participants.has(key.slice('remote-'.length))
      : sockets.has(key)
  )));
}
