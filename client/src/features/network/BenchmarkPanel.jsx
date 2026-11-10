import { useEffect, useState } from 'react';
import { summarizeSamples as summarize } from './benchmarkStats.js';
import './mec.css';
const ms = (value) => Number.isFinite(value) ? `${value.toFixed(1)} ms` : '—';

export default function BenchmarkPanel({ serverUrl, token, sessionCode }) {
  const [config, setConfig] = useState(null);
  const [image, setImage] = useState('');
  const [imageName, setImageName] = useState('');
  const [count, setCount] = useState(3);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState([]);
  const [history, setHistory] = useState([]);
  useEffect(() => {
    let alive = true;
    fetch(`${serverUrl}/api/benchmark/config`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('Configuration status unavailable.')))
      .then((data) => { if (alive) setConfig(data); }).catch((err) => { if (alive) setError(err.message); });
    return () => { alive = false; };
  }, [serverUrl, token]);
  const summary = summarize(results.filter((item) => item.ok).map((item) => item.clientTotalMs));

  async function chooseImage(file) {
    setError('');
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { setError('Choose a PNG, JPEG, or WebP sample image.'); return; }
    if (file.size > 750 * 1024) { setError('Image exceeds 750 KB. Resize or choose a smaller sample image.'); return; }
    const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
    if (dataUrl.length > 1_000_000) { setError('Image exceeds 750 KB. Resize or choose a smaller sample image.'); return; }
    setImage(dataUrl); setImageName(file.name);
  }
  async function runBenchmark() {
    if (!image || running || !sessionCode || !config?.mecConfigured) return;
    setRunning(true); setError(''); setResults([]);
    const collected = [];
    try {
      for (let i = 0; i < count; i += 1) {
        const started = performance.now();
        try {
          const response = await fetch(`${serverUrl}/api/benchmark/run`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ sessionCode, image }), cache: 'no-store', signal: AbortSignal.timeout(35_000) });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.message || 'Benchmark request failed.');
          collected.push({ ...payload.result, clientTotalMs: performance.now() - started });
        } catch (err) {
          collected.push({ configured: true, ok: false, error: err.message, clientTotalMs: performance.now() - started });
        }
        setResults([...collected]);
      }
      setHistory((items) => [{ at: new Date().toISOString(), summary: summarize(collected.filter((item) => item.ok).map((item) => item.clientTotalMs)), count }, ...items].slice(0, 10));
    } catch (err) { setError(err.name === 'TimeoutError' ? 'Benchmark timed out. Any completed sample measurements are retained.' : err.message); }
    finally { setRunning(false); }
  }
  const reset = () => { setResults([]); setHistory([]); setError(''); };

  return <section className="panel benchmark-panel" id="benchmark"><header className="mec-heading"><div><p className="eyebrow">CONTROLLED PROCESSING TEST</p><h2>MEC inference benchmark</h2><p className="muted">Uses one explicitly selected sample image and sends it to the configured MEC inference endpoint. No lab video is uploaded automatically.</p></div></header>
    <div className="benchmark-config"><span className={config?.mecConfigured ? 'config-ready' : 'config-missing'}>MEC inference {config === null ? 'checking…' : config.mecConfigured ? 'configured' : 'not configured'}</span></div>
    <div className="benchmark-controls"><label className="file-picker">Select test image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => chooseImage(event.target.files?.[0])} /></label><span className="muted">{imageName || 'No image selected'}</span><label>Samples <select value={count} onChange={(event) => setCount(Number(event.target.value))}><option value={3}>3</option><option value={5}>5</option><option value={10}>10</option></select></label><button className="primary-button" disabled={!image || running || !sessionCode || !config?.mecConfigured} onClick={runBenchmark}>{running ? 'Benchmarking…' : 'Run benchmark'}</button><button className="secondary-button" disabled={running} onClick={reset}>Reset results</button></div>
    {error && <p role="alert" className="benchmark-error">{error}</p>}
    {!sessionCode && <p className="muted">Join an active session as professor to run authorized benchmarks.</p>}
    {!config?.mecConfigured && config !== null && <p className="benchmark-empty">MEC inference is unavailable. Configure AI_SERVICE_URL on the backend and start the inference service to enable measurements.</p>}
    <div className="benchmark-cards"><ResultCard summary={summary} results={results} configured={config?.mecConfigured} /></div>
    <section className="benchmark-history"><h3>Benchmark history</h3>{history.length ? <ul>{history.map((item, index) => <li key={`${item.at}-${index}`}>{new Date(item.at).toLocaleString()} · MEC {ms(item.summary?.average)} · {item.count} samples</li>)}</ul> : <p className="muted">Completed runs will appear here during this browser session.</p>}</section>
  </section>;
}

function ResultCard({ summary, results, configured }) {
  const ok = results.filter((item) => item.ok);
  const failed = results.filter((item) => item.configured && !item.ok);
  const values = ok.map((item) => item.clientTotalMs);
  const max = Math.max(1, ...values);
  const points = values.map((value, index) => `${values.length < 2 ? 50 : 5 + index * 90 / (values.length - 1)},${95 - value / max * 85}`).join(' ');
  return <article className="benchmark-result"><div className="network-card-title"><h3>MEC processing</h3><span className={configured ? 'config-ready' : 'config-missing'}>{configured ? 'Available' : 'Unavailable'}</span></div><div className="metric-grid"><div className="metric-cell"><span>Avg total client response</span><strong>{ms(summary?.average)}</strong></div><div className="metric-cell"><span>Median</span><strong>{ms(summary?.median)}</strong></div><div className="metric-cell"><span>P95 total response</span><strong>{ms(summary?.p95)}</strong></div><div className="metric-cell"><span>Avg endpoint request</span><strong>{ms(summarize(ok.map((item) => item.endpointRequestMs).filter(Number.isFinite))?.average)}</strong></div><div className="metric-cell"><span>Avg reported processing</span><strong>{ms(summarize(ok.map((item) => item.processingMs).filter(Number.isFinite))?.average)}</strong></div><div className="metric-cell"><span>Successful / failed</span><strong>{ok.length} / {failed.length}</strong></div></div><h4 className="benchmark-chart-title">Measured client response by sample</h4>{values.length ? <svg className="benchmark-chart" viewBox="0 0 100 100" role="img" aria-label="MEC measured client response times by sample"><polyline points={points} fill="none" stroke="#2364a5" strokeWidth="2.5" vectorEffect="non-scaling-stroke"/>{points.split(' ').map((point, index) => { const [cx, cy] = point.split(','); return <circle key={index} cx={cx} cy={cy} r="1.8" fill="#2364a5"/>; })}</svg> : <p className="muted">No successful samples yet.</p>}<small>Total response is measured by the browser. Endpoint request time is measured by Node to the MEC processor. Processing time is reported by inference. Request time includes transport and server handling, so upload time is not independently separated.</small></article>;
}
