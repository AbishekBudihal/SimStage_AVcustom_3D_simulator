/**
 * AppState.ts
 * ────────────────────────────────────────────────────────────
 * Single source of truth for the whole application.
 * UI code NEVER mutates room/equipment data directly — it calls
 * AppState methods, which notify subscribers. This keeps
 * engineering calculations, 3D rendering, and DOM panels in sync
 * without tangled procedural DOM manipulation.
 * ────────────────────────────────────────────────────────────
 */

import type { RoomModel } from '../room/RoomModel';
import { defaultSeatingConfig, generateSeating, type Seat, type SeatingLayout, type TableSpec } from '../room/SeatingGenerator';
import { clampTableCenter } from '../room/FurnitureGeometry';
import { rotateTableSpec90 } from '../room/FurnitureRelayout';
import {
  applyPresetToTable,
  clampTableSpecSizes,
  relayoutSeatsForTable,
  seatsOwnedByTable,
  translateSeatsForTable,
  type TablePresetId
} from '../room/ParametricTable';
import type { AVRack } from '../av/AVRack';
import { usedRackUnits, defaultFloorRack, defaultWallRack } from '../av/AVRack';
import { snapSeatPosition } from '../interaction/SnapEngine';
import type { AlignmentGuide } from '../interaction/CadSnap';
import type { EquipmentInstance, PlacementMode } from '../catalog/EquipmentCatalog';
import { HistoryManager, cloneSnapshot, type AppStateSnapshot } from './HistoryManager';
import { applyAlignCommand, type AlignCommand } from '../interaction/AlignEngine';
import { overlayLayerForFinding } from '../av/simulation/AnalysisLayer';
import { loadDefaultCatalog } from '../catalog/loadCatalog';
import type { SystemConnection, SystemGroup, SystemRoute, SignalType, PhysicalMedium } from '../system/SystemTypes';
import { computeAutoLayout } from '../system/SystemLayout';
import { isRoutableProduct } from '../system/SystemRouting';
import { canConnectPorts, canConnectWithCable, duplicateConnection, occupancyConflict, maxConnectionsFor } from '../system/PortCompatibility';
import { resolveInstancePorts } from '../system/PortResolver';
import { connectionsTouching, invalidateCableRoutes } from '../system/CableRouter';
import { defaultQuickRequirements, type AutoDesignMode, type DesignRequirements, type DesignUseCase } from '../autodesign/DesignRequirements';
import { generateDesign, hasManualChanges, selectedOption } from '../autodesign/DesignPipeline';
import type { DesignOption, DesignProposal } from '../autodesign/DesignProposal';
import {
  requirementsFromSetup,
  roomFromSetup,
  shellNavForWorkspace,
  type ProjectTypeId,
  type ShellNav,
  type UiComplexity
} from '../ui/workspace/projectSetup';

const catalog = loadDefaultCatalog();

/** Find the lowest RU position where a device of `units` RU can fit without overlapping. */
function nextFreeRU(
  rack: import('../av/AVRack').AVRack,
  units: number,
  others: Array<{ rackPositionRU?: number; rackUnits?: number }>
): number {
  const occupied = new Set<number>();
  for (const o of others) {
    const start = o.rackPositionRU ?? 0;
    const height = o.rackUnits ?? 0;
    if (start > 0 && height > 0) {
      for (let u = start; u < start + height; u++) occupied.add(u);
    }
  }
  for (let pos = 1; pos <= rack.ruTotal - units + 1; pos++) {
    let fits = true;
    for (let u = pos; u < pos + units; u++) {
      if (occupied.has(u)) { fits = false; break; }
    }
    if (fits) return pos;
  }
  return 1;
}

export type WorkflowStep =
  | 'project'
  | 'room'
  | 'seating'
  | 'requirements'
  | 'equipment'
  | 'autodesign'
  | 'simulation'
  | 'analysis'
  | 'optimization'
  | 'report';

export interface SetupDraft {
  projectType: ProjectTypeId;
  capacity: number;
  customCapacity: boolean;
  widthM: number;
  lengthM: number;
  heightM: number;
  useCase: DesignUseCase;
  accessibility: 'standard' | 'enhanced';
}

export interface ProjectInfo {
  name: string;
  designer: string;
  createdAt: string;
  roomUseCase:
    | 'huddle'
    | 'small_meeting'
    | 'conference'
    | 'boardroom'
    | 'training'
    | 'classroom'
    | 'lecture_hall'
    | 'auditorium'
    | 'custom';
  accessibility?: 'standard' | 'enhanced';
}

export interface AVRequirements {
  presentation: boolean;
  videoConference: boolean;
  audioReinforcement: boolean;
  recording: boolean;
  contentSharing: boolean;
}

export type SelectionKind = 'seat' | 'equipment' | 'table' | 'room' | 'rack' | 'none';
export type ViewportTool = 'select' | 'move' | 'rotate' | 'measure';
export type CameraViewPreset = 'persp' | 'top' | 'front' | 'left' | 'right';

export interface Selection {
  kind: SelectionKind;
  id: string | null;
}

export type TransformMode = 'translate' | 'rotate';
export type SightlineMode = 'off' | 'selected' | 'all';
export type SamplingQuality = 'standard' | 'high';

export type DisplayHeatmapMetric = 'overall' | 'distance' | 'angle' | 'sightline';

export interface DisplayAnalysisView {
  enabled: boolean;
  seatStatus: boolean;
  sightlines: SightlineMode;
  heatmap: boolean;
  contours: boolean;
  heatmapMetric: DisplayHeatmapMetric;
  samplingQuality: SamplingQuality;
  detailsOpen: boolean;
}

export interface MicAnalysisView {
  enabled: boolean;
  seatStatus: boolean;
  pickupRegions: boolean;
  heatmap: boolean;
  contours: boolean;
  samplingQuality: SamplingQuality;
  detailsOpen: boolean;
}

export interface AudioAnalysisView {
  enabled: boolean;
  seatStatus: boolean;
  coverageRegions: boolean;
  heatmap: boolean;
  contours: boolean;
  samplingQuality: SamplingQuality;
  detailsOpen: boolean;
}

export interface CameraAnalysisView {
  enabled: boolean;
  seatStatus: boolean;
  fovRegions: boolean;
  blockedSightlines: boolean;
  heatmap: boolean;
  contours: boolean;
  samplingQuality: SamplingQuality;
  detailsOpen: boolean;
}

type Listener = () => void;

export class AppState {
  step: WorkflowStep = 'project';
  project: ProjectInfo = {
    name: 'Untitled Project',
    designer: '',
    createdAt: new Date().toISOString(),
    roomUseCase: 'conference'
  };
  requirements: AVRequirements = {
    presentation: true,
    videoConference: true,
    audioReinforcement: true,
    recording: false,
    contentSharing: true
  };

  room: RoomModel | null = null;
  seats: Seat[] = [];
  tables: TableSpec[] = [];
  equipment: EquipmentInstance[] = [];
  /** Topology. Undoable. Not a simulation overlay. */
  connections: SystemConnection[] = [];
  routes: SystemRoute[] = [];
  racks: AVRack[] = [];
  lastSeatingLayout: SeatingLayout = 'boardroom';
  systemGroups: SystemGroup[] = [];

  selection: Selection = { kind: 'none', id: null };
  viewMode: '3d' | 'plan' | 'elevation' = '3d';
  transformMode: TransformMode = 'translate';

  viewerMode: { active: boolean; seatId: string | null } = { active: false, seatId: null };
  lastSnapNote = '';

