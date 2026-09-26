import { createStore, type StoreApi } from "zustand/vanilla";
import { INITIAL_CATALOG, parseCatalog, type CatalogProfile } from "./catalog";
import { solvePlacements, type Placement } from "./PlacementSolver";
import { ROOM_TYPES, layoutForType, type RoomType } from "./RoomLayout";
import { roomLayout } from "./RoomLayout";
import { ROOM_PRESETS, type RoomPresetId } from "./RoomPresets";

export type XYZ = Readonly<{ x: number; y: number; z: number }>;
export type DeviceKind =
  | "display"
  | "ptz_camera"
  | "ceiling_mic"
  | "speaker"
  | "rack"
  | "source"
  | "matrix"
  | "dsp"
  | "power"
  | "extender"
  | "amplifier"
  | "network"
  | "control"
  | "codec";
export type MountSurface =
  "floor" | "ceiling" | "table" | "north" | "south" | "east" | "west";
export interface DevicePort {
  readonly id: string;
  readonly label: string;
  readonly signal: string;
  readonly direction: "input" | "output" | "bidirectional";
  readonly connector?: string;
  readonly transport?: string;
  readonly signalTypes?: readonly string[];
  readonly required?: boolean;
  readonly notes?: string;
}
export interface DeviceMetadata {
  readonly micPattern?: string;
  readonly micModel?: "omni" | "cone" | "horizontal_sector" | "radius_only";
  readonly micRadiusM?: number;
  readonly micAngleDeg?: number;
  readonly horizontalDispersionDeg?: number;
  readonly verticalDispersionDeg?: number;
  readonly referenceSplDb?: number;
  readonly referenceDistanceM?: number;

  readonly horizontalFovDeg?: number;
  readonly verticalFovDeg?: number;
  readonly label: string;
  readonly powerWatts: number | null;
  readonly heatBtuPerHour: number | null;
  readonly rackUnits: number | null;
  readonly imageHeightM?: number;
  readonly splAt1m?: number | null;
  readonly sensitivityDb?: number;
  readonly speakerWatts?: number;
  readonly maxSpeakerWatts?: number;
  readonly coverageDegrees?: number;
  readonly maxSpl?: number;
  readonly powerBasis?: string;
  readonly heatBasis?: string;
}
/** Metres, Y-up; position is the mounting anchor. Euler rotations use radians, XYZ order. */
export interface PlacedDevice {
  readonly id: string;
  readonly catalogId: string;
  readonly kind: DeviceKind;
  readonly surface: MountSurface;
  readonly position: XYZ;
  readonly rotation: XYZ;
  readonly ports: readonly DevicePort[];
  readonly metadata: DeviceMetadata;
  readonly dimensions?: XYZ;
  readonly placement?: Placement;
}
export type NewDevice = Omit<PlacedDevice, "id"> & { readonly id?: string };
export type DeviceUpdate = Partial<
  Pick<PlacedDevice, "catalogId" | "kind" | "surface" | "ports" | "placement">
