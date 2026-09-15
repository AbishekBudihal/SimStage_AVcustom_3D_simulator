import { createStore, type StoreApi } from 'zustand/vanilla';

export type XYZ = Readonly<{ x: number; y: number; z: number }>;
export type DeviceKind = 'display' | 'ptz_camera' | 'ceiling_mic' | 'speaker' | 'rack';
export type MountSurface = 'floor' | 'ceiling' | 'north' | 'south' | 'east' | 'west';
export interface DevicePort {
  readonly id: string;
  readonly label: string;
  readonly signal: string;
  readonly direction: 'input' | 'output' | 'bidirectional';
}
export interface DeviceMetadata {
  readonly label: string;
  readonly powerWatts: number | null;
  readonly heatBtuPerHour: number | null;
  readonly rackUnits: number | null;
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
}
export type NewDevice = Omit<PlacedDevice, 'id'> & { readonly id?: string };
export type DeviceUpdate = Partial<Pick<PlacedDevice, 'catalogId' | 'kind' | 'surface' | 'ports'>> & {
  readonly position?: Partial<XYZ>;
  readonly rotation?: Partial<XYZ>;
  readonly metadata?: Partial<DeviceMetadata>;
};
export interface RoomSize { readonly width: number; readonly depth: number; readonly height: number }
export type DeviceChange = Readonly<{ id: string; device: PlacedDevice | undefined }>;
export interface DeviceState {
  readonly devices: Readonly<Record<string, PlacedDevice | undefined>>;
  readonly selectedId: string | null;
  addDevice(input: NewDevice): string;
  updateDevice(id: string, update: DeviceUpdate): void;
  deleteDevice(id: string): void;
  selectDevice(id: string | null): void;
}

function finitePosition(position: XYZ): void {
  if (![position.x, position.y, position.z].every(Number.isFinite)) throw new Error('Coordinates must be finite');
}
function freezeDevice(input: PlacedDevice): PlacedDevice {
  finitePosition(input.position);
  finitePosition(input.rotation);
  for (const value of [input.metadata.powerWatts, input.metadata.heatBtuPerHour, input.metadata.rackUnits]) {
    if (value !== null && (!Number.isFinite(value) || value < 0)) throw new Error('Invalid engineering metadata');
  }
  if (input.ports.some(port => !port.id.trim()) || new Set(input.ports.map(port => port.id)).size !== input.ports.length) {
    throw new Error('Port IDs must be nonempty and unique within a device');
  }
  return Object.freeze({ ...input,
    position: Object.freeze({ ...input.position }), rotation: Object.freeze({ ...input.rotation }),
    ports: Object.freeze(input.ports.map(port => Object.freeze({ ...port }))),
    metadata: Object.freeze({ ...input.metadata }),
  });
}
const owns = (devices: DeviceState['devices'], id: string): boolean => Object.prototype.hasOwnProperty.call(devices, id);
const sameXYZ = (a: XYZ, b: XYZ): boolean => a.x === b.x && a.y === b.y && a.z === b.z;

/** Independent Zustand store per workspace; vanilla API needs no React runtime. */
export function createDeviceStore(): StoreApi<DeviceState> {
  return createStore<DeviceState>()((set, get) => ({
    devices: Object.freeze({}),
    selectedId: null,
    addDevice(input) {
      const id = input.id ?? crypto.randomUUID();
      if (!id.trim() || owns(get().devices, id)) throw new Error('Device ID must be nonempty and unique');
      const device = freezeDevice({ ...input, id });
      set(state => ({ devices: Object.freeze({ ...state.devices, [id]: device }) }));
      return id;
    },
    updateDevice(id, update) {
      const state = get();
      const previous = owns(state.devices, id) ? state.devices[id] : undefined;
      if (!previous) throw new Error(`Unknown device: ${id}`);
      const device = freezeDevice({ ...previous, ...update, id,
        position: { ...previous.position, ...update.position },
        rotation: { ...previous.rotation, ...update.rotation },
        metadata: { ...previous.metadata, ...update.metadata },
      });
      if (sameXYZ(previous.position, device.position) && sameXYZ(previous.rotation, device.rotation)
        && previous.catalogId === device.catalogId && previous.kind === device.kind && previous.surface === device.surface
        && previous.metadata.label === device.metadata.label && previous.metadata.powerWatts === device.metadata.powerWatts
        && previous.metadata.heatBtuPerHour === device.metadata.heatBtuPerHour && previous.metadata.rackUnits === device.metadata.rackUnits
        && (update.ports === undefined || update.ports === previous.ports)) return;
      set({ devices: Object.freeze({ ...state.devices, [id]: device }) });
    },
    deleteDevice(id) {
      const state = get();
      if (!owns(state.devices, id)) return;
      const devices = { ...state.devices };
      delete devices[id];
      set({ devices: Object.freeze(devices), selectedId: state.selectedId === id ? null : state.selectedId });
    },
    selectDevice(id) {
      const state = get();
      if (id !== null && !owns(state.devices, id)) throw new Error(`Unknown device: ${id}`);
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
    return Object.freeze(Object.values(this.api.getState().devices).filter((device): device is PlacedDevice => device !== undefined));
  }
  subscribe(listener: (change: DeviceChange) => void): () => void {
    return this.api.subscribe((state, previous) => {
      if (state.devices === previous.devices) return;
      for (const id of new Set([...Object.keys(state.devices), ...Object.keys(previous.devices)])) {
        const device = owns(state.devices, id) ? state.devices[id] : undefined;
        const old = owns(previous.devices, id) ? previous.devices[id] : undefined;
        if (device !== old) listener({ id, device });
      }
    });
  }
  add(input: NewDevice): string { return this.api.getState().addDevice(input); }
  update(id: string, update: DeviceUpdate): void { this.api.getState().updateDevice(id, update); }
  move(id: string, position: XYZ): void { this.update(id, { position }); }
  remove(id: string): void { this.api.getState().deleteDevice(id); }
}

/** Room origin is its floor centre. Clamp grid indices so boundary points stay on-grid. */
export function snapToSurface(point: XYZ, surface: MountSurface, room: RoomSize, step = 0.5): XYZ {
  if (![room.width, room.depth, room.height, step].every(n => Number.isFinite(n) && n > 0)) throw new Error('Invalid room or grid size');
  finitePosition(point);
  const snap = (v: number, min: number, max: number) =>
    Math.min(Math.floor(max / step), Math.max(Math.ceil(min / step), Math.round(v / step))) * step;
  return {
    x: surface === 'east' ? room.width / 2 : surface === 'west' ? -room.width / 2 : snap(point.x, -room.width / 2, room.width / 2),
    y: surface === 'floor' ? 0 : surface === 'ceiling' ? room.height : snap(point.y, 0, room.height),
    z: surface === 'north' ? -room.depth / 2 : surface === 'south' ? room.depth / 2 : snap(point.z, -room.depth / 2, room.depth / 2),
  };
}