  /** Visualization flags only — not part of undo snapshots (does not mutate the design). */
  displayAnalysis: DisplayAnalysisView = {
    enabled: false,
    seatStatus: true,
    sightlines: 'off',
    heatmap: false,
    contours: true,
    heatmapMetric: 'overall',
    samplingQuality: 'standard',
    detailsOpen: false
  };

  /** Visualization flags only — not part of undo snapshots. */
  micAnalysis: MicAnalysisView = {
    enabled: false,
    seatStatus: true,
    pickupRegions: true,
    heatmap: false,
    contours: true,
    samplingQuality: 'standard',
    detailsOpen: false
  };

  audioAnalysis: AudioAnalysisView = {
    enabled: false,
    seatStatus: true,
    coverageRegions: true,
    heatmap: false,
    contours: true,
    samplingQuality: 'standard',
    detailsOpen: false
  };

  cameraAnalysis: CameraAnalysisView = {
    enabled: false,
    seatStatus: true,
    fovRegions: true,
    blockedSightlines: true,
    heatmap: false,
    contours: true,
    samplingQuality: 'standard',
    detailsOpen: false
  };

  workspaceMode: 'design' | 'system' | 'simulate' | 'validate' | 'docs' = 'design';
  /** Primary chrome tab. View state — not undo. */
  shellNav: ShellNav = 'project';
  uiComplexity: UiComplexity = 'beginner';
  setupOpen = true;
  setupDraft: SetupDraft = {
    projectType: 'video_conference',
    capacity: 8,
    customCapacity: false,
    widthM: 8,
    lengthM: 10,
    heightM: 3,
    useCase: 'video_conference',
    accessibility: 'standard'
  };
  /** Design-mode left panel: room / seating / catalog. View state, not undo. */
  designTool: 'room' | 'seating' | 'catalog' = 'room';
  /** System-mode left panel sub-tab. View state, not undo. */
  systemPanelTab: 'library' | 'cables' = 'library';
  /** Extra equipment ids when shift-selecting. View/session, not undo. */
  additionalSelectedIds: string[] = [];
  /** Viewport hide — view state, not undo. */
  hiddenEquipmentIds: string[] = [];
  collapsedTreeGroups: Record<string, boolean> = {};
  /** System canvas layout — diagram only, undoable, not physical XYZ. */
  systemLayout: Record<string, { x: number; y: number }> = {};
  systemPan = { x: 24, y: 24 };
  systemZoom = 1;
  systemDetailMode: 'beginner' | 'pro' = 'beginner';
  systemConnectFrom: { instanceId: string; portId: string } | null = null;
  lastSystemError = '';
  selectedConnectionId: string | null = null;
  selectedPathId: string | null = null;
  highlightedConnectionIds: string[] = [];
  systemFilter: 'all' | SignalType = 'all';
  systemSearch = '';
  systemCanvasMode: 'edit' | 'schematic' = 'edit';
  /** Show 3D/plan room with cable polylines instead of the schematic canvas. */
  systemPhysicalView = false;
  /** Draw cable routes in the room (also forced when a connection is selected). */
  showCableRoutes = false;
  /** Optional max run per medium. Empty = no configured limit. */
  cableLengthLimitsM: Partial<Record<PhysicalMedium, number>> = {};
  selectedFindingId: string | null = null;
  highlightedSeatIds: string[] = [];
  highlightedTableIds: string[] = [];
  findingFocusRequest = 0;
  validationDeltaMessage = '';
  detailsFindingId: string | null = null;

  /** Auto Design session — not part of undo snapshots. */
  autoDesignOpen = false;
  autoDesignMode: AutoDesignMode = 'quick';
  autoDesignLearn = false;
  autoDesignWhyOpen = false;
  autoDesignRegenChoice = false;
  autoDesignDraft: DesignRequirements = defaultQuickRequirements();
  autoDesignProposal: DesignProposal | null = null;
  lastAutoInstanceIds: string[] = [];
  dismissedRecommendationIds: string[] = [];
  assistantCollapsed = true;
  assistantDrawerOpen = false;
  leftPanelCollapsed = false;
  rightPanelCollapsed = false;
  viewportTool: ViewportTool = 'select';
  gridSpacingM = 0.5;
  cameraView: CameraViewPreset = 'persp';
  cameraViewTick = 0;
  measurePoints: Array<{ x: number; z: number }> = [];
  measureDistanceM: number | null = null;
  alignmentGuides: AlignmentGuide[] = [];
  planRotateArmed = false;

  private listeners: Set<Listener> = new Set();
  private history = new HistoryManager();
  private historyPrepared = false;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notifyScheduled = false;
  notify(): void {
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    queueMicrotask(() => {
      this.notifyScheduled = false;
      this.listeners.forEach((fn) => fn());
    });
  }

  captureSnapshot(): AppStateSnapshot {
    return cloneSnapshot({
      room: this.room,
      seats: this.seats,
      tables: this.tables,
      equipment: this.equipment,
      connections: this.connections,
      routes: this.routes,
      racks: this.racks,
      systemGroups: this.systemGroups,
      systemLayout: this.systemLayout,
      selection: this.selection
    });
  }

  private applySnapshot(snap: AppStateSnapshot): void {
    const cloned = cloneSnapshot(snap);
    this.room = cloned.room;
    this.seats = cloned.seats;
    this.tables = cloned.tables;
    this.equipment = cloned.equipment;
    this.connections = cloned.connections ?? [];
    this.routes = cloned.routes ?? [];
    this.racks = cloned.racks ?? [];
    this.systemGroups = cloned.systemGroups ?? [];
    this.systemLayout = cloned.systemLayout ?? {};
    this.selection = cloned.selection;
    this.additionalSelectedIds = [];
    this.historyPrepared = false;
  }

  prepareHistory(): void {
    if (this.historyPrepared) return;
    this.history.push(this.captureSnapshot());
    this.historyPrepared = true;
  }

  /** Call at end of a drag gesture so the next edit gets its own undo entry. */
  finishGesture(): void {
    this.historyPrepared = false;
  }

  private recordAndReset(): void {
    if (!this.historyPrepared) this.history.push(this.captureSnapshot());
    this.historyPrepared = false;
  }

  canUndo(): boolean {
    return this.history.canUndo();
  }

  canRedo(): boolean {
    return this.history.canRedo();
  }

  undo(): void {
    const restored = this.history.undo(this.captureSnapshot());
    if (!restored) return;
    this.applySnapshot(restored);
    invalidateCableRoutes();
    this.notify();
  }

  redo(): void {
    const restored = this.history.redo(this.captureSnapshot());
    if (!restored) return;
    this.applySnapshot(restored);
    invalidateCableRoutes();
    this.notify();
  }

  setStep(step: WorkflowStep): void {
    this.step = step;
    this.notify();
  }

  setRoom(room: RoomModel): void {
    this.recordAndReset();
    this.room = room;
    invalidateCableRoutes();
    this.notify();
  }

  setSeats(seats: Seat[], tables: TableSpec[] = [], layout?: SeatingLayout): void {
    this.recordAndReset();
    this.seats = seats;
    this.tables = tables;
    if (layout) this.lastSeatingLayout = layout;
    invalidateCableRoutes();
    this.notify();
  }

  setRacks(racks: AVRack[]): void {
    this.recordAndReset();
    this.racks = racks;
    this.notify();
  }