> & {
  readonly position?: Partial<XYZ>;
  readonly rotation?: Partial<XYZ>;
  readonly metadata?: Partial<DeviceMetadata>;
};
export interface TableSettings {
  readonly width: number;
  readonly depth: number;
  readonly height: number;
  readonly finish: "oak" | "walnut" | "white";
  readonly shape: "rounded" | "rectangular";
}
export interface RoomSize {
  readonly table?: TableSettings;
  readonly eyeHeightM?: number;
  readonly capacity?: number;
  readonly roomType?: RoomType;
  readonly width: number;
  readonly depth: number;
  readonly height: number;
  readonly layout?: "huddle" | "conference" | "training";
}
export type DeviceChange = Readonly<{
  id: string;
  device: PlacedDevice | undefined;
}>;
export interface Endpoint {
  readonly deviceId: string;
  readonly portId: string;
}
export interface Connection {
  readonly id: string;
  readonly from: Endpoint;
  readonly to: Endpoint;
  readonly signal: string;
}
export interface EngineeringSettings {
  readonly viewingRatio: 4 | 6 | 8;
  readonly elementPercent: number;
  readonly horizontalLimit: number;
  readonly verticalLimit: number;
  readonly noiseDb: number | null;
  readonly rt60: number | null;
  readonly targetSpl: number;
  readonly powerBudget: number;
  readonly heatBudget: number;
}
export interface DeviceState {
  readonly room: RoomSize;
  readonly catalog: readonly CatalogProfile[];
  importCatalog(input: unknown, sourceFile?: string): void;
  setRoom(update: Partial<RoomSize>): void;
  readonly roomPreset: RoomPresetId | "custom";
  setRoomPreset(id: RoomPresetId): void;
  readonly devices: Readonly<Record<string, PlacedDevice | undefined>>;
  readonly selectedId: string | null;
  readonly connections: readonly Connection[];
  readonly nodePositions: Readonly<
    Record<string, Readonly<{ x: number; y: number }> | undefined>
  >;
  readonly engineering: EngineeringSettings;
  connect(from: Endpoint, to: Endpoint): string;
  disconnect(id: string): void;
  moveNode(id: string, position: { x: number; y: number }): void;
  setEngineering(update: Partial<EngineeringSettings>): void;
  addDevice(input: NewDevice): string;
  updateDevice(id: string, update: DeviceUpdate): void;
  deleteDevice(id: string): void;
  selectDevice(id: string | null): void;
}

function finitePosition(position: XYZ): void {
  if (![position.x, position.y, position.z].every(Number.isFinite))
    throw new Error("Coordinates must be finite");
}
function freezeDevice(input: PlacedDevice): PlacedDevice {
  finitePosition(input.position);
  finitePosition(input.rotation);
  if (
    input.dimensions &&
    !Object.values(input.dimensions).every((n) => Number.isFinite(n) && n > 0)
  )
    throw new Error("Dimensions must be positive");
  for (const key of [
    "sensitivityDb",
    "speakerWatts",
    "maxSpeakerWatts",
    "coverageDegrees",
    "maxSpl",
  ] as const) {
    const value = input.metadata[key];
    if (value !== undefined && (!Number.isFinite(value) || value < 0))
      throw new Error("Invalid speaker specification");
  }
  if (
    input.metadata.speakerWatts !== undefined &&
    input.metadata.maxSpeakerWatts !== undefined &&
    input.metadata.speakerWatts > input.metadata.maxSpeakerWatts
  )
    throw new Error("Drive power exceeds loudspeaker rating");
  if (
    input.metadata.coverageDegrees !== undefined &&
    (input.metadata.coverageDegrees <= 0 ||
      input.metadata.coverageDegrees > 360)
  )
    throw new Error("Invalid coverage angle");
  for (const key of [
    "micRadiusM",
    "micAngleDeg",
    "horizontalDispersionDeg",
    "verticalDispersionDeg",
    "referenceDistanceM",
  ] as const) {
    const n = input.metadata[key];
    if (
      n !== undefined &&
      (!Number.isFinite(n) ||
        n <= 0 ||
        ((key === "micAngleDeg" || key.includes("Dispersion")) && n > 360))
    )
      throw new Error(`Invalid ${key}`);
  }
  if (
    input.metadata.referenceSplDb !== undefined &&
    (!Number.isFinite(input.metadata.referenceSplDb) ||
      input.metadata.referenceSplDb < 0 ||
      input.metadata.referenceSplDb > 180)
  )
    throw new Error("Invalid reference SPL");
  if (
    input.metadata.micModel !== undefined &&
    !["omni", "cone", "horizontal_sector", "radius_only"].includes(
      input.metadata.micModel,
    )
  )
    throw new Error("Invalid microphone model");
  for (const fov of [
    input.metadata.horizontalFovDeg,
    input.metadata.verticalFovDeg,
  ]) {
    if (fov !== undefined && (!Number.isFinite(fov) || fov <= 0 || fov >= 180))
      throw new Error("FOV must be greater than 0 and less than 180 degrees");
  }
  if (
    input.metadata.imageHeightM !== undefined &&
    (!Number.isFinite(input.metadata.imageHeightM) ||
      input.metadata.imageHeightM <= 0)
  )
    throw new Error("Image height must be positive");
  if (
    input.metadata.splAt1m != null &&
    (!Number.isFinite(input.metadata.splAt1m) ||
      input.metadata.splAt1m < 0 ||
      input.metadata.splAt1m > 150)
  )
    throw new Error("SPL must be 0–150 dB");
  for (const value of [
    input.metadata.powerWatts,
    input.metadata.heatBtuPerHour,
    input.metadata.rackUnits,
  ]) {
    if (value !== null && (!Number.isFinite(value) || value < 0))
      throw new Error("Invalid engineering metadata");
  }
  if (
    input.ports.some((port) => !port.id.trim()) ||
    new Set(input.ports.map((port) => port.id)).size !== input.ports.length
  ) {
    throw new Error("Port IDs must be nonempty and unique within a device");
  }
  return Object.freeze({
    ...input,
    ...(input.placement
      ? { placement: Object.freeze({ ...input.placement }) }
      : {}),
    position: Object.freeze({ ...input.position }),
    rotation: Object.freeze({ ...input.rotation }),
    ports: Object.freeze(
      input.ports.map((port) =>
        Object.freeze({
          ...port,
          ...(port.signalTypes
            ? { signalTypes: Object.freeze([...port.signalTypes]) }
            : {}),
        }),
      ),
    ),
    metadata: Object.freeze({ ...input.metadata }),
    ...(input.dimensions
      ? { dimensions: Object.freeze({ ...input.dimensions }) }
      : {}),
  });
}
const owns = (devices: DeviceState["devices"], id: string): boolean =>
  Object.prototype.hasOwnProperty.call(devices, id);
