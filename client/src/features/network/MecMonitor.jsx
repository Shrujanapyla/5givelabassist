import { useEffect, useMemo, useRef, useState } from 'react';
import './mec.css';

const HISTORY_LIMIT = 60;
const format = (value, suffix = ' ms') => Number.isFinite(value) ? `${value.toFixed(value < 10 ? 1 : 0)}${suffix}` : '—';
async function timedFetch(url, options = {}, timeout = 5000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeout);
  const start = performance.now();
  try {
    const response = await fetch(url, { ...options, cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await response.clone().arrayBuffer();
    return { response, elapsedMs: performance.now() - start };
  } finally { window.clearTimeout(timer); }
}

export default function MecMonitor({ serverUrl, token }) {
  const [running, setRunning] = useState(true);
  const [intervalSeconds, setIntervalSeconds] = useState(5);
  const [samples, setSamples] = useState([]);
  const [current, setCurrent] = useState({});
  const [interruptions, setInterruptions] = useState([]);
  const [probeCounts, setProbeCounts] = useState({ ok: 0, failed: 0 });
  const [services, setServices] = useState(null);
  const inFlight = useRef(false);
  const history = useMemo(() => samples.slice(-HISTORY_LIMIT), [samples]);
  useEffect(() => {
    if (!running || !token) return undefined;
    let cancelled = false;
    let count = 0;
    const measure = async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      const timestamp = Date.now();
      const auth = { Authorization: `Bearer ${token}` };
      try {
        const { elapsedMs } = await timedFetch(`${serverUrl}/api/mec/probe?t=${timestamp}`, { headers: auth });
        const next = { timestamp, rttMs: elapsedMs, apiMs: elapsedMs, available: true };
        count += 1;
        if (count % 6 === 1) {
          try {
            const bytes = 64 * 1024;
            const payload = new Uint8Array(bytes);
            const up = await timedFetch(`${serverUrl}/api/mec/upload`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/octet-stream' }, body: payload }, 8000);
            const receipt = await up.response.json();
            next.uplinkMbps = receipt.receivedBytes * 8 / up.elapsedMs / 1000;
            const down = await timedFetch(`${serverUrl}/api/mec/download?bytes=${bytes}&t=${timestamp}`, { headers: auth }, 8000);
            const received = await down.response.arrayBuffer();
            next.downlinkMbps = received.byteLength * 8 / down.elapsedMs / 1000;
          } catch { next.transferUnavailable = true; }
          try {
            const serviceResponse = await timedFetch(`${serverUrl}/api/mec/services`, { headers: auth });
            const serviceData = await serviceResponse.response.json();
            if (!cancelled) setServices(serviceData);
          } catch { if (!cancelled) setServices({ backendAvailable: true, aiConfigured: false, aiProcessAvailable: false }); }
        }
        if (!cancelled) {
          setCurrent(next);
          window.dispatchEvent(new CustomEvent('mec-measurement', { detail: next }));
          setProbeCounts((value) => ({ ...value, ok: value.ok + 1 }));
          setSamples((value) => [...value, next].slice(-HISTORY_LIMIT));
        }
      } catch {
        if (!cancelled) {
          const failed = { timestamp, available: false };
          setCurrent(failed);
          window.dispatchEvent(new CustomEvent('mec-measurement', { detail: failed }));
          setProbeCounts((value) => ({ ...value, failed: value.failed + 1 }));
          setInterruptions((value) => [...value, timestamp].slice(-20));
          setSamples((value) => [...value, failed].slice(-HISTORY_LIMIT));
        }
      } finally { inFlight.current = false; }
    };
    measure();
    const timer = window.setInterval(measure, intervalSeconds * 1000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [running, intervalSeconds, serverUrl, token]);

  const successful = history.filter((item) => item.available && Number.isFinite(item.rttMs));
  const meanRtt = successful.length ? successful.reduce((sum, item) => sum + item.rttMs, 0) / successful.length : NaN;
  const peakRtt = successful.length ? Math.max(...successful.map((item) => item.rttMs)) : NaN;
  const latestTransfer = [...history].reverse().find((item) => Number.isFinite(item.uplinkMbps));
  const transfers = history.filter((item) => Number.isFinite(item.uplinkMbps) && Number.isFinite(item.downlinkMbps));
  const averageThroughput = (key) => transfers.length ? transfers.reduce((sum, item) => sum + item[key], 0) / transfers.length : NaN;
  const peakThroughput = (key) => transfers.length ? Math.max(...transfers.map((item) => item[key])) : NaN;
  const successRate = probeCounts.ok + probeCounts.failed ? 100 * probeCounts.ok / (probeCounts.ok + probeCounts.failed) : NaN;
  const chartPoints = history.flatMap((item, index) => item.available && Number.isFinite(item.rttMs) ? [`${history.length < 2 ? 0 : index * 100 / (history.length - 1)},${100 - Math.min(100, item.rttMs / Math.max(1, peakRtt || 1) * 90)}`] : []).join(' ');
  const transferMax = Math.max(0.1, ...history.flatMap((item) => [item.uplinkMbps, item.downlinkMbps]).filter(Number.isFinite));
  const transferPoints = (key) => history.map((item, index) => Number.isFinite(item[key]) ? `${history.length < 2 ? 0 : index * 100 / (history.length - 1)},${100 - item[key] / transferMax * 90}` : null).filter(Boolean).join(' ');

  return <section className="panel mec-monitor" id="mec-monitor">
    <header className="mec-heading"><div><p className="eyebrow">DEVICE → MEC PATH</p><h2>5G &amp; Edge monitoring</h2><p className="muted">HTTP probes and controlled transfers to this application backend. Separate from WebRTC peer metrics; probe failures are not packet loss.</p></div><div className="mec-actions"><label>Interval <select value={intervalSeconds} onChange={(event) => setIntervalSeconds(Number(event.target.value))}><option value={3}>3 sec</option><option value={5}>5 sec</option><option value={10}>10 sec</option></select></label><button className="secondary-button" onClick={() => setRunning((value) => !value)}>{running ? 'Pause monitoring' : 'Resume monitoring'}</button></div></header>
    <div className="mec-cards">
      <Metric label="MEC round-trip time" value={format(current.rttMs)} detail={`Average ${format(meanRtt)} · Peak ${format(peakRtt)}`} />
      <Metric label="Estimated uplink" value={format(latestTransfer?.uplinkMbps, ' Mbps')} detail={`Average ${format(averageThroughput('uplinkMbps'), ' Mbps')} · Peak ${format(peakThroughput('uplinkMbps'), ' Mbps')}`} />
      <Metric label="Estimated downlink" value={format(latestTransfer?.downlinkMbps, ' Mbps')} detail={`Average ${format(averageThroughput('downlinkMbps'), ' Mbps')} · Peak ${format(peakThroughput('downlinkMbps'), ' Mbps')}`} />
      <Metric label="Probe health" value={Number.isFinite(successRate) ? `${successRate.toFixed(1)}%` : 'Waiting'} detail={`${probeCounts.ok} successful · ${probeCounts.failed} failed`} />
      <Metric label="MEC backend" value={current.available ? 'Available' : current.available === false ? 'Unavailable' : 'Checking'} detail="Authenticated application endpoint" />
      <Metric label="AI service process" value={!services ? 'Checking' : !services.aiConfigured ? 'Not configured' : services.aiProcessAvailable ? 'Available' : 'Unavailable'} detail="Process health only; model readiness is not guaranteed" />
    </div>
    <div className="mec-charts"><article className="mec-chart"><h3>Recent MEC RTT</h3>{successful.length < 2 ? <p className="muted">Collecting measurements…</p> : <svg viewBox="0 0 100 100" role="img" aria-label="Recent measured MEC round-trip time"><polyline points={chartPoints} fill="none" stroke="#2364a5" strokeWidth="2.5" vectorEffect="non-scaling-stroke" /></svg>}<small>Current API response is the same browser-observed HTTP duration; no server processing duration is inferred.</small></article><article className="mec-chart"><h3>Measured throughput history</h3>{latestTransfer ? <svg viewBox="0 0 100 100" role="img" aria-label="Measured uplink and downlink throughput"><polyline points={transferPoints('uplinkMbps')} fill="none" stroke="#2364a5" strokeWidth="2.5" vectorEffect="non-scaling-stroke"/><polyline points={transferPoints('downlinkMbps')} fill="none" stroke="#36a176" strokeWidth="2.5" vectorEffect="non-scaling-stroke"/></svg> : <p className="muted">Throughput tests run periodically; waiting for the first transfer.</p>}<small><span className="legend-up">● Uplink</span> · <span className="legend-down">● Downlink</span> · 64 KiB transferred per direction</small></article><article className="mec-chart"><h3>Probe interruptions</h3><p>{interruptions.length ? `${interruptions.length} failed probe(s) recorded` : 'No probe failures recorded in this browser session.'}</p><div className="interruptions">{history.map((item, index) => <span key={`${item.timestamp}-${index}`} title={new Date(item.timestamp).toLocaleTimeString()} className={item.available ? 'probe-ok' : 'probe-failed'} />)}</div><small>Probe success {Number.isFinite(successRate) ? `${successRate.toFixed(1)}%` : 'not yet available'} · {running ? 'Monitoring active' : 'Paused'}</small></article></div>
  </section>;
}

function Metric({ label, value, detail }) { return <article className="mec-metric"><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>; }