  addDefaultRack(kind: 'floor' | 'wall' = 'floor'): AVRack {
    this.recordAndReset();
    const id = `av-rack-${this.racks.length + 1}`;
    const rack = kind === 'wall' ? defaultWallRack(id) : defaultFloorRack(id);
    if (this.room) {
      rack.x = Number((this.room.width / 2 - rack.width / 2 - 0.2).toFixed(2));
      rack.z = Number((this.room.depth / 2 - rack.depth / 2 - 0.2).toFixed(2));
    }
    this.racks = [...this.racks, rack];
    this.notify();
    return rack;
  }

  updateRack(id: string, patch: Partial<AVRack>, options: { recordHistory?: boolean } = {}): void {
    if (options.recordHistory !== false) this.recordAndReset();
    const idx = this.racks.findIndex((r) => r.id === id);
    if (idx === -1) return;
    this.racks = [...this.racks.slice(0, idx), { ...this.racks[idx], ...patch }];
    invalidateCableRoutes();
    this.notify();
  }

  assignEquipmentToRack(instanceId: string, rackId: string | null, rackUnits?: number): void {
    const rack = rackId ? this.racks.find((r) => r.id === rackId) : null;
    const inst = this.equipment.find((e) => e.instanceId === instanceId);
    if (!inst) return;
    const product = catalog.get(inst.productId);
    const units = rackUnits ?? inst.rackUnits ?? product?.rackUnits;
    if (rack && units && units > 0) {
      const others = this.equipment.filter((e) => e.rackId === rack.id && e.instanceId !== instanceId);
      const used = usedRackUnits(others);
      if (used + units > rack.ruTotal) {
        this.lastSnapNote = `Rack ${rack.id} has ${rack.ruTotal - used} RU available; device needs ${units} RU.`;
        this.notify();
        return;
      }
    }
    const nextRU = rack && units ? nextFreeRU(rack, units, this.equipment.filter((e) => e.rackId === rack.id && e.instanceId !== instanceId)) : undefined;
    this.updateEquipment(instanceId, {
      rackId: rackId ?? undefined,
      rackUnits: units,
      rackPositionRU: nextRU
    });
  }

  addEquipment(item: EquipmentInstance): void {
    this.recordAndReset();
    this.equipment.push({ ...item, placementMode: item.placementMode ?? 'smart' });
    this.notify();
  }

  removeEquipment(id: string): void {
    this.recordAndReset();
    this.equipment = this.equipment.filter((e) => e.instanceId !== id);
    this.connections = this.connections.filter((c) => c.fromInstanceId !== id && c.toInstanceId !== id);
    this.routes = this.routes.filter((r) => r.instanceId !== id);
    invalidateCableRoutes();
    if (this.selection.id === id) this.selection = { kind: 'none', id: null };
    this.notify();
  }

  updateEquipment(
    id: string,
    patch: Partial<Pick<EquipmentInstance, 'position' | 'rotationY' | 'wall' | 'placementMode' | 'name' | 'origin' | 'rackId' | 'rackPositionRU' | 'rackUnits' | 'mountingKind'>>,
    options: { recordHistory?: boolean } = {}
  ): void {
    if (options.recordHistory !== false) this.recordAndReset();
    const idx = this.equipment.findIndex((e) => e.instanceId === id);
    if (idx === -1) return;
    const prev = this.equipment[idx];
    const next: EquipmentInstance = {
      ...prev,
      ...patch,
      placementMode: (patch.placementMode ?? 'manual') as PlacementMode,
      origin: patch.origin ?? (prev.origin === 'auto' ? 'manual' : prev.origin)
    };
    this.equipment = [...this.equipment.slice(0, idx), next, ...this.equipment.slice(idx + 1)];
    invalidateCableRoutes(connectionsTouching(this.connections, id));
    this.notify();
  }

  updateSeat(id: string, patch: Partial<Pick<Seat, 'x' | 'z' | 'facing'>>, options: { recordHistory?: boolean } = {}): void {
    if (options.recordHistory !== false) this.recordAndReset();
    const idx = this.seats.findIndex((s) => s.id === id);
    if (idx === -1) return;
    this.seats = [...this.seats.slice(0, idx), { ...this.seats[idx], ...patch }, ...this.seats.slice(idx + 1)];
    invalidateCableRoutes();
    this.notify();
  }

  updateTable(
    id: string,
    patch: Partial<
      Pick<TableSpec, 'centerX' | 'centerZ' | 'sizeX' | 'sizeZ' | 'height' | 'thickness' | 'hasCableWell' | 'furnitureId' | 'shape' | 'presetId'>
    >,
    options: { recordHistory?: boolean; requestedSeats?: number } = {}
  ): void {
    if (options.recordHistory !== false) this.recordAndReset();
    const idx = this.tables.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const prev = this.tables[idx];
    const sized = clampTableSpecSizes(patch);
    const next: TableSpec = { ...prev, ...patch, ...sized };
    if (sized.sizeX != null || sized.sizeZ != null || patch.shape != null) {
      next.presetId = patch.presetId ?? 'custom';
    }
    if (this.room) {
      const snapped = snapSeatPosition(next.centerX, next.centerZ, 0.05);
      const clamped = clampTableCenter(this.room, next, snapped.x, snapped.z);
      next.centerX = clamped.x;
      next.centerZ = clamped.z;
    }
    const dx = next.centerX - prev.centerX;
    const dz = next.centerZ - prev.centerZ;
    const resized =
      next.sizeX !== prev.sizeX ||
      next.sizeZ !== prev.sizeZ ||
      next.shape !== prev.shape ||
      next.furnitureId !== prev.furnitureId;
    this.tables = [...this.tables.slice(0, idx), next, ...this.tables.slice(idx + 1)];
    if (resized || options.requestedSeats != null) {
      const layout = relayoutSeatsForTable(next, this.seats, this.tables, options.requestedSeats);
      this.seats = layout.seats;
      this.lastSnapNote = layout.warning ?? '';
      const withDemand: TableSpec = {
        ...next,
        requestedSeats: layout.requested > layout.practical ? layout.requested : undefined
      };
      this.tables = [...this.tables.slice(0, idx), withDemand, ...this.tables.slice(idx + 1)];
    } else if (dx !== 0 || dz !== 0) {
      const owned = seatsOwnedByTable(next, this.seats, this.tables.length);
      if (owned.length && owned.every((s) => s.tableId === next.id)) {
        this.seats = translateSeatsForTable(next.id, this.seats, dx, dz);
      } else if (this.tables.length === 1) {
        this.seats = this.seats.map((s) => ({ ...s, x: s.x + dx, z: s.z + dz }));
      } else {
        this.seats = translateSeatsForTable(next.id, this.seats, dx, dz);
      }
    }
    invalidateCableRoutes();
    this.notify();
  }

  applyTablePreset(tableId: string, presetId: TablePresetId): void {
    const table = this.tables.find((t) => t.id === tableId);
    if (!table) return;
    const next = applyPresetToTable(table, presetId);
    this.updateTable(tableId, {
      sizeX: next.sizeX,
      sizeZ: next.sizeZ,
      height: next.height,
      shape: next.shape,
      furnitureId: next.furnitureId,
      hasCableWell: next.hasCableWell,
      presetId: next.presetId
    });
  }

  setTableSeatCount(tableId: string, count: number): void {
    const table = this.tables.find((t) => t.id === tableId);
    if (!table) return;
    this.updateTable(tableId, {}, { requestedSeats: count });
  }