const sameXYZ = (a: XYZ, b: XYZ): boolean =>
  a.x === b.x && a.y === b.y && a.z === b.z;

/** Independent Zustand store per workspace; vanilla API needs no React runtime. */
export function createDeviceStore(): StoreApi<DeviceState> {
  return createStore<DeviceState>()((set, get) => ({
    catalog: INITIAL_CATALOG,
    importCatalog(input, sourceFile) {
      const incoming = parseCatalog(input, sourceFile),
        state = get();
      const ids = new Set(state.catalog.map((p) => p.id));
      if (incoming.some((p) => ids.has(p.id)))
        throw new Error(
          "Catalog IDs already exist. Use new IDs for revised profiles so placed specifications remain traceable.",
        );
      set({ catalog: Object.freeze([...state.catalog, ...incoming]) });
    },
    setRoom(update) {
      const state = get(),
        room = Object.freeze({
          ...state.room,
          ...update,
          table:
            update.table === undefined &&
            !Object.prototype.hasOwnProperty.call(update, "table")
              ? state.room.table
              : update.table
                ? Object.freeze({ ...update.table })
                : undefined,
          ...(update.roomType
            ? { layout: layoutForType(update.roomType) }
            : {}),
        });
      if (
        ![room.width, room.depth, room.height].every(Number.isFinite) ||
        (room.eyeHeightM !== undefined &&
          (!Number.isFinite(room.eyeHeightM) ||
            room.eyeHeightM < 0.5 ||
            room.eyeHeightM > room.height)) ||
        (room.capacity !== undefined &&
          (!Number.isInteger(room.capacity) ||
            room.capacity < 0 ||
            room.capacity > 200)) ||
        (room.roomType !== undefined && !ROOM_TYPES.includes(room.roomType)) ||
        room.width < 3 ||
        room.width > 30 ||
        room.depth < 3 ||
        room.depth > 30 ||
        room.height < 2 ||
        room.height > 8 ||
        !["conference", "huddle", "training"].includes(
          room.layout ?? "conference",
        )
      )
        throw new Error(
          "Room requires width/length 3–30 m and height 2–8 m",
        );
      if (
        room.table &&
        (!Number.isFinite(room.table.width) ||
          !Number.isFinite(room.table.depth) ||
          !Number.isFinite(room.table.height) ||
          room.table.width < 0.6 ||
          room.table.width > 20 ||
          room.table.depth < 0.6 ||
          room.table.depth > 20 ||
          room.table.height < 0.55 ||
          room.table.height > 1.2 ||
          !["oak", "walnut", "white"].includes(room.table.finish) ||
          !["rounded", "rectangular"].includes(room.table.shape))
      )
        throw new Error("Invalid table settings");
      if (
        JSON.stringify(room.table) === JSON.stringify(state.room.table) &&
        room.eyeHeightM === state.room.eyeHeightM &&
        room.width === state.room.width &&
        room.depth === state.room.depth &&
        room.height === state.room.height &&
        room.layout === state.room.layout &&
        room.capacity === state.room.capacity &&
        room.roomType === state.room.roomType
      )
        return;
      const devices = Object.fromEntries(
        Object.entries(state.devices).map(([id, d]) => [
          id,
          d
            ? freezeDevice({
                ...d,
                position: d.placement
                  ? d.position
                  : snapToSurface(d.position, d.surface, room),
              })
            : undefined,
        ]),
      );
      set({
        room,
        roomPreset: "custom",
        devices: solvePlacements(devices, room),
      });
    },
    room: ROOM_PRESETS.boardroom.room,
    roomPreset: "boardroom",
    setRoomPreset(id) {
      if (!Object.prototype.hasOwnProperty.call(ROOM_PRESETS, id))
        throw new Error("Unknown room preset");
      const state = get();
      if (state.roomPreset === id) return;
      const room = ROOM_PRESETS[id].room;
      const devices = Object.fromEntries(
        Object.entries(state.devices).map(([key, device]) => [
          key,
          device
            ? freezeDevice({
                ...device,
                position: device.placement
                  ? device.position
                  : snapToSurface(
                      {
                        x: (device.position.x * room.width) / state.room.width,
                        y:
                          (device.position.y * room.height) / state.room.height,
                        z: (device.position.z * room.depth) / state.room.depth,
                      },
                      device.surface,
                      room,
                    ),
              })
            : undefined,
        ]),
      );
      set({ room, roomPreset: id, devices: solvePlacements(devices, room) });
    },
    devices: Object.freeze({}),
    selectedId: null,
    connections: Object.freeze([]),
    nodePositions: Object.freeze({}),
    engineering: Object.freeze({
      viewingRatio: 6,
      elementPercent: 3,
      horizontalLimit: 60,
      verticalLimit: 30,
      noiseDb: null,
      rt60: null,
      targetSpl: 65,
      powerBudget: 1800,
      heatBudget: 6000,
    }),
    setEngineering(update) {
      const next = { ...get().engineering, ...update };
      if (
        !Object.values(next).every(
          (value) => value === null || Number.isFinite(value),
        ) ||
        ![4, 6, 8].includes(next.viewingRatio) ||
        next.elementPercent <= 0 ||
        next.elementPercent > 100 ||
        next.horizontalLimit <= 0 ||
        next.horizontalLimit >= 90 ||
        next.verticalLimit <= 0 ||
        next.verticalLimit >= 90 ||
        next.powerBudget <= 0 ||
        next.heatBudget <= 0 ||
        next.targetSpl < 0 ||
        next.targetSpl > 150 ||
        (next.noiseDb !== null && (next.noiseDb < 0 || next.noiseDb > 150)) ||
        (next.rt60 !== null && (next.rt60 <= 0 || next.rt60 > 20))
      )
        throw new Error("Invalid engineering inputs");
      set({ engineering: Object.freeze(next) });
    },
    connect(from, to) {
      const state = get();
      const source = owns(state.devices, from.deviceId)
        ? state.devices[from.deviceId]?.ports.find((p) => p.id === from.portId)
        : undefined;
      const target = owns(state.devices, to.deviceId)
        ? state.devices[to.deviceId]?.ports.find((p) => p.id === to.portId)
        : undefined;
      if (
        !source ||
        !target ||
        from.deviceId === to.deviceId ||
        source.direction === "input" ||
        target.direction === "output" ||
        source.signal !== target.signal
      )
        throw new Error(
          "Connect compatible output and input ports on different devices",
        );
      const occupied = (endpoint: Endpoint) =>
        state.connections.some(
          (c) =>
            (c.from.deviceId === endpoint.deviceId &&
              c.from.portId === endpoint.portId) ||
            (c.to.deviceId === endpoint.deviceId &&
              c.to.portId === endpoint.portId),
        );
      if (occupied(to)) throw new Error("This input is already connected");
      if ((source.connector || source.signal !== "Dante") && occupied(from))
        throw new Error("This point-to-point output is already connected");
      const id = crypto.randomUUID();
      set({
        connections: Object.freeze([
          ...state.connections,
          Object.freeze({
            id,
            from: Object.freeze({ ...from }),
            to: Object.freeze({ ...to }),
            signal: source.signal,
          }),
        ]),
      });
      return id;
    },
    disconnect(id) {
      set((state) => ({
        connections: Object.freeze(
          state.connections.filter((c) => c.id !== id),
        ),
      }));
    },
    moveNode(id, position) {
      if (
        !owns(get().devices, id) ||
        !Number.isFinite(position.x) ||
        !Number.isFinite(position.y)
      )
        throw new Error("Invalid schematic position");
      set((state) => ({
        nodePositions: Object.freeze({
          ...state.nodePositions,
          [id]: Object.freeze({ ...position }),
        }),
      }));
    },
    addDevice(input) {
      const id = input.id ?? crypto.randomUUID();
      if (!id.trim() || owns(get().devices, id))
        throw new Error("Device ID must be nonempty and unique");
      const device = freezeDevice({ ...input, id });
      const existing = Object.values(get().devices).filter(
        (d): d is PlacedDevice => !!d,
      );
      let nodeY = 50;
      for (let start = 0; start + 3 <= existing.length; start += 3)
        nodeY +=
          Math.max(
            ...existing
              .slice(start, start + 3)
              .map((d) => 90 + d.ports.length * 24),
          ) + 80;
      set((state) => ({
        devices: solvePlacements(
          { ...state.devices, [id]: device },
          state.room,
        ),
        nodePositions: Object.freeze({
          ...state.nodePositions,
          [id]: Object.freeze({
            x: 50 + (Object.keys(state.devices).length % 3) * 340,
            y: nodeY,
          }),
        }),
      }));
      return id;
    },
    updateDevice(id, update) {
      const state = get();
      const previous = owns(state.devices, id) ? state.devices[id] : undefined;
      if (!previous) throw new Error(`Unknown device: ${id}`);
      const device = freezeDevice({
        ...previous,
        ...update,
        id,
        placement:
          update.placement ??
          ((update.position || update.rotation || update.surface) &&
          previous.placement
            ? { ...previous.placement, mode: "manual" }
            : previous.placement),
        position: { ...previous.position, ...update.position },
        rotation: { ...previous.rotation, ...update.rotation },
        metadata: { ...previous.metadata, ...update.metadata },
      });
      if (
        sameXYZ(previous.position, device.position) &&
        sameXYZ(previous.rotation, device.rotation) &&
        previous.catalogId === device.catalogId &&
        JSON.stringify(previous.placement) ===
          JSON.stringify(device.placement) &&
        previous.kind === device.kind &&
        previous.surface === device.surface &&
        JSON.stringify(previous.metadata) === JSON.stringify(device.metadata) &&
        previous.metadata.label === device.metadata.label &&
        previous.metadata.powerWatts === device.metadata.powerWatts &&
        previous.metadata.heatBtuPerHour === device.metadata.heatBtuPerHour &&
        previous.metadata.rackUnits === device.metadata.rackUnits &&
        previous.metadata.imageHeightM === device.metadata.imageHeightM &&
        previous.metadata.splAt1m === device.metadata.splAt1m &&
        (update.ports === undefined || update.ports === previous.ports)
      )
        return;
      const devices = solvePlacements(
        { ...state.devices, [id]: device },
        state.room,
      );
      const connections =
        update.ports === undefined
          ? state.connections
          : Object.freeze(
              state.connections.filter((c) => {
                const from = devices[c.from.deviceId]?.ports.find(
                  (p) => p.id === c.from.portId,
                );
                const to = devices[c.to.deviceId]?.ports.find(
                  (p) => p.id === c.to.portId,
                );
                return (
                  from &&
                  to &&
                  from.direction !== "input" &&
                  to.direction !== "output" &&
                  from.signal === to.signal &&
                  from.signal === c.signal
                );
              }),
            );
      set({ devices, connections });
    },
    deleteDevice(id) {
      const state = get();
      if (!owns(state.devices, id)) return;
      const devices = { ...state.devices };
      delete devices[id];
      const nodePositions = { ...state.nodePositions };
      delete nodePositions[id];
      set({
        devices: solvePlacements(devices, state.room),
        nodePositions: Object.freeze(nodePositions),
        connections: Object.freeze(
          state.connections.filter(
            (c) => c.from.deviceId !== id && c.to.deviceId !== id,
          ),
        ),
        selectedId: state.selectedId === id ? null : state.selectedId,
      });
    },
    selectDevice(id) {
      const state = get();
      if (id !== null && !owns(state.devices, id))
        throw new Error(`Unknown device: ${id}`);
      if (state.selectedId !== id) set({ selectedId: id });
    },
  }));
}

