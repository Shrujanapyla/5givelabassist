import { useEffect, useRef, useState } from 'react';
import { nextSamplingProfile, SAMPLING_PROFILES } from './adaptiveSampling';

export default function AIAnalysisPanel({ videoRef, serverUrl, token, sessionCode, participantId, onDetections, onSelectRoi }) {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState('AI analysis is off.');
  const [detections, setDetections] = useState([]);
  const [manualMode, setManualMode] = useState('adaptive');
  const [profile, setProfile] = useState('good');
  const [metrics, setMetrics] = useState({ processed: 0, skipped: 0, requestMs: null, inferenceMs: null, responseMs: null, aiStatus: 'Idle', pending: 0, reason: 'Waiting for MEC measurements.' });
  const networkRef = useRef({});
  const smoothedNetworkRef = useRef({});
  const profileStateRef = useRef({ profile: 'good', changedAt: 0 });
  const inFlight = useRef(false);
  const onDetectionsRef = useRef(onDetections);
  useEffect(() => { onDetectionsRef.current = onDetections; }, [onDetections]);

  useEffect(() => {
    const receive = (event) => {
      const incoming = event.detail || {};
      const previous = smoothedNetworkRef.current;
      const smooth = (key) => Number.isFinite(incoming[key]) ? (Number.isFinite(previous[key]) ? previous[key] * 0.65 + incoming[key] * 0.35 : incoming[key]) : previous[key];
      smoothedNetworkRef.current = { rttMs: smooth('rttMs'), uplinkMbps: smooth('uplinkMbps') };
      networkRef.current = { ...networkRef.current, ...smoothedNetworkRef.current, available: incoming.available, recentFailures: incoming.available ? 0 : (networkRef.current.recentFailures || 0) + 1 };
      if (manualMode !== 'adaptive') return;
      const decision = nextSamplingProfile(networkRef.current, profileStateRef.current);
      profileStateRef.current = decision;
      if (decision.profile !== profile) {
        setProfile(decision.profile);
        setMetrics((value) => ({ ...value, reason: decision.profile === 'poor' ? 'Reduced after elevated MEC latency, low uplink, or repeated request failures.' : 'MEC path measurements indicate capacity for gradual recovery.' }));
      }
    };
    window.addEventListener('mec-measurement', receive);
    return () => window.removeEventListener('mec-measurement', receive);
  }, [manualMode, profile]);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    let timer;
    let failures = 0;
    const schedule = (delay) => { window.clearTimeout(timer); if (!cancelled) timer = window.setTimeout(sample, delay); };
    const sample = async () => {
      timer = undefined;
      const video = videoRef.current;
      if (!video || video.readyState < 2 || !video.videoWidth || inFlight.current) {
        setMetrics((value) => ({ ...value, skipped: value.skipped + 1, pending: inFlight.current ? 1 : 0 }));
        schedule(1000 / SAMPLING_PROFILES[profile].fps);
        return;
      }
      inFlight.current = true;
      setMetrics((value) => ({ ...value, pending: 1, aiStatus: 'Processing' }));
      const requestStarted = performance.now();
      try {
        const policy = SAMPLING_PROFILES[profile];
        const scale = Math.min(1, policy.maxWidth / video.videoWidth);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Video frame capture is unavailable in this browser.');
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const image = canvas.toDataURL('image/jpeg', profile === 'poor' ? 0.5 : profile === 'moderate' ? 0.6 : 0.68);
        const response = await fetch(`${serverUrl}/api/ai/detect`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ image, sessionCode, participantId, frameTimestamp: Date.now() }), signal: AbortSignal.timeout(20_000),
        });
        const data = await response.json();
        const requestMs = performance.now() - requestStarted;
        if (!response.ok) { const error = new Error(data.message || 'AI inference is unavailable.'); error.status = response.status; throw error; }
        if (cancelled) return;
        failures = 0;
        const nextDetections = Array.isArray(data.detections) ? data.detections : [];
        setDetections(nextDetections);
        onDetectionsRef.current?.(nextDetections, { ...data, sampledAt: Date.now() });
        const inferenceMs = Number.isFinite(Number(data.inferenceMs)) ? Number(data.inferenceMs) : null;
        setMetrics((value) => ({ ...value, processed: value.processed + 1, requestMs, inferenceMs, responseMs: requestMs, pending: 0, aiStatus: 'Available', reason: manualMode === 'adaptive' ? value.reason : `Manual ${profile} sampling override.` }));
        const labels = [...new Set(nextDetections.filter((item) => Number(item.confidence) >= 0.65).map((item) => item.label))];
        setStatus(labels.length ? `Detection alert: ${labels.join(', ')}. Review manually; not a safety alarm.` : `Detected ${nextDetections.length} object(s). Generic labels are advisory only.`);
      } catch (error) {
        if (!cancelled) {
          if ([400, 401, 403, 404].includes(error.status)) {
            setStatus(`${error.message} Sampling stopped. Correct the request or sign in again, then restart analysis.`);
            setEnabled(false);
          } else {
            failures += 1;
            networkRef.current.recentFailures = failures;
            if (manualMode === 'adaptive') {
              const decision = nextSamplingProfile(networkRef.current, profileStateRef.current);
              profileStateRef.current = decision; setProfile(decision.profile);
            }
            const retryMs = Math.min(30_000, 1000 * (2 ** Math.min(failures, 5)));
            setStatus(`${error.message} Retrying in ${Math.round(retryMs / 1000)} seconds.`);
            setMetrics((value) => ({ ...value, skipped: value.skipped + 1, pending: 0, aiStatus: 'Unavailable', requestMs: performance.now() - requestStarted, reason: 'Inference request failed; sampling backed off.' }));
            schedule(Math.max(retryMs, 1000 / SAMPLING_PROFILES[profile].fps));
          }
        }
      } finally {
        inFlight.current = false;
        if (!cancelled && timer === undefined) schedule(1000 / SAMPLING_PROFILES[profile].fps);
      }
    };
    sample();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [enabled, videoRef, serverUrl, token, sessionCode, participantId, profile, manualMode]);

  const settings = SAMPLING_PROFILES[profile];
  return <section className="ai-panel" aria-label="AI object assistance">
    <div className="ai-panel-heading"><div><strong>AI object assistance</strong><p role={status.startsWith('Detection alert:') ? 'alert' : 'status'}>{status}</p></div><button type="button" onClick={() => setEnabled((value) => !value)}>{enabled ? 'Stop AI analysis' : 'Start AI analysis'}</button></div>
    <div className="ai-metrics"><label>Sampling policy <select value={manualMode === 'adaptive' ? 'adaptive' : profile} onChange={(event) => { const value = event.target.value; setManualMode(value); if (value !== 'adaptive') setProfile(value); else setMetrics((current) => ({ ...current, reason: 'Adaptive mode uses current MEC probe measurements.' })); }}><option value="adaptive">Adaptive</option><option value="good">Manual · Good</option><option value="moderate">Manual · Moderate</option><option value="poor">Manual · Poor</option></select></label><span>Network profile <strong>{profile}</strong></span><span>Sampling <strong>{settings.fps} FPS · max {settings.maxWidth}px</strong></span><span>Frame request duration <strong>{metrics.requestMs == null ? '—' : `${Math.round(metrics.requestMs)} ms`}</strong></span><span>AI inference <strong>{metrics.inferenceMs == null ? '—' : `${Math.round(metrics.inferenceMs)} ms`}</strong></span><span>End-to-end AI response <strong>{metrics.responseMs == null ? '—' : `${Math.round(metrics.responseMs)} ms`}</strong></span><span>Frames processed / skipped <strong>{metrics.processed} / {metrics.skipped}</strong></span><span>Pending requests <strong>{metrics.pending} / 1</strong></span><span>AI service <strong>{metrics.aiStatus}</strong></span><small>{metrics.reason}. Request duration includes upload, server queue/processing and download; a pure frame-upload time is not available from this browser flow.</small></div>
    {detections.length > 0 && <ul className="ai-detection-list">{detections.map((item, index) => <li key={`${item.label}-${index}`}><span><strong>{item.label}</strong> · {Math.round((item.confidence || 0) * 100)}%</span><button type="button" onClick={() => onSelectRoi?.(item)} disabled={!onSelectRoi}>Capture suggested ROI</button></li>)}</ul>}
    <small>Generic COCO object detector; detections and alerts are advisory and are not lab-specific or safety-critical.</small>
  </section>;
}