  rotateSelectedTable90(): void {
    if (this.selection.kind !== 'table' || !this.selection.id) return;
    const table = this.tables.find((t) => t.id === this.selection.id);
    if (!table) return;
    this.recordAndReset();
    const rotated = rotateTableSpec90(table);
    this.updateTable(table.id, { sizeX: rotated.sizeX, sizeZ: rotated.sizeZ }, { recordHistory: false });
  }

  duplicateSelectedTable(): void {
    if (this.selection.kind !== 'table' || !this.selection.id) return;
    const table = this.tables.find((t) => t.id === this.selection.id);
    if (!table) return;
    this.recordAndReset();
    const copy: TableSpec = {
      ...table,
      id: `${table.id}-copy`,
      centerX: table.centerX + 0.6,
      centerZ: table.centerZ + 0.6
    };
    this.tables = [...this.tables, copy];
    this.selection = { kind: 'table', id: copy.id };
    this.notify();
  }

  alignSelectedTableCenter(): void {
    if (this.selection.kind !== 'table' || !this.selection.id) return;
    this.updateTable(this.selection.id, { centerX: 0, centerZ: 0 });
  }

  regenerateSeating(capacity?: number, layout: SeatingLayout = this.lastSeatingLayout): void {
    if (!this.room) return;
    const n = capacity ?? (this.seats.length || this.setupDraft.capacity || 8);
    const cfg = defaultSeatingConfig(n, layout);
    const gen = generateSeating(this.room, cfg);
    if (!gen.valid) {
      this.lastSnapNote = 'NO VALID LAYOUT — seating was not replaced.';
      this.notify();
      return;
    }
    this.setSeats(gen.seats, gen.tables, layout);
  }

  setViewportTool(tool: ViewportTool): void {
    this.viewportTool = tool;
    if (tool === 'move') this.transformMode = 'translate';
    if (tool === 'rotate') this.transformMode = 'rotate';
    if (tool !== 'measure') {
      this.measurePoints = [];
      this.measureDistanceM = null;
    }
    this.notify();
  }

  setGridSpacing(m: number): void {
    this.gridSpacingM = Math.max(0.05, Math.min(2, m));
    this.notify();
  }

  setCameraView(view: CameraViewPreset | 'fit'): void {
    if (view === 'fit') {
      this.requestFocus();
      return;
    }
    this.cameraView = view;
    this.cameraViewTick += 1;
    this.viewMode = '3d';
    this.notify();
  }

  toggleLeftPanel(): void {
    this.leftPanelCollapsed = !this.leftPanelCollapsed;
    this.notify();
  }

  toggleRightPanel(): void {
    this.rightPanelCollapsed = !this.rightPanelCollapsed;
    this.notify();
  }

  addMeasurePoint(x: number, z: number): void {
    const pts = [...this.measurePoints, { x, z }];
    if (pts.length >= 2) {
      const a = pts[pts.length - 2];
      const b = pts[pts.length - 1];
      this.measureDistanceM = Number(Math.hypot(b.x - a.x, b.z - a.z).toFixed(3));
      this.measurePoints = [a, b];
    } else {
      this.measurePoints = pts;
      this.measureDistanceM = null;
    }
    this.notify();
  }

  clearMeasure(): void {
    this.measurePoints = [];
    this.measureDistanceM = null;
    this.alignmentGuides = [];
    this.notify();
  }

  setAlignmentGuides(guides: AlignmentGuide[]): void {
    this.alignmentGuides = guides;
    this.notify();
  }

  select(kind: SelectionKind, id: string | null, additive = false): void {
    if (additive && kind === 'equipment' && id && this.selection.kind === 'equipment' && this.selection.id) {
      if (id === this.selection.id) {
        this.notify();
        return;
      }
      if (this.additionalSelectedIds.includes(id)) {
        this.additionalSelectedIds = this.additionalSelectedIds.filter((x) => x !== id);
      } else {
        this.additionalSelectedIds = [...this.additionalSelectedIds, id];
      }
      this.notify();
      return;
    }
    this.additionalSelectedIds = [];
    this.selectedConnectionId = null;
    this.selection = { kind, id };
    this.notify();
  }

  selectedEquipmentIds(): string[] {
    if (this.selection.kind !== 'equipment' || !this.selection.id) return [];
    return [this.selection.id, ...this.additionalSelectedIds];
  }

  setDesignTool(tool: 'room' | 'seating' | 'catalog'): void {
    this.designTool = tool;
    if (tool === 'room') this.step = 'room';
    if (tool === 'seating') this.step = 'seating';
    if (tool === 'catalog') this.step = 'equipment';
    this.workspaceMode = 'design';
    this.shellNav = tool === 'room' ? 'project' : 'design';
    this.notify();
  }

  setSystemPanelTab(tab: 'library' | 'cables'): void {
    this.systemPanelTab = tab;
    this.notify();
  }

  toggleEquipmentHidden(id: string): void {
    this.hiddenEquipmentIds = this.hiddenEquipmentIds.includes(id)
      ? this.hiddenEquipmentIds.filter((x) => x !== id)
      : [...this.hiddenEquipmentIds, id];
    this.notify();
  }

  isolateEquipment(id: string): void {
    this.hiddenEquipmentIds = this.equipment.filter((e) => e.instanceId !== id).map((e) => e.instanceId);
    this.notify();
  }

  showAllEquipment(): void {
    this.hiddenEquipmentIds = [];
    this.notify();
  }

  setTreeGroupCollapsed(group: string, collapsed: boolean): void {
    this.collapsedTreeGroups = { ...this.collapsedTreeGroups, [group]: collapsed };
    this.notify();
  }

  duplicateSelectedEquipment(): void {
    const id = this.selection.kind === 'equipment' ? this.selection.id : null;
    const inst = id ? this.equipment.find((e) => e.instanceId === id) : null;
    if (!inst) return;
    this.addEquipment({
      ...inst,
      instanceId: `eq-${Date.now()}`,
      name: `${inst.name} copy`,
      position: { x: inst.position.x + 0.4, y: inst.position.y, z: inst.position.z + 0.4 },
      placementMode: 'manual'
    });
    const copyId = this.equipment[this.equipment.length - 1]?.instanceId;
    if (copyId) {
      const src = this.systemLayout[inst.instanceId];
      this.systemLayout = {
        ...this.systemLayout,
        [copyId]: { x: (src?.x ?? 40) + 36, y: (src?.y ?? 40) + 36 }
      };
    }
  }

  deleteSelected(): void {
    if (this.selectedConnectionId) {
      const id = this.selectedConnectionId;
      this.selectedConnectionId = null;
      this.removeConnection(id);
      return;
    }
    if (this.selection.kind === 'rack' && this.selection.id) {
      const id = this.selection.id;
      this.recordAndReset();
      this.racks = this.racks.filter((r) => r.id !== id);
      this.equipment = this.equipment.map((e) => (e.rackId === id ? { ...e, rackId: undefined, rackPositionRU: undefined } : e));
      this.selection = { kind: 'none', id: null };
      this.notify();
      return;
    }
    if (this.selection.kind === 'table' && this.selection.id) {
      const id = this.selection.id;
      this.recordAndReset();
      this.tables = this.tables.filter((t) => t.id !== id);
      this.selection = { kind: 'none', id: null };
      this.notify();
      return;
    }
    if (this.selection.kind === 'equipment') {
      const ids = this.selectedEquipmentIds();
      if (!ids.length) return;
      this.recordAndReset();
      this.equipment = this.equipment.filter((e) => !ids.includes(e.instanceId));
      this.connections = this.connections.filter((c) => !ids.includes(c.fromInstanceId) && !ids.includes(c.toInstanceId));
      this.routes = this.routes.filter((r) => !ids.includes(r.instanceId));
      this.systemGroups = this.systemGroups.map((g) => ({
        ...g,
        memberIds: g.memberIds.filter((m) => !ids.includes(m))
      }));
      this.selection = { kind: 'none', id: null };
      this.additionalSelectedIds = [];
      this.selectedConnectionId = null;
      this.notify();
    }
  }

