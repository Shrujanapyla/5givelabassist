import { formatTimestamp } from '../utils';

export default function RoiNotes({ note, updatedAt, onChange }) {
  return (
    <div className="mrw-notes">
      <textarea
        value={note}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Add notes about this region…"
        aria-label="ROI notes"
      />
      <div className="mrw-meta">Note updated: {formatTimestamp(updatedAt)}</div>
    </div>
  );
}
