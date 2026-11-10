import { uid } from './utils';

/*
 * ROI shape:
 * {
 *   id,
 *   backendId,
 *   label,
 *   note,
 *   noteUpdatedAt,
 *   createdAt,
 *   snapshots: [
 *     {
 *       id,             // Unique history/version ID
 *       snapshotId,     // Backend snapshot ID
 *       src,
 *       capturedAt
 *     }
 *   ],
 *   activeSnapshotId,
 *   layout: { x, y, w, h },
 *   view: { scale, tx, ty },
 *   z
 * }
 */

export function createRoi(input = {}, index = 0) {
  const now = Date.now();

  let snapshots = [];

  if (input.snapshots?.length) {
    snapshots = input.snapshots.map((snapshot) => ({
      id: snapshot.id ?? uid(),
      snapshotId: snapshot.snapshotId ?? input.backendId ?? null,
      src: snapshot.src,
      annotations: snapshot.annotations ?? [],
      version: snapshot.version,
      capturedAt: snapshot.capturedAt ?? now,
    }));
  } else if (input.src) {
    snapshots = [
      {
        id: input.snapshotVersionId ?? uid(),
        snapshotId: input.backendId ?? null,
        src: input.src,
        annotations: input.annotations ?? [],
        version: input.version,
        capturedAt: input.capturedAt ?? now,
      },
    ];
  }

  snapshots.sort(
    (a, b) =>
      new Date(b.capturedAt).getTime() -
      new Date(a.capturedAt).getTime()
  );

  const step = index % 8;

  return {
    id: input.id ?? uid(),
    backendId: input.backendId ?? null,
    backendVersion: input.backendVersion ?? null,
    label: input.label ?? `ROI ${index + 1}`,
    note: input.note ?? '',
    noteUpdatedAt: input.noteUpdatedAt ?? null,
    createdAt: input.createdAt ?? now,
    snapshots,
    activeSnapshotId:
      input.activeSnapshotId ?? snapshots[0]?.id ?? null,
    layout: input.layout ?? {
      x: 24 + step * 28,
      y: 24 + step * 28,
      w: 360,
      h: 320,
    },
    view: input.view ?? {
      scale: 1,
      tx: 0,
      ty: 0,
    },
    z: input.z ?? index + 1,
  };
}

export const initRois = (list = []) =>
  list.map((roi, index) => createRoi(roi, index));

const maxZ = (rois) =>
  rois.reduce((maximum, roi) => Math.max(maximum, roi.z), 0);

const patch = (rois, id, update) =>
  rois.map((roi) => (roi.id === id ? update(roi) : roi));

function sortSnapshots(snapshots) {
  return [...snapshots].sort(
    (a, b) =>
      new Date(b.capturedAt).getTime() -
      new Date(a.capturedAt).getTime()
  );
}

export function workspaceReducer(state, action) {
  switch (action.type) {
    case 'ADD': {
      const roi = createRoi(action.roi, state.length);

      return [
        ...state,
        {
          ...roi,
          z: maxZ(state) + 1,
        },
      ];
    }

    case 'UPSERT_ROI': {
      const existing = state.find(
        (roi) => roi.id === action.roi.id
      );

      if (!existing) {
        const roi = createRoi(action.roi, state.length);

        return [
          ...state,
          {
            ...roi,
            z: maxZ(state) + 1,
          },
        ];
      }

      return patch(state, action.roi.id, (roi) => ({
        ...roi,
        ...action.roi,
        layout: roi.layout,
        view: roi.view,
        z: roi.z,
      }));
    }

    case 'REMOVE':
      return state.filter((roi) => roi.id !== action.id);

    case 'REORDER': {
      const fromIndex = state.findIndex((roi) => roi.id === action.id);
      const toIndex = state.findIndex((roi) => roi.id === action.targetId);
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return state;
      const next = [...state];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    }

    case 'FOCUS': {
      const top = maxZ(state);
      const target = state.find((roi) => roi.id === action.id);

      if (!target || target.z === top) return state;

      return patch(state, action.id, (roi) => ({
        ...roi,
        z: top + 1,
      }));
    }

    case 'LAYOUT':
      return patch(state, action.id, (roi) => ({
        ...roi,
        layout: {
          ...roi.layout,
          ...action.layout,
        },
      }));

    case 'VIEW':
      return patch(state, action.id, (roi) => ({
        ...roi,
        view: action.view,
      }));

    case 'META':
      return patch(state, action.id, (roi) => {
        const next = {
          ...roi,
          ...action.patch,
        };

        if ('note' in action.patch) {
          next.noteUpdatedAt = Date.now();
        }

        return next;
      });

    /*
     * Add or replace a version using its history ID.
     * The backend snapshot ID remains attached separately.
     */
    case 'UPSERT_VERSION':
      return patch(state, action.id, (roi) => {
        const incoming = action.snapshot;

        const exists = roi.snapshots.some(
          (snapshot) => snapshot.id === incoming.id
        );

        const snapshots = exists
          ? roi.snapshots.map((snapshot) =>
              snapshot.id === incoming.id
                ? { ...snapshot, ...incoming }
                : snapshot
            )
          : [incoming, ...roi.snapshots];

        return {
          ...roi,
          snapshots: sortSnapshots(snapshots),
          activeSnapshotId: action.activate
            ? incoming.id
            : roi.activeSnapshotId,
        };
      });

    case 'ADD_SNAPSHOT':
      return patch(state, action.id, (roi) => {
        const snapshot = {
          id: action.snapshot?.id ?? uid(),
          snapshotId:
            action.snapshot?.snapshotId ?? roi.backendId ?? null,
          src: action.snapshot?.src ?? action.src,
          capturedAt:
            action.snapshot?.capturedAt ??
            action.capturedAt ??
            Date.now(),
        };

        return {
          ...roi,
          snapshots: sortSnapshots([
            snapshot,
            ...roi.snapshots.filter(
              (item) => item.id !== snapshot.id
            ),
          ]),
          activeSnapshotId: snapshot.id,
        };
      });

    case 'REMOVE_VERSION':
      return patch(state, action.id, (roi) => {
        const snapshots = roi.snapshots.filter(
          (snapshot) => snapshot.id !== action.snapshotId
        );

        return {
          ...roi,
          snapshots,
          activeSnapshotId:
            roi.activeSnapshotId === action.snapshotId
              ? snapshots[0]?.id ?? null
              : roi.activeSnapshotId,
        };
      });

    case 'RESTORE':
      return patch(state, action.id, (roi) => ({
        ...roi,
        activeSnapshotId: action.snapshotId,
      }));

    case 'TILE': {
      const boundsWidth = action.bounds.w;
      const gap = 16;
      const cardWidth = 360;
      const cardHeight = 320;

      const columns = Math.max(
        1,
        Math.floor(
          (boundsWidth - gap) / (cardWidth + gap)
        )
      );

      return state.map((roi, index) => ({
        ...roi,
        layout: {
          w: cardWidth,
          h: cardHeight,
          x: gap + (index % columns) * (cardWidth + gap),
          y:
            gap +
            Math.floor(index / columns) * (cardHeight + gap),
        },
      }));
    }

    default:
      return state;
  }
}