  applyAlign(command: AlignCommand): void {
    const ids = this.selectedEquipmentIds();
    if (ids.length < 2) return;
    const items = this.equipment
      .filter((e) => ids.includes(e.instanceId))
      .map((e) => ({ id: e.instanceId, x: e.position.x, z: e.position.z }));
    const next = applyAlignCommand(items, command);
    this.recordAndReset();
    next.forEach((n) => {
      const idx = this.equipment.findIndex((e) => e.instanceId === n.id);
      if (idx === -1) return;
      this.equipment[idx] = {
        ...this.equipment[idx],
        position: { ...this.equipment[idx].position, x: n.x, z: n.z },
        placementMode: 'manual'
      };
    });
    this.equipment = [...this.equipment];
    this.notify();
  }

  setViewMode(mode: '3d' | 'plan' | 'elevation'): void {
    this.viewMode = mode;
    this.notify();
  }

  setTransformMode(mode: TransformMode): void {
    this.transformMode = mode;
    this.notify();
  }

  setSnapNote(note: string): void {
    this.lastSnapNote = note;
    this.notify();
  }

  enableDisplayAnalysis(): void {
    this.displayAnalysis = {
      ...this.displayAnalysis,
      enabled: true,
      seatStatus: true
    };
    this.notify();
  }

  setDisplayAnalysisView(patch: Partial<DisplayAnalysisView>): void {
    this.displayAnalysis = { ...this.displayAnalysis, ...patch };
    if (patch.heatmap === true) {
      this.micAnalysis = { ...this.micAnalysis, heatmap: false };
      this.audioAnalysis = { ...this.audioAnalysis, heatmap: false };
      this.cameraAnalysis = { ...this.cameraAnalysis, heatmap: false };
    }
    this.notify();
  }

  disableDisplayAnalysis(): void {
    this.displayAnalysis = { ...this.displayAnalysis, enabled: false };
    this.notify();
  }

  enableMicAnalysis(): void {
    this.micAnalysis = { ...this.micAnalysis, enabled: true, seatStatus: true, pickupRegions: true };
    this.notify();
  }

  setMicAnalysisView(patch: Partial<MicAnalysisView>): void {
    this.micAnalysis = { ...this.micAnalysis, ...patch };
    if (patch.heatmap === true) {
      this.displayAnalysis = { ...this.displayAnalysis, heatmap: false };
      this.audioAnalysis = { ...this.audioAnalysis, heatmap: false };
      this.cameraAnalysis = { ...this.cameraAnalysis, heatmap: false };
    }
    this.notify();
  }

  disableMicAnalysis(): void {
    this.micAnalysis = { ...this.micAnalysis, enabled: false };
    this.notify();
  }

  enableAudioAnalysis(): void {
    this.audioAnalysis = { ...this.audioAnalysis, enabled: true, seatStatus: true, coverageRegions: true };
    this.notify();
  }

  setAudioAnalysisView(patch: Partial<AudioAnalysisView>): void {
    this.audioAnalysis = { ...this.audioAnalysis, ...patch };
    if (patch.heatmap === true) {
      this.displayAnalysis = { ...this.displayAnalysis, heatmap: false };
      this.micAnalysis = { ...this.micAnalysis, heatmap: false };
      this.cameraAnalysis = { ...this.cameraAnalysis, heatmap: false };
    }
    this.notify();
  }

  disableAudioAnalysis(): void {
    this.audioAnalysis = { ...this.audioAnalysis, enabled: false };
    this.notify();
  }

  enableCameraAnalysis(): void {
    this.cameraAnalysis = {
      ...this.cameraAnalysis,
      enabled: true,
      seatStatus: true,
      fovRegions: true,
      blockedSightlines: true
    };
    this.notify();
  }

  setCameraAnalysisView(patch: Partial<CameraAnalysisView>): void {
    this.cameraAnalysis = { ...this.cameraAnalysis, ...patch };
    if (patch.heatmap === true) {
      this.displayAnalysis = { ...this.displayAnalysis, heatmap: false };
      this.micAnalysis = { ...this.micAnalysis, heatmap: false };
      this.audioAnalysis = { ...this.audioAnalysis, heatmap: false };
    }
    this.notify();
  }

  disableCameraAnalysis(): void {
    this.cameraAnalysis = { ...this.cameraAnalysis, enabled: false };
    this.notify();
  }

  analyzeEquipment(instanceId: string): void {
    const product = catalog.get(this.equipment.find((e) => e.instanceId === instanceId)?.productId ?? '');
    const cat = product?.category;
    this.setWorkspaceMode('simulate');
    this.select('equipment', instanceId);
    if (cat === 'display') {
      this.displayAnalysis = {
        ...this.displayAnalysis,
        enabled: true,
        seatStatus: true,
        heatmap: true,
        contours: true,
        sightlines: 'all'
      };
      this.micAnalysis = { ...this.micAnalysis, heatmap: false };
      this.audioAnalysis = { ...this.audioAnalysis, heatmap: false };
      this.cameraAnalysis = { ...this.cameraAnalysis, heatmap: false };
    } else if (cat === 'camera') {
      this.cameraAnalysis = {
        ...this.cameraAnalysis,
        enabled: true,
        seatStatus: true,
        fovRegions: true,
        blockedSightlines: true,
        heatmap: true,
        contours: true
      };
      this.displayAnalysis = { ...this.displayAnalysis, heatmap: false };
      this.micAnalysis = { ...this.micAnalysis, heatmap: false };
      this.audioAnalysis = { ...this.audioAnalysis, heatmap: false };
    } else if (cat === 'speaker') {
      this.audioAnalysis = {
        ...this.audioAnalysis,
        enabled: true,
        seatStatus: true,
        coverageRegions: true,
        heatmap: true,
        contours: true
      };
      this.displayAnalysis = { ...this.displayAnalysis, heatmap: false };
      this.micAnalysis = { ...this.micAnalysis, heatmap: false };
      this.cameraAnalysis = { ...this.cameraAnalysis, heatmap: false };
    } else if (cat === 'microphone') {
      this.micAnalysis = {
        ...this.micAnalysis,
        enabled: true,
        seatStatus: true,
        pickupRegions: true,
        heatmap: true,
        contours: true
      };
      this.displayAnalysis = { ...this.displayAnalysis, heatmap: false };
      this.audioAnalysis = { ...this.audioAnalysis, heatmap: false };
      this.cameraAnalysis = { ...this.cameraAnalysis, heatmap: false };
    }
    this.requestFocus();
    this.notify();
  }

  setWorkspaceMode(mode: 'design' | 'system' | 'simulate' | 'validate' | 'docs'): void {
    this.workspaceMode = mode;
    this.shellNav = shellNavForWorkspace(mode, this.designTool);
    if (mode === 'simulate') this.step = 'simulation';
    if (mode === 'validate') this.step = 'analysis';
    if (mode === 'system') this.step = 'equipment';
    if (mode === 'design') {
      this.selectedFindingId = null;
      this.highlightedSeatIds = [];
      this.highlightedTableIds = [];
      if (this.designTool === 'room') this.step = 'room';
      if (this.designTool === 'seating') this.step = 'seating';
      if (this.designTool === 'catalog') this.step = 'equipment';
    }
    this.notify();
  }

