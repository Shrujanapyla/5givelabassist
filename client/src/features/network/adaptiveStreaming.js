export const QUALITY_PROFILES = {
  high: { label: 'High', maxBitrate: 1_500_000, scaleResolutionDownBy: 1, maxFramerate: 30 },
  medium: { label: 'Medium', maxBitrate: 800_000, scaleResolutionDownBy: 1.5, maxFramerate: 24 },
  low: { label: 'Low', maxBitrate: 350_000, scaleResolutionDownBy: 2, maxFramerate: 15 },
};

const ORDER = ['high', 'medium', 'low'];

const SMOOTHED_FIELDS = ['rttMs', 'jitterMs', 'packetLossPercent', 'bitrateKbps'];

/** Exponential moving average used by the adaptive policy to avoid reacting to one noisy sample. */
export function smoothAdaptiveMetrics(metrics, previous = null, alpha = 0.35) {
  const weight = Math.min(1, Math.max(0.05, Number(alpha) || 0.35));
  const smoothed = { ...metrics };
  for (const field of SMOOTHED_FIELDS) {
    const current = metrics?.[field];
    const old = previous?.[field];
    if (Number.isFinite(current)) {
      smoothed[field] = Number.isFinite(old)
        ? Math.round((weight * current + (1 - weight) * old) * 100) / 100
        : current;
    } else if (Number.isFinite(old)) {
      smoothed[field] = old;
    }
  }
  return smoothed;
}

export function nextAdaptiveDecision(metrics, state = { profile: 'high', poorSamples: 0, goodSamples: 0, lastChangeAt: 0 }, now = Date.now()) {
  const next = { ...state };
  const loss = metrics.packetLossPercent;
  const jitter = metrics.jitterMs;
  const rtt = metrics.rttMs;
  // Never step down on RTT alone: combine packet loss, jitter and measured throughput.
  const poor = (loss != null && loss >= 5)
    || (jitter != null && jitter >= 45)
    || (metrics.bitrateKbps != null && metrics.bitrateKbps < 250)
    || metrics.connectionState === 'failed';
  const good = metrics.connectionState === 'connected'
    && (loss == null || loss < 1.5)
    && (jitter == null || jitter < 25)
    && (metrics.bitrateKbps == null || metrics.bitrateKbps > 650)
    && (rtt == null || rtt < 250);
  next.poorSamples = poor ? state.poorSamples + 1 : 0;
  next.goodSamples = good ? state.goodSamples + 1 : 0;
  const cooldownPassed = now - (state.lastChangeAt || 0) >= 5000;

  if (cooldownPassed && next.poorSamples >= 3) {
    const index = ORDER.indexOf(state.profile);
    next.profile = ORDER[Math.min(ORDER.length - 1, index + 1)];
    next.poorSamples = 0;
    if (next.profile !== state.profile) next.lastChangeAt = now;
  } else if (cooldownPassed && next.goodSamples >= 8) {
    const index = ORDER.indexOf(state.profile);
    next.profile = ORDER[Math.max(0, index - 1)];
    next.goodSamples = 0;
    if (next.profile !== state.profile) next.lastChangeAt = now;
  }
  return next;
}

export async function applyProfileToSender(sender, profileName) {
  if (!sender || typeof sender.getParameters !== 'function' || typeof sender.setParameters !== 'function') {
    return { applied: false, reason: 'unsupported-browser' };
  }
  const profile = QUALITY_PROFILES[profileName];
  if (!profile) return { applied: false, reason: 'unknown-profile' };
  try {
    const parameters = sender.getParameters();
    if (!Array.isArray(parameters.encodings) || parameters.encodings.length === 0) parameters.encodings = [{}];
    parameters.encodings = parameters.encodings.map((encoding) => ({
      ...encoding,
      maxBitrate: profile.maxBitrate,
      maxFramerate: profile.maxFramerate,
      scaleResolutionDownBy: profile.scaleResolutionDownBy,
    }));
    await sender.setParameters(parameters);
    return { applied: true };
  } catch (error) {
    return { applied: false, reason: error?.name || 'set-parameters-failed', message: error?.message };
  }
}