/** Compatibility facade for the imperative Three.js integration; no second state copy. */
export class DeviceStore {
  constructor(readonly api: StoreApi<DeviceState> = createDeviceStore()) {}
  get(id: string): PlacedDevice | undefined {
    const devices = this.api.getState().devices;
    return owns(devices, id) ? devices[id] : undefined;
  }
  snapshot(): readonly PlacedDevice[] {
    return Object.freeze(
      Object.values(this.api.getState().devices).filter(
        (device): device is PlacedDevice => device !== undefined,
      ),
    );
  }
  subscribe(listener: (change: DeviceChange) => void): () => void {
    return this.api.subscribe((state, previous) => {
      if (state.devices === previous.devices) return;
      for (const id of new Set([
        ...Object.keys(state.devices),
        ...Object.keys(previous.devices),
      ])) {
        const device = owns(state.devices, id) ? state.devices[id] : undefined;
        const old = owns(previous.devices, id)
          ? previous.devices[id]
          : undefined;
        if (device !== old) listener({ id, device });
      }
    });
  }
  add(input: NewDevice): string {
    return this.api.getState().addDevice(input);
  }
  update(id: string, update: DeviceUpdate): void {
    this.api.getState().updateDevice(id, update);
  }
  move(id: string, position: XYZ): void {
    this.update(id, { position });
  }
  remove(id: string): void {
    this.api.getState().deleteDevice(id);
  }
}