  setShellNav(tab: ShellNav): void {
    this.shellNav = tab;
    if (tab === 'project') {
      this.workspaceMode = 'design';
      this.designTool = 'room';
      this.step = 'project';
    } else if (tab === 'design') {
      this.workspaceMode = 'design';
      if (this.designTool === 'room') this.designTool = 'catalog';
      this.step = 'equipment';
    } else if (tab === 'system') {
      this.workspaceMode = 'system';
      this.step = 'equipment';
    } else if (tab === 'simulate') {
      this.workspaceMode = 'simulate';
      this.step = 'simulation';
    } else if (tab === 'docs') {
      this.workspaceMode = 'docs';
      this.step = 'analysis';
    } else {
      this.workspaceMode = 'validate';
      this.step = 'analysis';
    }
    this.notify();
  }

  setUiComplexity(mode: UiComplexity): void {
    this.uiComplexity = mode;
    this.notify();
  }

  patchSetupDraft(patch: Partial<SetupDraft>): void {
    this.setupDraft = { ...this.setupDraft, ...patch };
    this.notify();
  }

  openNewProject(): void {
    this.setupOpen = true;
    this.notify();
  }

  closeSetup(): void {
    this.setupOpen = false;
    this.notify();
  }

  beginFromSetup(path: 'auto' | 'manual'): void {
    const d = this.setupDraft;
    this.autoDesignDraft = requirementsFromSetup({
      projectType: d.projectType,
      capacity: d.capacity,
      widthM: d.widthM,
      lengthM: d.lengthM,
      heightM: d.heightM,
      useCase: d.useCase
    });
    this.project = {
      ...this.project,
      roomUseCase:
        d.projectType === 'classroom'
          ? 'classroom'
          : d.projectType === 'training'
            ? 'training'
            : d.projectType === 'boardroom'
              ? 'boardroom'
              : 'conference',
      accessibility: d.accessibility
    };
    this.setupOpen = false;
    this.setRoom(roomFromSetup(d));
    if (path === 'auto') {
      this.shellNav = 'design';
      this.workspaceMode = 'design';
      this.requestAutoDesign();
      return;
    }
    this.shellNav = 'project';
    this.workspaceMode = 'design';
    this.designTool = 'room';
    this.notify();
  }

  inspectFinding(
    id: string,
    affectedSeatIds: string[],
    affectedTableIds: string[] = [],
    affectedEquipmentIds: string[] = [],
    code?: string
  ): void {
    this.selectedFindingId = id;
    this.highlightedSeatIds = affectedSeatIds;
    this.highlightedTableIds = affectedTableIds;
    this.workspaceMode = 'validate';
    const layer = overlayLayerForFinding(code ?? id);
    if (layer !== 'system') this.viewMode = '3d';
    if (layer === 'microphone') {
      this.micAnalysis = {
        ...this.micAnalysis,
        enabled: true,
        seatStatus: true,
        pickupRegions: true
      };
      this.displayAnalysis = { ...this.displayAnalysis, sightlines: 'off', heatmap: false };
      this.audioAnalysis = { ...this.audioAnalysis, heatmap: false };
      this.cameraAnalysis = { ...this.cameraAnalysis, heatmap: false };
      if (affectedEquipmentIds[0]) this.selection = { kind: 'equipment', id: affectedEquipmentIds[0] };
      else if (affectedSeatIds.length === 1) this.selection = { kind: 'seat', id: affectedSeatIds[0] };
      else if (affectedTableIds[0]) this.selection = { kind: 'table', id: affectedTableIds[0] };
    } else if (layer === 'audio') {
      this.audioAnalysis = {
        ...this.audioAnalysis,
        enabled: true,
        seatStatus: true,
        coverageRegions: true,
        heatmap: true,
        detailsOpen: true
      };
      this.displayAnalysis = { ...this.displayAnalysis, sightlines: 'off', heatmap: false };
      this.micAnalysis = { ...this.micAnalysis, heatmap: false };
      this.cameraAnalysis = { ...this.cameraAnalysis, heatmap: false };
      if (affectedEquipmentIds[0]) this.selection = { kind: 'equipment', id: affectedEquipmentIds[0] };
      else if (affectedSeatIds.length === 1) this.selection = { kind: 'seat', id: affectedSeatIds[0] };
      else if (affectedTableIds[0]) this.selection = { kind: 'table', id: affectedTableIds[0] };
    } else if (layer === 'camera') {
      this.cameraAnalysis = {
        ...this.cameraAnalysis,
        enabled: true,
        seatStatus: true,
        fovRegions: true,
        blockedSightlines: true,
        heatmap: true,
        detailsOpen: true
      };
      this.displayAnalysis = { ...this.displayAnalysis, sightlines: 'off', heatmap: false };
      this.micAnalysis = { ...this.micAnalysis, heatmap: false };
      this.audioAnalysis = { ...this.audioAnalysis, heatmap: false };
      if (affectedEquipmentIds[0]) this.selection = { kind: 'equipment', id: affectedEquipmentIds[0] };
      else if (affectedSeatIds.length === 1) this.selection = { kind: 'seat', id: affectedSeatIds[0] };
      else if (affectedTableIds[0]) this.selection = { kind: 'table', id: affectedTableIds[0] };
    } else if (layer === 'system') {
      this.workspaceMode = 'system';
      this.displayAnalysis = { ...this.displayAnalysis, heatmap: false };
      this.micAnalysis = { ...this.micAnalysis, heatmap: false };
      this.audioAnalysis = { ...this.audioAnalysis, heatmap: false };
      this.cameraAnalysis = { ...this.cameraAnalysis, heatmap: false };
      if ((code ?? id).startsWith('CABLE') || (code ?? id).startsWith('CONN-008')) {
        this.systemPhysicalView = true;
        this.showCableRoutes = true;
        this.viewMode = '3d';
      }
      if (affectedEquipmentIds[0]) this.selection = { kind: 'equipment', id: affectedEquipmentIds[0] };
      this.highlightedConnectionIds = this.connections
        .filter((c) => affectedEquipmentIds.includes(c.fromInstanceId) || affectedEquipmentIds.includes(c.toInstanceId))
        .map((c) => c.id);
      this.selectedConnectionId = this.highlightedConnectionIds[0] ?? null;
    } else if (layer === 'display') {
      this.displayAnalysis = {
        ...this.displayAnalysis,
        enabled: true,
        seatStatus: true,
        sightlines: affectedSeatIds.length ? 'selected' : this.displayAnalysis.sightlines
      };
      if (affectedEquipmentIds[0]) this.selection = { kind: 'equipment', id: affectedEquipmentIds[0] };
      else if (affectedSeatIds.length === 1) this.selection = { kind: 'seat', id: affectedSeatIds[0] };
      else if (affectedTableIds[0]) this.selection = { kind: 'table', id: affectedTableIds[0] };
    } else {
      this.displayAnalysis = { ...this.displayAnalysis, heatmap: false };
      this.micAnalysis = { ...this.micAnalysis, heatmap: false };
      this.audioAnalysis = { ...this.audioAnalysis, heatmap: false };
      this.cameraAnalysis = { ...this.cameraAnalysis, heatmap: false };
      if (affectedEquipmentIds[0]) this.selection = { kind: 'equipment', id: affectedEquipmentIds[0] };
      else if (affectedSeatIds.length === 1) this.selection = { kind: 'seat', id: affectedSeatIds[0] };
      else if (affectedTableIds[0]) this.selection = { kind: 'table', id: affectedTableIds[0] };
    }
    this.findingFocusRequest += 1;
    this.notify();
  }

