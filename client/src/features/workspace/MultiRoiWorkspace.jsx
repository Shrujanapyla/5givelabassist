import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from 'react';

import RoiPanel from './components/RoiPanel';
import { initRois, workspaceReducer } from './workspaceReducer';
import {
  COMPACT_BREAKPOINT,
  readFileAsDataUrl,
} from './utils';

import './workspace.css';

const MultiRoiWorkspace = forwardRef(function MultiRoiWorkspace(
  {
    initialRois = [],
    onChange,
    onCaptureSnapshot,
    onUploadImage,
    canUpload = true,
    onRemoveRoi,
    onRestoreSnapshot,
    onUpdateSnapshot,
    canAnnotate = false,
    className = '',
    style,
  },
  ref
) {
  const [rois, dispatch] = useReducer(
    workspaceReducer,
    initialRois,
    initRois
  );

  const [bounds, setBounds] = useState({ w: 0, h: 0 });

  const canvasRef = useRef(null);
  const fileRef = useRef(null);
  const roisRef = useRef(rois);

  const onChangeRef = useRef(onChange);

  useLayoutEffect(() => {
    roisRef.current = rois;
    onChangeRef.current = onChange;
  }, [rois, onChange]);

  useEffect(() => {
    onChangeRef.current?.(rois);
  }, [rois]);

  useLayoutEffect(() => {
    const element = canvasRef.current;

    if (!element) return undefined;

    const measure = () => {
      setBounds({
        w: element.clientWidth,
        h: element.clientHeight,
      });
    };

    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  const compact =
    bounds.w > 0 && bounds.w < COMPACT_BREAKPOINT;

  const topZ = rois.reduce(
    (maximum, roi) => Math.max(maximum, roi.z),
    0
  );

  /*
   * Public methods used by App.jsx.
   */
  useImperativeHandle(
    ref,
    () => ({
      addRoi(input) {
        dispatch({
          type: 'ADD',
          roi: input,
        });
      },

      upsertRoi(input) {
        dispatch({
          type: 'UPSERT_ROI',
          roi: input,
        });
      },

      addSnapshot(id, src, capturedAt) {
        dispatch({
          type: 'ADD_SNAPSHOT',
          id,
          src,
          capturedAt,
        });
      },

      upsertVersion(roiId, snapshot, activate = true) {
        dispatch({
          type: 'UPSERT_VERSION',
          id: roiId,
          snapshot,
          activate,
        });
      },

      removeRoi(id) {
        dispatch({
          type: 'REMOVE',
          id,
        });
      },

      removeVersion(roiId, snapshotId) {
        dispatch({
          type: 'REMOVE_VERSION',
          id: roiId,
          snapshotId,
        });
      },

      restoreVersion(roiId, snapshotId) {
        dispatch({
          type: 'RESTORE',
          id: roiId,
          snapshotId,
        });
      },

      getRois() {
        return roisRef.current;
      },
    }),
    []
  );

  const onAddFiles = useCallback(async (event) => {
    const files = [...(event.target.files ?? [])];

    event.target.value = '';

    for (const file of files) {
      const src = await readFileAsDataUrl(file);

      if (onUploadImage) {
        await onUploadImage({ image: src, fileName: file.name, fileType: file.type });
      } else {
        dispatch({
          type: 'ADD',
          roi: { src, label: file.name.replace(/\.[^.]+$/, '') },
        });
      }
    }
  }, [onUploadImage]);

  const handleRemove = useCallback(
    (roi) => {
      if (onRemoveRoi) {
        onRemoveRoi(roi);
        return;
      }

      dispatch({
        type: 'REMOVE',
        id: roi.id,
      });
    },
    [onRemoveRoi]
  );

  return (
    <div
      className={`mrw is-stacked ${compact ? 'is-compact' : ''} ${className}`}
      style={style}
    >
      <div className="mrw-toolbar">
        <strong className="mrw-toolbar__title">
          ROI Workspace
        </strong>

        <span className="mrw-meta">
          {rois.length} panel{rois.length === 1 ? '' : 's'}
        </span>

        <div className="mrw-toolbar__spacer" />

        {canUpload && (
          <button
            type="button"
            className="mrw-btn mrw-btn--primary"
            onClick={() => fileRef.current?.click()}
          >
            + Add ROI
          </button>
        )}

        {canUpload && <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={onAddFiles}
        />}
      </div>

      <div ref={canvasRef} className="mrw-canvas">
        {rois.length === 0 && (
          <div className="mrw-empty">
            <p>No regions of interest yet.</p>
            <p className="mrw-meta">
              Use Add ROI to load one or more snapshots.
            </p>
          </div>
        )}

        {rois.map((roi) => (
          <RoiPanel
            key={roi.id}
            roi={roi}
            bounds={bounds}
            compact={compact}
            focused={roi.z === topZ && rois.length > 1}
            stacked
            dispatch={dispatch}
            onCapture={onCaptureSnapshot}
            onUploadImage={onUploadImage}
            canUpload={canUpload}
            onRemove={() => handleRemove(roi)}
            onRestoreSnapshot={onRestoreSnapshot}
            onUpdateSnapshot={onUpdateSnapshot}
            canAnnotate={canAnnotate}
          />
        ))}
      </div>
    </div>
  );
});

export default MultiRoiWorkspace;