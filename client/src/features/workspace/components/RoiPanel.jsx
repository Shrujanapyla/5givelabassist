import { useRef, useState } from 'react';
import RoiViewport from './RoiViewport';
import RoiNotes from './RoiNotes';
import SnapshotHistory from './SnapshotHistory';

import {
  clamp,
  clampLayout,
  formatTimestamp,
  readFileAsDataUrl,
  MIN_W,
  MIN_H,
} from '../utils';

/**
 * One independent ROI panel:
 * draggable, resizable, independent zoom/pan,
 * label, notes and snapshot history.
 */
export default function RoiPanel({
  roi,
  bounds,
  compact,
  stacked = false,
  focused,
  dispatch,
  onCapture,
  onUploadImage,
  canUpload = true,
  onRemove,
  onRestoreSnapshot,
  onUpdateSnapshot,
  canAnnotate = false,
}) {
  const [drawer, setDrawer] = useState('notes');
  const [expanded, setExpanded] = useState(false);
  const [drawingEnabled, setDrawingEnabled] = useState(false);
  const [drawColor, setDrawColor] = useState('#ff3333');

  const fileRef = useRef(null);
  const drag = useRef(null);
  const resize = useRef(null);

  const layout = compact
    ? null
    : clampLayout(roi.layout, bounds);

  const active =
    roi.snapshots.find(
      (snapshot) => snapshot.id === roi.activeSnapshotId
    ) ?? null;

  const canEditActiveSnapshot =
    Boolean(active && active.snapshotId && active.version === roi.backendVersion);

  const focus = () =>
    dispatch({
      type: 'FOCUS',
      id: roi.id,
    });

  const handleGripDragStart = (event) => {
    event.stopPropagation();
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/roi-id', roi.id);
  };

  const handlePanelDragOver = (event) => {
    if (event.dataTransfer.types.includes('text/roi-id')) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    }
  };

  const handlePanelDrop = (event) => {
    const sourceId = event.dataTransfer.getData('text/roi-id');
    if (!sourceId || sourceId === roi.id) return;
    event.preventDefault();
    dispatch({ type: 'REORDER', id: sourceId, targetId: roi.id });
  };

  // Reposition panel.
  const startDrag = (event) => {
    // Header controls must remain clickable; only the empty header area drags.
    if (event.target.closest('button, input, textarea, select, a')) return;
    if (
      compact ||
      stacked ||
      expanded ||
      (event.pointerType === 'mouse' && event.button !== 0)
    ) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);

    drag.current = {
      px: event.clientX,
      py: event.clientY,
      ...layout,
    };

    focus();
  };

  const moveDrag = (event) => {
    const current = drag.current;

    if (!current) return;

    dispatch({
      type: 'LAYOUT',
      id: roi.id,
      layout: {
        x: clamp(
          current.x + event.clientX - current.px,
          0,
          Math.max(0, bounds.w - current.w)
        ),
        y: clamp(
          current.y + event.clientY - current.py,
          0,
          Math.max(0, bounds.h - current.h)
        ),
      },
    });
  };

  const endDrag = () => {
    drag.current = null;
  };

  // Resize panel.
  const startResize = (event) => {
    if (compact || stacked) return;

    event.stopPropagation();

    event.currentTarget.setPointerCapture(event.pointerId);

    resize.current = {
      px: event.clientX,
      py: event.clientY,
      ...layout,
    };

    focus();
  };

  const moveResize = (event) => {
    const current = resize.current;

    if (!current) return;

    dispatch({
      type: 'LAYOUT',
      id: roi.id,
      layout: {
        w: clamp(
          current.w + event.clientX - current.px,
          MIN_W,
          Math.max(MIN_W, bounds.w - current.x)
        ),
        h: clamp(
          current.h + event.clientY - current.py,
          MIN_H,
          Math.max(MIN_H, bounds.h - current.y)
        ),
      },
    });
  };

  const endResize = () => {
    resize.current = null;
  };

  // Keyboard movement and resizing.
  const onGripKey = (event) => {
    if (compact || stacked) return;

    const direction = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }[event.key];

    if (!direction) return;

    event.preventDefault();

    const step = 12;

    if (event.shiftKey) {
      dispatch({
        type: 'LAYOUT',
        id: roi.id,
        layout: clampLayout(
          {
            ...layout,
            w: layout.w + direction[0] * step,
            h: layout.h + direction[1] * step,
          },
          bounds
        ),
      });
    } else {
      dispatch({
        type: 'LAYOUT',
        id: roi.id,
        layout: clampLayout(
          {
            ...layout,
            x: layout.x + direction[0] * step,
            y: layout.y + direction[1] * step,
          },
          bounds
        ),
      });
    }
  };

  // Capture or upload a snapshot.
  const capture = async () => {
    if (onCapture) {
      const src = await onCapture(roi);

      if (src) {
        dispatch({
          type: 'ADD_SNAPSHOT',
          id: roi.id,
          src,
        });
      }
    } else {
      fileRef.current?.click();
    }
  };

  const onFile = async (event) => {
    const file = event.target.files?.[0];

    event.target.value = '';

    if (!file) return;

    const src = await readFileAsDataUrl(file);

    if (onUploadImage) {
      await onUploadImage({ image: src, fileName: file.name, fileType: file.type });
      return;
    }

    dispatch({
      type: 'ADD_SNAPSHOT',
      id: roi.id,
      src,
    });
  };

  // Restore selected version.
  const handleRestore = (snapshotId) => {
    const selected = roi.snapshots.find(
      (snapshot) => snapshot.id === snapshotId
    );

    if (!selected) return;

    if (onRestoreSnapshot && selected.snapshotId) {
      onRestoreSnapshot(roi, selected);
      return;
    }

    dispatch({
      type: 'RESTORE',
      id: roi.id,
      snapshotId,
    });
  };

  // Panel styling.
  const panelStyle = compact || stacked
    ? undefined
    : expanded
      ? { inset: 8, width: 'auto', height: 'auto', zIndex: 10000 }
      : {
          left: layout.x,
          top: layout.y,
          width: layout.w,
          height: layout.h,
          zIndex: roi.z,
        };

  return (
    <section
      className={`mrw-panel${focused ? ' is-focused' : ''}${expanded ? ' is-expanded' : ''}${stacked ? ' is-stacked' : ''}`}
      style={panelStyle}
      onPointerDown={focus}
      onDragOver={stacked ? handlePanelDragOver : undefined}
      onDrop={stacked ? handlePanelDrop : undefined}
      aria-label={`ROI panel: ${roi.label}`}
    >
      <header
        className="mrw-panel__header"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {!compact && !expanded && (
          <button
            type="button"
            className="mrw-grip"
            draggable={stacked}
            onDragStart={stacked ? handleGripDragStart : undefined}
            onKeyDown={onGripKey}
            aria-label={stacked ? "Drag to reorder this ROI" : "Move panel with arrow keys; shift and arrows to resize"}
            title={stacked ? "Drag to reorder ROI" : "Move ROI"}
          >
            ⠿
          </button>
        )}

        <input
          className="mrw-label"
          value={roi.label}
          onChange={(event) =>
            dispatch({
              type: 'META',
              id: roi.id,
              patch: {
                label: event.target.value,
              },
            })
          }
          aria-label="ROI label"
        />

        <button
          type="button"
          className="mrw-icon-btn mrw-panel__expand"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            setExpanded((value) => !value);
          }}
          aria-label={expanded ? 'Restore panel size' : 'Expand panel'}
          title={expanded ? 'Restore panel size' : 'Expand panel'}
        >
          {expanded ? '↙' : '↗'}
        </button>
        <button
          type="button"
          className="mrw-icon-btn"
          onPointerDown={(event) => event.stopPropagation()}
          onPointerUp={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onRemove?.(roi);
          }}
          aria-label="Remove ROI"
          title="Close ROI"
        >
          X
        </button>
      </header>

      <div className="mrw-panel__time">
        Captured: {formatTimestamp(active?.capturedAt)}
      </div>

      {canAnnotate && active && (
        <div className="mrw-draw-toolbar">
          <button
            type="button"
            className={`mrw-btn${drawingEnabled ? ' mrw-btn--primary' : ''}`}
            disabled={!canEditActiveSnapshot}
            onClick={() => setDrawingEnabled((value) => !value)}
          >
            {drawingEnabled ? 'Finish drawing' : 'Draw'}
          </button>
          <input
            type="color"
            value={drawColor}
            onChange={(event) => setDrawColor(event.target.value)}
            aria-label="Snapshot drawing colour"
            title="Drawing colour"
          />
          <button
            type="button"
            className="mrw-btn"
            disabled={!canEditActiveSnapshot || !active.annotations?.length || drawingEnabled}
            onClick={() => onUpdateSnapshot?.(roi, active, active.annotations.slice(0, -1))}
          >
            Undo
          </button>
          <button
            type="button"
            className="mrw-btn"
            disabled={!canEditActiveSnapshot || !active.annotations?.length || drawingEnabled}
            onClick={() => onUpdateSnapshot?.(roi, active, [])}
          >
            Clear
          </button>
          {!canEditActiveSnapshot && <span className="mrw-meta">Restore the latest version to annotate it.</span>}
          {drawingEnabled && <span className="mrw-meta">Draw on the snapshot with your mouse</span>}
        </div>
      )}

      <RoiViewport
        src={active?.src}
        alt={roi.label}
        view={roi.view}
        annotations={active?.annotations || []}
        drawingEnabled={canAnnotate && canEditActiveSnapshot && drawingEnabled}
        drawColor={drawColor}
        onDrawComplete={(annotations) => {
          setDrawingEnabled(false);
          onUpdateSnapshot?.(roi, active, annotations);
        }}
        onViewChange={(view) =>
          dispatch({
            type: 'VIEW',
            id: roi.id,
            view,
          })
        }
      />

      <div className="mrw-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={drawer === 'notes'}
          className={drawer === 'notes' ? 'is-on' : ''}
          onClick={() =>
            setDrawer(drawer === 'notes' ? null : 'notes')
          }
        >
          Notes{roi.note ? ' *' : ''}
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={drawer === 'history'}
          className={drawer === 'history' ? 'is-on' : ''}
          onClick={() =>
            setDrawer(drawer === 'history' ? null : 'history')
          }
        >
          History ({roi.snapshots.length})
        </button>

        {canUpload && (
          <button
            type="button"
            className="mrw-tabs__action"
            onClick={capture}
          >
            {onCapture ? '+ Snapshot' : '+ Upload snapshot'}
          </button>
        )}

        {canUpload && <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={onFile}
        />}
      </div>

      {drawer === 'notes' && (
        <RoiNotes
          note={roi.note}
          updatedAt={roi.noteUpdatedAt}
          onChange={(note) =>
            dispatch({
              type: 'META',
              id: roi.id,
              patch: { note },
            })
          }
        />
      )}

      {drawer === 'history' && (
        <SnapshotHistory
          snapshots={roi.snapshots}
          activeId={roi.activeSnapshotId}
          onRestore={handleRestore}
        />
      )}

      {!compact && !stacked && !expanded && (
        <div
          className="mrw-resize"
          onPointerDown={startResize}
          onPointerMove={moveResize}
          onPointerUp={endResize}
          onPointerCancel={endResize}
          aria-hidden="true"
        />
      )}
    </section>
  );
}