  setDetailsFinding(id: string | null): void {
    this.detailsFindingId = id;
    this.notify();
  }

  setValidationDeltaMessage(message: string): void {
    this.validationDeltaMessage = message;
    this.notify();
  }

  enterViewerMode(seatId: string): void {
    this.viewerMode = { active: true, seatId };
    this.viewMode = '3d';
    this.select('seat', seatId);
    this.notify();
  }

  exitViewerMode(): void {
    this.viewerMode = { active: false, seatId: null };
    this.notify();
  }

  stepViewerSeat(direction: 1 | -1): void {
    if (!this.viewerMode.seatId || this.seats.length === 0) return;
    const idx = this.seats.findIndex((s) => s.id === this.viewerMode.seatId);
    if (idx === -1) return;
    const next = this.seats[(idx + direction + this.seats.length) % this.seats.length];
    this.viewerMode = { active: true, seatId: next.id };
    this.selection = { kind: 'seat', id: next.id };
    this.notify();
  }

  focusRequest = 0;
  requestFocus(): void {
    this.focusRequest += 1;
    this.notify();
  }

  addConnection(fromInstanceId: string, fromPortId: string, toInstanceId: string, toPortId: string): boolean {
    const fromEq = this.equipment.find((e) => e.instanceId === fromInstanceId);
    const toEq = this.equipment.find((e) => e.instanceId === toInstanceId);
    if (!fromEq || !toEq) {
      this.lastSystemError = 'Both devices must exist in the project.';
      this.notify();
      return false;
    }
    const from = resolveInstancePorts(fromEq.instanceId, fromEq.productId, catalog).find((p) => p.id === fromPortId);
    const to = resolveInstancePorts(toEq.instanceId, toEq.productId, catalog).find((p) => p.id === toPortId);
    if (!from || !to) {
      this.lastSystemError = 'DATA INCOMPLETE — one or both ports are missing from the catalog.';
      this.notify();
      return false;
    }
    const compat = canConnectPorts(from, to);
    if (!compat.ok) {
      this.lastSystemError = compat.reason;
      this.notify();
      return false;
    }
    if (duplicateConnection(this.connections, fromInstanceId, fromPortId, toInstanceId, toPortId)) {
      this.lastSystemError = 'That connection already exists.';
      this.notify();
      return false;
    }
    const busy = occupancyConflict(this.connections, fromInstanceId, fromPortId, toInstanceId, toPortId, {
      fromMax: maxConnectionsFor(from),
      toMax: maxConnectionsFor(to)
    });
    if (busy) {
      this.lastSystemError = busy;
      this.notify();
      return false;
    }
    this.recordAndReset();
    this.connections = [
      ...this.connections,
      {
        id: `cx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        fromInstanceId,
        fromPortId,
        toInstanceId,
        toPortId,
        signalType: compat.signalType,
        transport: compat.transport,
        physicalMedium: compat.physicalMedium,
        cableType: compat.physicalMedium
      }
    ];
    this.lastSystemError = '';
    this.systemConnectFrom = null;
    invalidateCableRoutes([this.connections[this.connections.length - 1]!.id]);
    this.notify();
    return true;
  }

  updateConnectionCableType(id: string, cableType: PhysicalMedium): boolean {
    const c = this.connections.find((x) => x.id === id);
    if (!c) return false;
    const fromEq = this.equipment.find((e) => e.instanceId === c.fromInstanceId);
    const toEq = this.equipment.find((e) => e.instanceId === c.toInstanceId);
    if (!fromEq || !toEq) return false;
    const from = resolveInstancePorts(fromEq.instanceId, fromEq.productId, catalog).find((p) => p.id === c.fromPortId);
    const to = resolveInstancePorts(toEq.instanceId, toEq.productId, catalog).find((p) => p.id === c.toPortId);
    if (!from || !to) return false;
    const r = canConnectWithCable(from, to, cableType);
    if (!r.ok) {
      this.lastSystemError = r.reason;
      this.notify();
      return false;
    }
    this.recordAndReset();
    this.connections = this.connections.map((x) => (x.id === id ? { ...x, cableType } : x));
    this.lastSystemError = '';
    this.notify();
    return true;
  }

  removeConnection(id: string): void {
    this.recordAndReset();
    this.connections = this.connections.filter((c) => c.id !== id);
    invalidateCableRoutes([id]);
    if (this.selectedConnectionId === id) this.selectedConnectionId = null;
    this.notify();
  }

  connectCompatiblePair(fromInstanceId: string, toInstanceId: string): boolean {
    const fromEq = this.equipment.find((e) => e.instanceId === fromInstanceId);
    const toEq = this.equipment.find((e) => e.instanceId === toInstanceId);
    if (!fromEq || !toEq) return false;
    const fromPorts = resolveInstancePorts(fromEq.instanceId, fromEq.productId, catalog);
    const toPorts = resolveInstancePorts(toEq.instanceId, toEq.productId, catalog);
    for (const a of fromPorts) {
      for (const b of toPorts) {
        const r = canConnectPorts(a, b);
        if (!r.ok) continue;
        if (occupancyConflict(this.connections, a.instanceId, a.id, b.instanceId, b.id)) continue;
        return this.addConnection(a.instanceId, a.id, b.instanceId, b.id);
      }
    }
    this.lastSystemError = 'No compatible free ports between the selected devices.';
    this.notify();
    return false;
  }

  setSystemNodePos(id: string, x: number, y: number): void {
    this.recordAndReset();
    this.systemLayout = { ...this.systemLayout, [id]: { x, y } };
    this.notify();
  }

  applySystemAlign(command: AlignCommand): void {
    const ids = this.selectedEquipmentIds();
    if (ids.length < 2) return;
    const items = ids.map((id) => ({
      id,
      x: this.systemLayout[id]?.x ?? 0,
      z: this.systemLayout[id]?.y ?? 0
    }));
    const next = applyAlignCommand(items, command);
    this.recordAndReset();
    const layout = { ...this.systemLayout };
    next.forEach((n) => {
      layout[n.id] = { x: n.x, y: n.z };
    });
    this.systemLayout = layout;
    this.notify();
  }

  setSystemView(pan: { x: number; y: number }, zoom: number): void {
    this.systemPan = pan;
    this.systemZoom = zoom;
    this.notify();
  }

  setSystemDetailMode(mode: 'beginner' | 'pro'): void {
    this.systemDetailMode = mode;
    this.notify();
  }

  setSystemCanvasMode(mode: 'edit' | 'schematic'): void {
    this.systemCanvasMode = mode;
    this.notify();
  }

  setSystemFilter(filter: 'all' | SignalType): void {
    this.systemFilter = filter;
    this.notify();
  }

  setSystemSearch(q: string): void {
    this.systemSearch = q;
    this.notify();
  }

  selectConnection(id: string | null): void {
    this.selectedConnectionId = id;
    this.selectedPathId = null;
    if (id) {
      this.selection = { kind: 'none', id: null };
      this.additionalSelectedIds = [];
    }
    this.notify();
  }

  setSystemPhysicalView(on: boolean): void {
    this.systemPhysicalView = on;
    if (on) this.viewMode = '3d';
    this.notify();
  }

  setShowCableRoutes(on: boolean): void {
    this.showCableRoutes = on;
    this.notify();
  }

  setCableLengthLimit(medium: PhysicalMedium, meters: number | null): void {
    const next = { ...this.cableLengthLimitsM };
    if (meters == null) delete next[medium];
    else next[medium] = meters;
    this.cableLengthLimitsM = next;
    this.notify();
  }

  showConnectionRoute(id: string): void {
    this.selectedConnectionId = id;
    this.showCableRoutes = true;
    this.systemPhysicalView = true;
    this.viewMode = '3d';
    this.workspaceMode = 'system';
    this.shellNav = 'system';
    this.notify();
  }

  focusConnectionEndpoint(end: 'source' | 'destination'): void {
    const c = this.connections.find((x) => x.id === this.selectedConnectionId);
    if (!c) return;
    const id = end === 'source' ? c.fromInstanceId : c.toInstanceId;
    this.selectedConnectionId = null;
    this.selection = { kind: 'equipment', id };
    this.viewMode = '3d';
    this.systemPhysicalView = true;
    this.requestFocus();
    this.notify();
  }

  setSystemConnectFrom(port: { instanceId: string; portId: string } | null): void {
    this.systemConnectFrom = port;
    this.lastSystemError = '';
    this.notify();
  }

  setRoute(instanceId: string, inputPortId: string, outputPortId: string): void {
    const inst = this.equipment.find((e) => e.instanceId === instanceId);
    const product = inst ? catalog.get(inst.productId) : undefined;
    if (!isRoutableProduct(product)) {
      this.lastSystemError = 'This device has no catalog switching/routing capability.';
      this.notify();
      return;
    }
    this.recordAndReset();
    this.routes = [
      ...this.routes.filter((r) => !(r.instanceId === instanceId && r.outputPortId === outputPortId)),
      { instanceId, inputPortId, outputPortId }
    ];
    this.notify();
  }

  clearRoute(instanceId: string, outputPortId: string): void {
    this.recordAndReset();
    this.routes = this.routes.filter((r) => !(r.instanceId === instanceId && r.outputPortId === outputPortId));
    this.notify();
  }

  groupSelected(name = 'System group'): void {
    const ids = this.selectedEquipmentIds();
    if (ids.length < 2) return;
    this.recordAndReset();
    this.systemGroups = [
      ...this.systemGroups,
      { id: `grp-${Date.now()}`, name, memberIds: ids, collapsed: false }
    ];
    this.notify();
  }

  toggleGroupCollapsed(id: string): void {
    this.systemGroups = this.systemGroups.map((g) => (g.id === id ? { ...g, collapsed: !g.collapsed } : g));
    this.notify();
  }

  viewInRoom(): void {
    this.workspaceMode = 'design';
    this.viewMode = '3d';
    this.notify();
  }

  autoLayoutSystem(): void {
    this.recordAndReset();
    this.systemLayout = computeAutoLayout(this.equipment, catalog);
    this.notify();
  }

  ensureSystemLayout(): void {
    const missing = this.equipment.some((e) => !this.systemLayout[e.instanceId]);
    if (!missing) return;
    const computed = computeAutoLayout(this.equipment, catalog);
    this.systemLayout = { ...computed, ...this.systemLayout };
    this.notify();
  }

  /** Clear undo/redo stacks — used after loading a project file. */
  clearHistory(): void {
    this.history.clear();
    this.historyPrepared = false;
  }

  openAutoDesign(): void {
    this.autoDesignOpen = true;
    this.autoDesignWhyOpen = false;
    this.autoDesignRegenChoice = false;
    this.workspaceMode = 'design';
    this.step = 'autodesign';
    if (this.room) {
      this.autoDesignDraft = {
        ...this.autoDesignDraft,
        room: {
          length: this.room.depth,
          width: this.room.width,
          height: this.room.height
        }
      };
    }
    if (this.seats.length) {
      this.autoDesignDraft = {
        ...this.autoDesignDraft,
        seating: { ...this.autoDesignDraft.seating, count: this.seats.length }
      };
    }
    this.notify();
  }

  closeAutoDesign(): void {
    this.autoDesignOpen = false;
    this.autoDesignRegenChoice = false;
    this.notify();
  }

  setAutoDesignMode(mode: AutoDesignMode): void {
    this.autoDesignMode = mode;
    this.autoDesignDraft = { ...this.autoDesignDraft, mode };
    this.notify();
  }

  setAutoDesignDraft(patch: Partial<DesignRequirements> | DesignRequirements): void {
    this.autoDesignDraft = { ...this.autoDesignDraft, ...patch } as DesignRequirements;
    this.notify();
  }

  setAutoDesignLearn(on: boolean): void {
    this.autoDesignLearn = on;
    this.notify();
  }

  setAutoDesignWhyOpen(on: boolean): void {
    this.autoDesignWhyOpen = on;
    this.notify();
  }

  dismissRecommendation(id: string): void {
    if (this.dismissedRecommendationIds.includes(id)) return;
    this.dismissedRecommendationIds = [...this.dismissedRecommendationIds, id];
    this.notify();
  }

  toggleAssistantDrawer(): void {
    this.assistantDrawerOpen = !this.assistantDrawerOpen;
    this.assistantCollapsed = !this.assistantDrawerOpen;
    this.notify();
  }

  toggleAssistantCollapsed(): void {
    this.assistantDrawerOpen = !this.assistantDrawerOpen;
    this.assistantCollapsed = !this.assistantDrawerOpen;
    this.notify();
  }

  generateAutoDesignProposal(): void {
    const proposal = generateDesign(
      {
        room: this.room,
        seats: this.seats,
        tables: this.tables,
        equipment: this.equipment,
        connections: this.connections,
        routes: this.routes
      },
      this.autoDesignDraft,
      catalog
    );
    this.autoDesignProposal = proposal;
    this.autoDesignOpen = true;
    this.notify();
  }

  selectAutoDesignOption(id: DesignOption['id']): void {
    if (!this.autoDesignProposal) return;
    this.autoDesignProposal = { ...this.autoDesignProposal, selectedOptionId: id };
    this.notify();
  }

  applyAutoDesignProposal(): boolean {
    const option = this.autoDesignProposal ? selectedOption(this.autoDesignProposal) : null;
    if (!option || this.autoDesignProposal?.status !== 'ok') return false;
    this.finishGesture();
    this.recordAndReset();
    this.room = option.room;
    this.seats = option.seats;
    this.tables = option.tables;
    this.racks = option.racks ? option.racks.map((r) => ({ ...r })) : [];
    this.equipment = option.equipment.map((e) => ({ ...e }));
    this.connections = option.connections.map((c) => ({ ...c }));
    this.routes = option.routes.map((r) => ({ ...r }));
    this.systemLayout = computeAutoLayout(this.equipment, catalog);
    this.lastAutoInstanceIds = this.equipment.filter((e) => e.origin === 'auto').map((e) => e.instanceId);
    this.autoDesignOpen = false;
    this.autoDesignWhyOpen = false;
    this.notify();
    return true;
  }

  detectAutoDesignManualWork(): boolean {
    return hasManualChanges(
      {
        room: this.room,
        seats: this.seats,
        tables: this.tables,
        equipment: this.equipment,
        connections: this.connections,
        routes: this.routes
      },
      this.lastAutoInstanceIds
    );
  }

  requestAutoDesign(): void {
    this.setupOpen = false;
    if (this.detectAutoDesignManualWork() && this.lastAutoInstanceIds.length) {
      this.autoDesignRegenChoice = true;
      this.autoDesignOpen = true;
      this.notify();
      return;
    }
    this.openAutoDesign();
  }
}