/** Room origin is its floor centre. Clamp grid indices so boundary points stay on-grid. */
export function snapToSurface(
  point: XYZ,
  surface: MountSurface,
  room: RoomSize,
  step = 0.5,
): XYZ {
  if (
    ![room.width, room.depth, room.height, step].every(
      (n) => Number.isFinite(n) && n > 0,
    )
  )
    throw new Error("Invalid room or grid size");
  finitePosition(point);
  const snap = (v: number, min: number, max: number) =>
    Math.min(
      Math.floor(max / step),
      Math.max(Math.ceil(min / step), Math.round(v / step)),
    ) * step;
  if (surface === "table") {
    if (!roomLayout(room).tables.length)
      return snapToSurface(point, "floor", room, step);
    const table = roomLayout(room).tables.reduce((best, current) =>
      Math.hypot(point.x - current.x, point.z - current.z) <
      Math.hypot(point.x - best.x, point.z - best.z)
        ? current
        : best,
    );
    return {
      x: snap(point.x, table.x - table.width / 2, table.x + table.width / 2),
      y: table.height,
      z: snap(point.z, table.z - table.depth / 2, table.z + table.depth / 2),
    };
  }
  return {
    x:
      surface === "east"
        ? room.width / 2
        : surface === "west"
          ? -room.width / 2
          : snap(point.x, -room.width / 2, room.width / 2),
    y:
      surface === "floor"
        ? 0
        : surface === "ceiling"
          ? room.height
          : snap(point.y, 0, room.height),
    z:
      surface === "north"
        ? -room.depth / 2
        : surface === "south"
          ? room.depth / 2
          : snap(point.z, -room.depth / 2, room.depth / 2),
  };
}
