export const SAMPLING_PROFILES = Object.freeze({
  good: { fps: 2, maxWidth: 640 },
  moderate: { fps: 1, maxWidth: 480 },
  poor: { fps: 0.5, maxWidth: 360 },
});

export function classifySamplingNetwork({ rttMs, uplinkMbps, recentFailures = 0, requestMs } = {}) {
  if (recentFailures >= 2 || (Number.isFinite(rttMs) && rttMs > 500) || (Number.isFinite(uplinkMbps) && uplinkMbps < 0.4) || (Number.isFinite(requestMs) && requestMs > 5000)) return 'poor';
  if ((Number.isFinite(rttMs) && rttMs > 180) || (Number.isFinite(uplinkMbps) && uplinkMbps < 1.5) || (Number.isFinite(requestMs) && requestMs > 2000) || recentFailures > 0) return 'moderate';
  return 'good';
}

export function nextSamplingProfile(sample, state = {}, now = Date.now(), { cooldownMs = 15_000, hysteresisSamples = 3 } = {}) {
  const current = SAMPLING_PROFILES[state.profile] ? state.profile : 'good';
  const target = classifySamplingNetwork(sample);
  if (target === current) return { profile: current, candidate: current, candidateSamples: 0, changedAt: state.changedAt || 0 };
  const rank = { good: 0, moderate: 1, poor: 2 };
  const candidateSamples = state.candidate === target ? (state.candidateSamples || 0) + 1 : 1;
  const worsening = rank[target] > rank[current];
  if (candidateSamples >= (worsening ? 2 : hysteresisSamples) && (worsening || now - (state.changedAt || 0) >= cooldownMs)) return { profile: target, candidate: target, candidateSamples: 0, changedAt: now };
  return { profile: current, candidate: target, candidateSamples, changedAt: state.changedAt || 0 };
}
