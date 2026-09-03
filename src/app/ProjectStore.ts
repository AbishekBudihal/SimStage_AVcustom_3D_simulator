/**
 * ProjectStore.ts
 * Serialization boundary between AppState (live, mutable) and the
 * on-disk / exportable project JSON format described in the spec
 * (§28 PROJECT FILE FORMAT). Kept separate from AppState so the
 * file format can evolve independently of runtime state shape.
 */

import type { AppState } from './AppState';
import type { RoomModel } from '../room/RoomModel';
import type { Seat, TableSpec } from '../room/SeatingGenerator';
import type { EquipmentInstance, EquipmentProduct } from '../catalog/EquipmentCatalog';
import type { SystemConnection, SystemGroup, SystemRoute } from '../system/SystemTypes';
import { cachedCableRoute, invalidateCableRoutes } from '../system/CableRouter';
import { cableRouteContext } from '../system/cableContext';
import { loadDefaultCatalog } from '../catalog/loadCatalog';
import type { AVRack } from '../av/AVRack';

export interface ProjectFile {
  project: {
    name: string;
    designer: string;
    createdAt: string;
    version: string;
    roomUseCase: string;
  };
  room: RoomModel | null;
  seating: Seat[];
  /** Furniture (tables) belonging to the current seating layout. Optional
   *  on read so older project files (saved before tables were their own
   *  entity) still load — they'll just come back with no tables until the
   *  user regenerates seating. */
  tables?: TableSpec[];
  racks?: AVRack[];
  equipment: EquipmentInstance[];
  connections?: SystemConnection[];
  routes?: SystemRoute[];
  systemGroups?: SystemGroup[];
  systemLayout?: Record<string, { x: number; y: number }>;
  /** User-created devices embedded in the project for portability. */
  customDevices?: EquipmentProduct[];
  settings: {
    viewMode: string;
  };
}

const FORMAT_VERSION = '0.2.0';

export function serializeProject(state: AppState): ProjectFile {
  return {
    project: {
      name: state.project.name,
      designer: state.project.designer,
      createdAt: state.project.createdAt,
      version: FORMAT_VERSION,
      roomUseCase: state.project.roomUseCase
    },
    room: state.room,
    seating: state.seats,
    tables: state.tables,
    racks: state.racks,
    equipment: state.equipment,
    connections: state.connections.map((c) => {
      const route = cachedCableRoute(c, cableRouteContext(state, loadDefaultCatalog()));
      return {
        ...c,
        estimatedLengthM: route.totalLength,
        route
      };
    }),
    routes: state.routes,
    systemGroups: state.systemGroups,
    systemLayout: state.systemLayout,
    customDevices: collectCustomDevices(state),
    settings: {
      viewMode: state.viewMode
    }
  };
}

/** Collect user-created devices referenced by project equipment. */
function collectCustomDevices(state: AppState): EquipmentProduct[] {
  const catalog = loadDefaultCatalog();
  const customIds = new Set<string>();
  const devices: EquipmentProduct[] = [];
  for (const inst of state.equipment) {
    const product = catalog.get(inst.productId);
    if (product?.provenance === 'user_defined' && !customIds.has(product.id)) {
      customIds.add(product.id);
      devices.push(product);
    }
  }
  return devices;
}

export function downloadProject(state: AppState): void {
  const data = serializeProject(state);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${data.project.name.replace(/\s+/g, '_') || 'project'}.simstage.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function parseProjectJson(text: string): { ok: true; file: ProjectFile } | { ok: false; message: string } {
  try {
    const data = JSON.parse(text) as unknown;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, message: 'This file is not a SIMSTAGE project.' };
    }
    const project = (data as ProjectFile).project;
    if (!project || typeof project.name !== 'string') {
      return { ok: false, message: 'This file is missing project metadata and cannot be opened.' };
    }
    return { ok: true, file: data as ProjectFile };
  } catch {
    return { ok: false, message: 'The project file could not be read. It may not be valid JSON.' };
  }
}

export function loadProjectInto(state: AppState, file: ProjectFile): { ok: true } | { ok: false; message: string } {
  try {
    state.project.name = file.project.name;
    state.project.designer = file.project.designer;
    state.project.roomUseCase = file.project.roomUseCase as AppState['project']['roomUseCase'];
    // Direct assignment — never route through setRoom/setSeats here, which would
    // push undo history entries and could make a load look like a user edit.
    state.room = file.room ? JSON.parse(JSON.stringify(file.room)) : null;
    state.seats = JSON.parse(JSON.stringify(file.seating ?? []));
    state.tables = JSON.parse(JSON.stringify(file.tables ?? []));
    state.racks = JSON.parse(JSON.stringify(file.racks ?? []));
    state.equipment = JSON.parse(JSON.stringify(file.equipment ?? []));
    state.connections = JSON.parse(JSON.stringify(file.connections ?? []));
    state.routes = JSON.parse(JSON.stringify(file.routes ?? []));
    state.systemGroups = JSON.parse(JSON.stringify(file.systemGroups ?? []));
    state.systemLayout = JSON.parse(JSON.stringify(file.systemLayout ?? {}));
    state.selection = { kind: 'none', id: null };
    state.selectedConnectionId = null;
    // Register custom devices from project file into catalog
    if (file.customDevices?.length) {
      const cat = loadDefaultCatalog();
      cat.register(file.customDevices);
    }
    invalidateCableRoutes();
    state.clearHistory();
    state.notify();
    return { ok: true };
  } catch (err) {
    console.error(err);
    return { ok: false, message: 'The project could not be loaded. The file may be incomplete.' };
  }
}
