import { formatShort } from '../utils';

/** Newest-first list of snapshots for one ROI. Click to make a snapshot active. */
export default function SnapshotHistory({ snapshots, activeId, onRestore }) {
  if (!snapshots.length) return <div className="mrw-meta mrw-history__empty">No snapshots yet.</div>;
  return (
    <ul className="mrw-history" aria-label="Snapshot history">
      {snapshots.map((s, i) => (
        <li key={s.id}>
          <button
            type="button"
            className={`mrw-history__item${s.id === activeId ? ' is-active' : ''}`}
            onClick={() => onRestore(s.id)}
            title={`Show snapshot from ${formatShort(s.capturedAt)}`}
          >
            <img src={s.src} alt="" draggable={false} />
            <span>{i === 0 ? 'Latest · ' : ''}{formatShort(s.capturedAt)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
