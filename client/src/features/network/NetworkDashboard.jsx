import { useEffect, useMemo, useRef, useState } from 'react';
import { formatMetric, retainMetricsForPeers, summariseWebRtcStats } from './networkStats';
import { applyProfileToSender, nextAdaptiveDecision, smoothAdaptiveMetrics } from './adaptiveStreaming';
import './network.css';

const METRIC_FIELDS = [
  ['WebRTC RTT', 'rttMs', ' ms'],
  ['Jitter', 'jitterMs', ' ms'],
  ['Packet loss', 'packetLossPercent', '%'],
  ['Video bitrate', 'bitrateKbps', ' kbps'],
  ['FPS', 'fps', ''],
];

export default function NetworkDashboard({ peerConnections = [], socket, role, currentUserId }) {
  const [metrics, setMetrics] = useState({});
  const [adaptiveEnabled, setAdaptiveEnabled] = useState(true);
  const [notice, setNotice] = useState('');
  const [manualProfile, setManualProfile] = useState('high');
  const previousRef = useRef(new Map());
  const controllerRef = useRef(new Map());
  const smoothedMetricsRef = useRef(new Map());
  const sampleInFlightRef = useRef(false);
  const peerKey = useMemo(() => peerConnections.map((peer) => peer.socketId).join('|'), [peerConnections]);

  useEffect(() => {
    const known = new Set(peerConnections.map((peer) => peer.socketId));
    for (const key of previousRef.current.keys()) if (!known.has(key)) previousRef.current.delete(key);
    for (const key of controllerRef.current.keys()) if (!known.has(key)) controllerRef.current.delete(key);
    for (const key of smoothedMetricsRef.current.keys()) if (!known.has(key)) smoothedMetricsRef.current.delete(key);
    setMetrics((current) => retainMetricsForPeers(current, peerConnections));
  }, [peerKey, peerConnections]);

  useEffect(() => {
    let cancelled = false;
    const sample = async () => {
      if (sampleInFlightRef.current) return;
      sampleInFlightRef.current = true;
      const nextMetrics = {};
      try {
        for (const peer of peerConnections) {
        const pc = peer.connection;
        if (!pc || typeof pc.getStats !== 'function') continue;
        try {
          const report = await pc.getStats();
          const previous = previousRef.current.get(peer.socketId) || new Map();
          const sampleResult = summariseWebRtcStats(report, previous, Date.now(), pc.connectionState);
          previousRef.current.set(peer.socketId, sampleResult.counters);
          let state = controllerRef.current.get(peer.socketId) || { profile: 'high', poorSamples: 0, goodSamples: 0, lastChangeAt: 0 };
          const smoothed = smoothAdaptiveMetrics(sampleResult.metrics, smoothedMetricsRef.current.get(peer.socketId));
          smoothedMetricsRef.current.set(peer.socketId, smoothed);
          if (adaptiveEnabled && role === 'student') {
            const decision = nextAdaptiveDecision(smoothed, state);
            if (decision.profile !== state.profile) {
              const senders = pc.getSenders().filter((sender) => sender.track?.kind === 'video');
              const results = await Promise.all(senders.map((sender) => applyProfileToSender(sender, decision.profile)));
              if (results.some((result) => result.applied)) {
                setNotice(`Adaptive quality changed to ${decision.profile}.`);
              } else {
                setNotice('This browser could not apply adaptive encoding; video continues at its current profile.');
                decision.profile = state.profile;
                decision.lastChangeAt = state.lastChangeAt;
              }
            }
            state = decision;
            controllerRef.current.set(peer.socketId, state);
          }
          nextMetrics[peer.socketId] = { ...sampleResult.metrics, participantId: peer.participantId, displayName: peer.displayName, adaptiveProfile: state.profile };
          if (role === 'student') socket?.emit('network:metrics', { metrics: nextMetrics[peer.socketId] });
        } catch (error) {
          nextMetrics[peer.socketId] = { quality: 'unavailable', connectionState: pc.connectionState, error: error.message, displayName: peer.displayName };
        }
      }
      if (!cancelled) setMetrics(nextMetrics);
      } finally {
        sampleInFlightRef.current = false;
      }
    };
    sample();
    const timer = window.setInterval(sample, 1000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [peerKey, peerConnections, socket, role, adaptiveEnabled]);

  useEffect(() => {
    if (!socket) return undefined;
    const receive = (event) => {
      if (event.participantId === currentUserId) return;
      setMetrics((previous) => ({
        ...previous,
        [`remote-${event.participantId}`]: {
          ...event.metrics,
          displayName: `${event.displayName || 'Participant'} (sender report)`,
          connectionState: event.connectionState || event.metrics?.connectionState,
          adaptiveProfile: event.adaptiveProfile,
          quality: event.metrics?.quality || 'reported',
        },
      }));
    };
    socket.on('network:metrics:update', receive);
    return () => socket.off('network:metrics:update', receive);
  }, [socket, currentUserId]);

  async function applyManualProfile() {
    let appliedCount = 0;
    for (const peer of peerConnections) {
      let peerApplied = 0;
      for (const sender of peer.connection?.getSenders?.() || []) {
        if (sender.track?.kind !== 'video') continue;
        const result = await applyProfileToSender(sender, manualProfile);
        if (result.applied) {
          appliedCount += 1;
          peerApplied += 1;
        }
      }
      if (peerApplied) {
        controllerRef.current.set(peer.socketId, {
          ...(controllerRef.current.get(peer.socketId) || { poorSamples: 0, goodSamples: 0 }),
          profile: manualProfile, lastChangeAt: Date.now(),
        });
      }
    }
    setNotice(appliedCount ? `Manual video profile set to ${manualProfile}.` : 'No compatible outgoing video sender is available on this browser.');
  }

  const rows = Object.entries(metrics);
  return (
    <section className="panel network-panel">
      <div className="network-heading">
        <div>
          <h2>Network quality</h2>
          <p className="muted">Live WebRTC endpoint statistics. These are not 5G radio or one-way air-interface measurements.</p>
        </div>
        {role === 'student' && (
          <div className="network-controls">
            <label className="adaptive-toggle">
              <input type="checkbox" checked={adaptiveEnabled} onChange={(event) => setAdaptiveEnabled(event.target.checked)} />
              Adaptive video
            </label>
            <label className="manual-profile">Fallback profile
              <select value={manualProfile} onChange={(event) => setManualProfile(event.target.value)}>
                <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
              </select>
            </label>
            <button type="button" className="network-apply" onClick={applyManualProfile}>Apply profile</button>
          </div>
        )}
      </div>
      {rows.length === 0 ? <p className="muted">Metrics appear when a peer connection is active.</p> : (
        <div className="network-grid">
          {rows.map(([id, row]) => (
            <article className="network-card" key={id}>
              <div className="network-card-title">
                <strong>{row.displayName || 'Participant'}</strong>
                <span className={`quality-pill quality-${row.quality || 'unknown'}`}>{row.quality || row.connectionState || 'Unknown'}</span>
              </div>
              <div className="metric-grid">
                {METRIC_FIELDS.map(([label, key, suffix]) => (
                  <div className="metric-cell" key={key}><span>{label}</span><strong>{formatMetric(row[key], suffix)}</strong></div>
                ))}
                <div className="metric-cell"><span>Resolution</span><strong>{row.width && row.height ? `${row.width} × ${row.height}` : 'Unavailable'}</strong></div>
                <div className="metric-cell"><span>Connection</span><strong>{row.connectionState || 'Unavailable'}</strong></div>
                <div className="metric-cell"><span>Adaptive profile</span><strong>{row.adaptiveProfile || 'Not set'}</strong></div>
              </div>
            </article>
          ))}
        </div>
      )}
      {notice && <p className="network-notice" role="status">{notice}</p>}
    </section>
  );
}
