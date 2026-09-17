# Workspace core

The active React application mounts this dual-engine workspace from `src/App.tsx`. See [ENGINEERING.md](./ENGINEERING.md) for mathematical assumptions and limitations.
No React dependency: `useDeviceDrag` installs pointer handlers and returns a cleanup function.

```ts
import { CanvasManager } from "./workspace/CanvasManager";
import { DeviceStore, snapToSurface } from "./workspace/DeviceStore";
import { useDeviceDrag } from "./workspace/useDeviceDrag";

const room = { width: 8, depth: 6, height: 3 };
const store = new DeviceStore();
const canvas = new CanvasManager(viewportElement, {
  room,
  onSelect: (id) => store.api.getState().selectDevice(id),
});
const sync = () => {
  const { devices, selectedId } = store.api.getState();
  canvas.syncDevices(devices, selectedId);
};
const unsubscribe = store.api.subscribe(sync);
const disposeDrag = useDeviceDrag(canvas, store);
sync();
store.add({
  catalogId: "example-display",
  kind: "display",
  surface: "north",
  position: snapToSurface({ x: 0, y: 1.5, z: -3 }, "north", room),
  rotation: { x: 0, y: 0, z: 0 },
  ports: [
    { id: "hdmi-in-1", label: "HDMI 1", signal: "HDMI", direction: "input" },
  ],
  metadata: {
    label: "Display",
    powerWatts: null,
    heatBtuPerHour: null,
    rackUnits: null,
  },
});
canvas.setView("plan");
// On workspace unmount:
disposeDrag();
unsubscribe();
canvas.dispose();
```

The host needs a nonzero explicit height. Coordinates are metres, Y-up, with the
origin at the floor centre. Device positions are mounting anchors. Surface names
north/south map to negative/positive Z; east/west to positive/negative X.
Call `snapToSurface` before initial insertion. Dragging preserves the original
mounting surface by default. Alt-drag intersects compatible room surfaces; the inspector also allows explicit remounting. Escape restores both position and original surface.

Records are immutable and authoritative; scene meshes derive from incremental store
events. Pointer movement updates state synchronously, with at most one queued render.
The renderer accepts either an immutable device array or the Zustand device record.
It updates meshes in place and shares cached geometry and selection materials.
Selection callbacks report a device ID, or null for empty space; the store remains
authoritative. The canvas owns its selection listener, observer and GPU resources;
the caller owns the store subscription and optional drag controller.
Idle scenes schedule no frames. View transitions last 180 ms and respect reduced motion.
Escape, pointer cancellation, lost capture and window blur restore the starting position.
Wall movement viewed edge-on is ignored; use isometric view to move vertically.

The shapes are lightweight equipment proxies. Bounds constrain anchors, not complete
device footprints. Verified product dimensions, collision handling,
history, persistence and WebGL context recovery are subsequent implementation work.
No frame-rate guarantee has been measured. BOM consumers can read `store.snapshot()`;
unknown power and heat values remain null rather than being silently treated as zero.

Validation:

```sh
npx tsc -p tsconfig.workspace.json
npx vitest run tests/workspace
```

## Zustand state API

`createDeviceStore()` returns an independent Zustand vanilla store. Use
`store.getState().addDevice(input)`, `updateDevice(id, patch)`, `deleteDevice(id)`
and `selectDevice(id | null)`. Read `devices` and `selectedId` from `getState()`;
subscribe using Zustand's `subscribe`. Use actions for writes so validation runs.
The `DeviceStore` class wraps that same store for the existing canvas API.

Kinds: `display`, `ptz_camera`, `ceiling_mic`, `speaker`, `rack`.
Position uses metres; rotation uses XYZ Euler radians. Updates merge partial XYZ
and metadata fields. Rack units may be fractional; null means unknown. Invalid
coordinates, negative metadata, duplicate IDs and unknown update/selection IDs
throw before publishing state. Deleting a missing ID is a no-op. Deleting the
selected ID atomically clears selection. Device IDs cannot be changed by updates.

## Contextual workspace UI

`PropertyInspector` edits vertical-axis rotation presets and wall mounting height
in 0.5 m steps, clamped to the room height. Floor and ceiling heights remain fixed
to their mounting plane. `ViewportHUD` switches instantly between orthographic
plan/isometric views and a perspective seat view (fixed 1.2 m eye height, facing
the north wall; no walk navigation). `BOMDrawer` groups by catalog and device kind,
updates with store edits, and separately flags unknown power/heat values. Load
sums represent known values, not a validated electrical or thermal design.
Tailwind utilities are compiled locally through PostCSS; no runtime styling CDN.


## Interactive viewport

Left-drag empty space to orbit; middle/right-drag to pan; wheel to zoom the camera
projection. Device grabs retain surface dragging, snapping and Escape rollback.
Double-click a device or choose Focus selected to frame it. Home resets isometric;
Fit room and plan/front/seat presets use the same renderer. Eight projected room
corners determine framing; resize updates the drawing buffer at DPR capped to 2.
Navigation damping schedules frames only while changing. Polar and zoom limits
reduce floor clipping; this is an inspection camera, not a collision-aware walk mode.

Measurements are live room dimensions. Cable Map draws only DeviceStore connections,
filters by their signal categories, and exposes endpoints, port IDs and route length.
Routes are estimated overhead orthogonal paths between mounting anchors, not physical
port locations, cable tray solutions or installation lengths (no slack allowance).
Camera guides require catalog horizontal FOV; missing vertical FOV renders only a
horizontal triangle, with a six-metre preview depth rather than a rated range.
Microphone guides require a catalog pickup radius; polar response/STI is not inferred.
Speaker and display modes reuse active engineering calculations and unknown-data flags.
All overlays remain planning estimates, not certified AVIXA compliance.
