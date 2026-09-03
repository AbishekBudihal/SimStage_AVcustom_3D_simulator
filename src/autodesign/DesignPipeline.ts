/**
 * Auto Design orchestrator. Uses existing seating, placement, viewing,
 * mic/speaker/camera, and validation engines. Does not reimplement them.
 */

import type { EquipmentCatalog, EquipmentInstance, EquipmentProduct } from '../catalog/EquipmentCatalog';
import { createDefaultRoom, type RoomModel } from '../room/RoomModel';
import { defaultSeatingConfig, generateSeating, type Seat, type TableSpec } from '../room/SeatingGenerator';
import { type DesignRequirements } from './DesignRequirements';
import { resolveSeatingLayout } from '../room/SeatingStrategy';
import { tableAabb, chairAabb } from '../room/FurnitureGeometry';
import { placeAvRack } from '../av/RackPlacement';
import { evaluateRackRequirement } from '../av/RackRequirement';
import { splitDivisibleZones } from '../room/RoomZones';
import { snapCeilingMounted, displayOverlapsOpening } from '../interaction/SnapEngine';
import { getPresentationWall, wallMountPoint, computeWallCandidates, presentationRotation, type WallKey } from '../room/RoomGeometry';
import { selectPresentationWall } from '../av/placement/PlacementCandidateEngine';
import {
  suggestDisplayPlacement,
  suggestMicDesign,
  suggestSpeakerDesign,
  centerDisplayOnWall
} from '../av/PlacementSuggestionEngine';
import { analyzeAllSeatsAgainstDisplay, projectObstacles, DEFAULT_CONTENT_TYPE } from '../av/DesignAnalysis';
import { evaluateViewingDistance } from '../av/ViewingDistanceEngine';
import { evaluateRoomCameraCoverage } from '../av/CameraCoverageEngine';
import { runDesignValidation } from '../av/validation/DesignValidationEngine';
import type { SystemConnection, SystemRoute } from '../system/SystemTypes';
import { validateDesignRequirements } from './validateRequirements';
import {
  cameraCompleteness,
  filterCameras,
  filterDisplays,
  filterMics,
  filterSpeakers,
  speakerCompleteness
} from './CatalogCandidates';
import { buildSystemTopology } from './SystemTopologyPlan';
import { auditGeneratedLayout, clampInsideRoom } from './SpatialAudit';
import type { DesignOption, DesignProposal, ProductPick, ProjectDesignContext, SubsystemNote } from './DesignProposal';

function nextIdFactory(): (prefix: string) => string {
  let n = 0;
  return (prefix: string) => {
    n += 1;
    return `ad-${prefix}-${n}`;
  };
}

function clampOpenings(room: RoomModel): RoomModel {
  const openings = room.openings.map((o) => {
    const len = o.wall === 'front' || o.wall === 'back' ? room.width : room.depth;
    if (o.offset + o.width <= len) return o;
    return { ...o, offset: Number(Math.max(0, len - o.width - 0.25).toFixed(2)) };
  });
  return { ...room, openings };
}

export function inventory(ctx: ProjectDesignContext, catalog: EquipmentCatalog) {
  const cat = (c: string) => ctx.equipment.filter((e) => catalog.get(e.productId)?.category === c);
  return {
    room: !!ctx.room,
    seating: ctx.seats.length > 0,
    display: cat('display').length > 0,
    audio: cat('speaker').length > 0,
    microphones: cat('microphone').length > 0,
    camera: cat('camera').length > 0,
    routing: ctx.connections.length > 0 || cat('switcher').length > 0 || cat('source').length > 0
  };
}

function resolveRoom(ctx: ProjectDesignContext, req: DesignRequirements): RoomModel {
  if (ctx.room && req.completeMissingOnly) return ctx.room;
  const base = ctx.room ? { ...ctx.room } : createDefaultRoom(req.useCase);
  base.width = req.room.width!;
  base.depth = req.room.length!;
  base.height = req.room.height!;
  base.useCase = req.useCase;
  if (req.constraints.presentationWall) base.presentationWall = req.constraints.presentationWall;
  else delete base.presentationWall;
  if (req.room.divisible) {
    base.divisible = true;
    base.zones = splitDivisibleZones(base);
  }
  const clamped = clampOpenings(base);
  if (!req.constraints.presentationWall) {
    clamped.presentationWall = selectPresentationWall(clamped);
  }
  return clamped;
}

function resolveSeating(
  ctx: ProjectDesignContext,
  req: DesignRequirements,
  room: RoomModel
): {
  seats: Seat[];
  tables: TableSpec[];
  warnings: string[];
  reused: boolean;
  valid: boolean;
  layoutReason: string;
  layout: ReturnType<typeof resolveSeatingLayout>;
} {
  if (req.constraints.keepExistingSeating && ctx.seats.length) {
    return {
      seats: ctx.seats,
      tables: ctx.tables,
      warnings: [],
      reused: true,
      valid: true,
      layoutReason: 'Existing seating and TableSpec preserved.',
      layout: req.seating.layout === 'auto' ? 'boardroom' : req.seating.layout
    };
  }
  const layout = resolveSeatingLayout(room, req.seating.count!, req.seating.layout, req.useCase);
  const cfg = defaultSeatingConfig(req.seating.count!, layout);
  const gen = generateSeating(room, cfg);
  return { ...gen, reused: false, layout };
}

function desiredDisplayCount(req: DesignRequirements, dualFits: boolean): number {
  if (req.presentation.displayCount === 'single') return 1;
  if (req.presentation.displayCount === 'dual') return dualFits ? 2 : 1;
  if ((req.useCase === 'presentation' || req.useCase === 'hybrid') && dualFits) return 2;
  return 1;
}

function dualFitsWall(room: RoomModel, product: EquipmentProduct, wall: WallKey): boolean {
  const need = (product.physical.width + 0.3) * 2;
  const c = computeWallCandidates(room, product.physical.width + 0.3, 0).find((x) => x.wall === wall);
  return !!c && c.usableWidthM >= need && c.valid;
}

function placeDisplays(
  room: RoomModel,
  product: EquipmentProduct,
  count: number,
  forbidden: WallKey | undefined,
  id: (p: string) => string,
  seats: Seat[] = [],
  tables: TableSpec[] = []
): { instances: EquipmentInstance[]; note: string } {
  let suggestion = suggestDisplayPlacement(room, product, { seats, tables });
  if (forbidden && suggestion.wall === forbidden) {
    const alt = suggestion.candidates.find((c) => c.wall !== forbidden && c.valid);
    if (alt) {
      const pos = centerDisplayOnWall(room, product, alt.wall);
      suggestion = { ...suggestion, wall: alt.wall, position: pos };
    }
  }
  const wall = suggestion.wall;
  if (count === 1) {
    const pos = centerDisplayOnWall(room, product, wall);
    return {
      instances: [
        {
          instanceId: id('disp'),
          productId: product.id,
          name: `${product.manufacturer} ${product.model}`,
          position: { x: pos.x, y: pos.y, z: pos.z },
          rotationY: pos.rotationY,
          wall,
          placementMode: 'smart',
          origin: 'auto'
        }
      ],
      note: suggestion.rationale
    };
  }
  const widthM = product.physical.width + 0.3;
  const cand = computeWallCandidates(room, widthM, 0).find((c) => c.wall === wall)!;
  const inset = room.wallThickness + 0.03;
  const a = cand.bestSpanStartM + cand.usableWidthM * 0.28;
  const b = cand.bestSpanStartM + cand.usableWidthM * 0.72;
  const p1 = wallMountPoint(room, wall, a, inset);
  const p2 = wallMountPoint(room, wall, b, inset);
  const overlap =
    displayOverlapsOpening(room, wall, a, product.physical.width) ||
    displayOverlapsOpening(room, wall, b, product.physical.width);
  if (overlap) {
    const pos = centerDisplayOnWall(room, product, wall);
    return {
      instances: [
        {
          instanceId: id('disp'),
          productId: product.id,
          name: `${product.manufacturer} ${product.model}`,
          position: { x: pos.x, y: pos.y, z: pos.z },
          rotationY: pos.rotationY,
          wall,
          placementMode: 'smart',
          origin: 'auto'
        }
      ],
      note: 'Dual placement would enter a door/window exclusion zone, so a single display was centered in the clear span.'
    };
  }
  const y = suggestion.position.y;
  const rot = presentationRotation(wall);
  return {
    instances: [
      {
        instanceId: id('disp'),
        productId: product.id,
        name: `${product.manufacturer} ${product.model}`,
        position: { x: Number(p1.x.toFixed(2)), y, z: Number(p1.z.toFixed(2)) },
        rotationY: rot,
        wall,
        placementMode: 'smart',
        origin: 'auto'
      },
      {
        instanceId: id('disp'),
        productId: product.id,
        name: `${product.manufacturer} ${product.model}`,
        position: { x: Number(p2.x.toFixed(2)), y, z: Number(p2.z.toFixed(2)) },
        rotationY: rot,
        wall,
        placementMode: 'smart',
        origin: 'auto'
      }
    ],
    note: `Two displays placed in the ${wall} wall clear span using existing wall-candidate geometry (not a second viewing engine).`
  };
}

function evaluateDisplayProduct(
  product: EquipmentProduct,
  room: RoomModel,
  seats: Seat[],
  tables: TableSpec[],
  count: number,
  forbidden: WallKey | undefined,
  id: (p: string) => string
): { pick: ProductPick; instances: EquipmentInstance[]; pass: number; fail: number; warn: number } {
  const placed = placeDisplays(room, product, count, forbidden, id, seats, tables);
  const obstacles = projectObstacles(room, tables);
  const inst = placed.instances[0];
  const analyses = analyzeAllSeatsAgainstDisplay(
    seats,
    {
      diagonalInches: product.display!.diagonalInches,
      aspectRatio: product.display!.aspectRatio,
      widthM: product.physical.width,
      heightM: product.physical.height,
      position: inst.position,
      wall: inst.wall ?? 'front',
      rotationY: inst.rotationY
    },
    obstacles
  );
  const pass = analyses.filter((a) => a.overall === 'pass').length;
  const fail = analyses.filter((a) => a.overall === 'fail').length;
  const warn = analyses.filter((a) => a.overall === 'warning').length;
  const farthest = analyses.reduce((m, a) => Math.max(m, a.distance.value), 0);
  const vd = analyses[0]
    ? evaluateViewingDistance(
        {
          diagonalInches: product.display!.diagonalInches,
          aspectRatio: product.display!.aspectRatio,
          widthM: product.physical.width,
          heightM: product.physical.height,
          position: inst.position,
          wall: inst.wall ?? 'front',
          rotationY: inst.rotationY
        },
        { seatId: seats[0]?.id ?? 's', x: seats[0]?.x ?? 0, z: seats[0]?.z ?? 0, eyeHeightM: 1.1 },
        DEFAULT_CONTENT_TYPE
      )
    : null;
  const status = fail ? 'fail' : warn ? 'warning' : 'pass';
  return {
    pass,
    fail,
    warn,
    instances: placed.instances,
    pick: {
      productId: product.id,
      name: `${product.display!.diagonalInches}" ${product.manufacturer} ${product.model}`,
      reason: placed.note,
      criterion: 'Viewing distance and angle from seating to the catalog screen size',
      actual: `${pass} pass / ${warn} warning / ${fail} fail of ${seats.length} seats; farthest ${farthest.toFixed(1)} m`,
      expected: vd?.threshold ? `${vd.threshold.min}–${vd.threshold.max} m band (configured criterion)` : 'Within configured viewing-distance band',
      status,
      source: 'Catalog display dimensions and the project viewing analysis',
      completeness: 'complete',
      completenessReason: 'Catalog width/height/diagonal present.',
      alternatives: []
    }
  };
}

function placeMics(
  product: EquipmentProduct,
  seats: Seat[],
  room: RoomModel,
  id: (p: string) => string
): { instances: EquipmentInstance[]; pick: ProductPick; covered: number } {
  const design = suggestMicDesign(seats, product);
  const y = product.microphone?.mount === 'ceiling' ? Math.max(2.2, room.height - 0.12) : 0.75;
  const instances: EquipmentInstance[] = design.placements.map((m) => {
    const xz = clampInsideRoom(room, m.x, m.z, 0.4);
    return {
      instanceId: id('mic'),
      productId: product.id,
      name: `${product.manufacturer} ${product.model}`,
      position: { x: xz.x, y, z: xz.z },
      rotationY: m.facingRad ?? 0,
      placementMode: 'smart' as const,
      origin: 'auto' as const
    };
  });
  const status = design.coveragePct >= 90 ? 'pass' : design.coveragePct >= 60 ? 'warning' : 'fail';
  return {
    covered: design.coveredSeats,
    instances,
    pick: {
      productId: product.id,
      name: `${design.quantity} × ${product.manufacturer} ${product.model}`,
      reason: `${design.quantity} calculated pickup region(s) cover ${design.coveredSeats}/${design.totalSeats} seats using catalog pickupRadiusM ${product.microphone!.pickupRadiusM} m.`,
      criterion: 'Seat inside the catalog pickup region',
      actual: `${design.coveragePct}% of seats inside calculated pickup`,
      expected: 'Seats inside calculated pickup',
      status,
      source: 'Catalog pickup radius and seating positions',
      completeness: 'complete',
      completenessReason: 'pickupRadiusM present' + (product.microphone?.beamWidthDeg ? '; beamWidthDeg present' : ''),
      alternatives: []
    }
  };
}

function placeSpeakers(
  product: EquipmentProduct,
  room: RoomModel,
  seats: Seat[],
  id: (p: string) => string
): { instances: EquipmentInstance[]; pick: ProductPick } {
  const design = suggestSpeakerDesign(room, seats, product);
  const instances: EquipmentInstance[] = design.speakers.map((s) => {
    const snapped = snapCeilingMounted(room, s.x, s.z);
    const xz = clampInsideRoom(room, snapped.position.x, snapped.position.z, 0.35);
    return {
      instanceId: id('spk'),
      productId: product.id,
      name: `${product.manufacturer} ${product.model}`,
      position: { x: xz.x, y: snapped.position.y, z: xz.z },
      rotationY: s.facingRad,
      placementMode: 'smart' as const,
      origin: 'auto' as const
    };
  });
  const c = speakerCompleteness(product);
  const status = design.coveragePct >= 80 ? 'pass' : design.coveragePct >= 50 ? 'warning' : 'fail';
  return {
    instances,
    pick: {
      productId: product.id,
      name: `${design.quantity} × ${product.manufacturer} ${product.model}`,
      reason: `${design.layout}: ${design.coveredSeats}/${design.totalSeats} seats in estimated coverage. ${design.method}`,
      criterion: 'Geometric dispersion and estimated SPL from catalog data',
      actual: `${design.coveragePct}% of seats in estimated coverage`,
      expected: 'Seats inside catalog dispersion with estimated SPL in band',
      status,
      source: 'Catalog maxSplAt1m, dispersion, and seating positions',
      completeness: c.status,
      completenessReason: c.reason,
      alternatives: []
    }
  };
}

function placeCamera(
  product: EquipmentProduct,
  room: RoomModel,
  seats: Seat[],
  tables: TableSpec[],
  id: (p: string) => string,
  displayWall?: WallKey
): { instances: EquipmentInstance[]; pick: ProductPick } {
  const y = 1.6;
  const wall = displayWall ?? getPresentationWall(room);
  const mounted = centerDisplayOnWall(room, product, wall);
  const inst: EquipmentInstance = {
    instanceId: id('cam'),
    productId: product.id,
    name: `${product.manufacturer} ${product.model}`,
    position: { x: mounted.x, y, z: mounted.z },
    rotationY: mounted.rotationY,
    wall,
    placementMode: 'smart',
    origin: 'auto'
  };
  const hfov = product.camera!.horizontalFovDeg!;
  const vfov = product.camera!.verticalFovDeg;
  const obstacles = projectObstacles(room, tables);
  const coverage = evaluateRoomCameraCoverage(
    seats.map((s) => ({ seatId: s.id, x: s.x, z: s.z, earHeightM: 1.1 })),
    [
      {
        id: inst.instanceId,
        x: inst.position.x,
        y: inst.position.y,
        z: inst.position.z,
        facingRad: inst.rotationY,
        horizontalFovDeg: hfov,
        verticalFovDeg: vfov
      }
    ],
    obstacles
  );
  const c = cameraCompleteness(product);
  const status = c.status !== 'complete' ? 'incomplete' : coverage.coveragePct >= 80 ? 'pass' : coverage.coveragePct >= 40 ? 'warning' : 'fail';
  const actual =
    c.status === 'complete'
      ? `${coverage.visibleSeats} of ${coverage.totalSeats} seats inside catalog FOV`
      : 'HFOV available. VFOV unavailable. Horizontal coverage can be evaluated; vertical coverage cannot.';
  return {
    instances: [inst],
    pick: {
      productId: product.id,
      name: `1 × ${product.manufacturer} ${product.model}`,
      reason:
        c.status === 'partial'
          ? 'DATA INCOMPLETE — catalog has horizontal FOV but not vertical FOV. Vertical coverage is not invented from 16:9.'
          : `Catalog horizontal FOV covers the seating area in the geometric FOV estimate (${coverage.visibleSeats}/${coverage.totalSeats} seats).`,
      criterion: 'Seat inside catalog field of view',
      actual,
      expected: 'Seats inside catalog horizontal FOV (vertical only if the catalog provides it)',
      status,
      source: 'Catalog FOV and presentation-wall placement',
      completeness: c.status,
      completenessReason: c.reason,
      alternatives: []
    }
  };
}

function keepExistingOf(
  ctx: ProjectDesignContext,
  catalog: EquipmentCatalog,
  category: string,
  keep: boolean
): EquipmentInstance[] {
  if (!keep) return [];
  return ctx.equipment.filter((e) => catalog.get(e.productId)?.category === category);
}

function attachAlts(picks: ProductPick[], chosen: ProductPick): ProductPick {
  const alternatives = picks
    .filter((p) => p.productId !== chosen.productId)
    .slice(0, 3)
    .map((p) => ({
      productId: p.productId,
      name: p.name,
      reason: `${p.status === 'pass' ? '✓' : '⚠'} ${p.actual}`
    }));
  return { ...chosen, alternatives };
}

function optionFromParts(
  id: DesignOption['id'],
  label: string,
  bullets: string[],
  room: RoomModel,
  seats: Seat[],
  tables: TableSpec[],
  equipment: EquipmentInstance[],
  catalog: EquipmentCatalog,
  picks: DesignOption['picks'],
  why: string[],
  topologyNotes: string[],
  connections: SystemConnection[],
  routes: SystemRoute[],
  racks: import('../av/AVRack').AVRack[] = []
): DesignOption {
  const report = runDesignValidation({ room, seats, tables, equipment, catalog, connections, routes, racks });
  return {
    id,
    label,
    bullets,
    room,
    seats,
    tables,
    racks,
    equipment,
    connections,
    routes,
    picks,
    validation: report.summary,
    why,
    topologyNotes
  };
}

export function generateDesign(
  ctx: ProjectDesignContext,
  req: DesignRequirements,
  catalog: EquipmentCatalog
): DesignProposal {
  const validated = validateDesignRequirements(req);
  const stages: SubsystemNote[] = [];
  if (!validated.ok) {
    return {
      status: 'invalid_requirements',
      blockingReason: validated.issues.map((i) => i.message).join(' '),
      requirementIssues: validated.issues,
      requirements: req,
      stages,
      options: [],
      selectedOptionId: 'balanced',
      existing: inventory(ctx, catalog),
      missing: [],
      assistant: [],
      spatialIssues: []
    };
  }
  const r = validated.normalized;
  const existing = inventory(ctx, catalog);
  const missing: string[] = [];
  if (!existing.display) missing.push('Display');
  if (!existing.audio) missing.push('Audio');
  if (!existing.microphones) missing.push('Microphones');
  if (!existing.camera) missing.push('Camera');
  if (!existing.routing) missing.push('Signal routing');

  const room = resolveRoom(ctx, r);
  stages.push({
    id: 'room',
    title: 'Understand room',
    status: 'done',
    detail: `${room.width.toFixed(1)} × ${room.depth.toFixed(1)} × ${room.height.toFixed(1)} m`
  });

  const seating = resolveSeating(ctx, r, room);
  const rackPlace = placeAvRack(room, [
    ...seating.tables.map((t) => tableAabb(t)),
    ...seating.seats.map((s) => chairAabb(s))
  ]);
  const defaultRack = rackPlace.rack;
  stages.push({
    id: 'rack',
    title: 'Evaluate AV rack requirement',
    status: rackPlace.ok ? 'done' : 'warning',
    detail: 'Requirement evaluated per option based on centralized backend equipment'
  });
  stages.push({
    id: 'seating',
    title: 'Generate seating',
    status: !seating.valid ? 'incomplete' : seating.warnings.length ? 'warning' : 'done',
    detail: seating.reused
      ? `Kept existing ${seating.seats.length} seats / TableSpec`
      : seating.layoutReason
  });

  if (!seating.reused && !seating.valid) {
    return {
      status: 'no_valid_design',
      blockingReason: `NO VALID LAYOUT — ${seating.warnings.find((w) => w.includes('cannot be accommodated')) ?? `${r.seating.count} seats cannot be accommodated with the selected room dimensions and required circulation.`}`,
      requirementIssues: validated.issues,
      requirements: r,
      stages,
      options: [],
      selectedOptionId: 'balanced',
      existing,
      missing,
      assistant: stages,
      spatialIssues: []
    };
  }

  const wall = r.constraints.presentationWall ?? getPresentationWall(room);
  stages.push({
    id: 'wall',
    title: 'Determine presentation wall',
    status: 'done',
    detail: `${wall} — scored from seating, doors/windows, circulation, and viewing throw (not first empty wall)`
  });

  const forbidden: WallKey | undefined = r.constraints.noRearWallEquipment ? 'back' : undefined;
  const keepEq = r.constraints.keepExistingEquipment;
  const skip = (has: boolean) => r.completeMissingOnly && has;

  const displaysFilter = filterDisplays(catalog, r);
  const micFilter = filterMics(catalog, r);
  const spkFilter = filterSpeakers(catalog, r);
  const camFilter = filterCameras(catalog, r);

  if (displaysFilter.usable.length === 0 && !skip(existing.display) && keepExistingOf(ctx, catalog, 'display', keepEq).length === 0) {
    const exclusive = r.constraints.manufacturersExclusive && r.preferences.manufacturers.length > 0;
    return {
      status: 'no_valid_design',
      blockingReason: exclusive
        ? 'NO VALID DESIGN FOUND — preferred manufacturers have no engineering-complete displays. Preference does not override missing catalog data.'
        : 'NO VALID DESIGN FOUND — no catalog display has physical size and diagonal required for viewing analysis. Specifications were not invented.',
      requirementIssues: validated.issues,
      requirements: r,
      stages,
      options: [],
      selectedOptionId: 'balanced',
      existing,
      missing,
      assistant: stages,
      spatialIssues: []
    };
  }

  if (r.audio.speakerPreference === 'wall' && r.audio.required && !skip(existing.audio) && keepExistingOf(ctx, catalog, 'speaker', keepEq).length === 0) {
    return {
      status: 'no_valid_design',
      blockingReason:
        'NO VALID DESIGN FOUND — requested wall-mounted speakers cannot currently be automatically placed because speaker auto-placement only supports ceiling grids. Place wall speakers manually or choose ceiling speakers.',
      requirementIssues: validated.issues,
      requirements: r,
      stages,
      options: [],
      selectedOptionId: 'balanced',
      existing,
      missing,
      assistant: stages,
      spatialIssues: []
    };
  }

  const id = nextIdFactory();
  const existingDisplays = keepExistingOf(ctx, catalog, 'display', keepEq);
  const displayEvals = displaysFilter.usable.map((p) => {
    const count = desiredDisplayCount(r, dualFitsWall(room, p, wall));
    return evaluateDisplayProduct(p, room, seating.seats, seating.tables, count, forbidden, id);
  });
  displayEvals.sort((a, b) => a.fail - b.fail || b.pass - a.pass);
  const displayPicks = displayEvals.map((e) => e.pick);

  const micEvals = r.microphones.required && !skip(existing.microphones)
    ? micFilter.usable.map((p) => placeMics(p, seating.seats, room, id))
    : [];
  micEvals.sort((a, b) => b.covered - a.covered || a.instances.length - b.instances.length);

  const spkEvals =
    r.audio.required && !skip(existing.audio) && spkFilter.usable.length
      ? spkFilter.usable.map((p) => placeSpeakers(p, room, seating.seats, id))
      : [];
  spkEvals.sort((a, b) => {
    const as = a.pick.status === 'pass' ? 0 : a.pick.status === 'warning' ? 1 : 2;
    const bs = b.pick.status === 'pass' ? 0 : b.pick.status === 'warning' ? 1 : 2;
    return as - bs || a.instances.length - b.instances.length;
  });

  const camEvals =
    r.camera.required !== 'not_required' && !skip(existing.camera) && camFilter.usable.length
      ? camFilter.usable.map((p) => placeCamera(p, room, seating.seats, seating.tables, id))
      : [];

  if (r.microphones.required && !skip(existing.microphones) && !keepExistingOf(ctx, catalog, 'microphone', keepEq).length && micFilter.usable.length === 0) {
    stages.push({
      id: 'mics',
      title: 'Select microphone candidates',
      status: 'incomplete',
      detail: micFilter.completenessReason
    });
  }

  function assemble(kind: DesignOption['id'], dispIdx: number, micIdx: number, spkIdx: number, camIdx: number): DesignOption {
    const localId = nextIdFactory();
    const equipment: EquipmentInstance[] = [];
    const picks: DesignOption['picks'] = {};
    const why: string[] = [];
    why.push(
      seating.reused
        ? `Seating: existing ${seating.seats.length} seats and TableSpec preserved.`
        : seating.layoutReason
    );
    if (!seating.reused) {
      why.push(
        `${layoutPretty(seating.layout)} layout selected because the project requires ${r.seating.count} participants and ${r.useCase.replace('_', ' ')}.`
      );
    }

    if (skip(existing.display) || (keepEq && existingDisplays.length)) {
      equipment.push(...existingDisplays);
      const prod = catalog.get(existingDisplays[0].productId);
      picks.display = {
        productId: existingDisplays[0].productId,
        name: existingDisplays[0].name,
        reason: 'Existing display retained. Viewing uses the current geometry — it was not replaced.',
        criterion: 'Keep compatible existing equipment',
        actual: prod?.display ? `${prod.display.diagonalInches}" catalog display already in the project` : 'Existing display instance kept',
        expected: 'Do not duplicate a compatible display',
        status: 'pass',
        source: 'Current project equipment',
        completeness: 'complete',
        completenessReason: 'Existing instance kept.',
        retainedExisting: true,
        alternatives: []
      };
      why.push('Displays: existing display retained. Viewing uses current geometry.');
    } else if (displayEvals[dispIdx]) {
      const ev = evaluateDisplayProduct(
        catalog.get(displayEvals[dispIdx].pick.productId)!,
        room,
        seating.seats,
        seating.tables,
        displayEvals[dispIdx].instances.length,
        forbidden,
        localId
      );
      equipment.push(...ev.instances);
      picks.display = attachAlts(displayPicks, ev.pick);
      why.push(
        `Displays: ${ev.instances.length} × ${ev.pick.name} so seating stays within the configured viewing-distance criterion (${ev.pick.actual}).`
      );
    }

    const existingMics = keepExistingOf(ctx, catalog, 'microphone', keepEq);
    if (skip(existing.microphones) || (keepEq && existingMics.length && r.completeMissingOnly)) {
      equipment.push(...existingMics);
    } else if (r.microphones.required && micEvals[micIdx]) {
      const ev = placeMics(catalog.get(micEvals[micIdx].pick.productId)!, seating.seats, room, localId);
      equipment.push(...ev.instances);
      picks.microphone = attachAlts(
        micEvals.map((m) => m.pick),
        ev.pick
      );
      why.push(`Microphones: ${ev.pick.reason}`);
    } else if (r.microphones.required) {
      why.push('Microphones: DATA INCOMPLETE — no catalog product with required pickup data matched the request.');
    }

    const existingSpk = keepExistingOf(ctx, catalog, 'speaker', keepEq);
    if (skip(existing.audio) || (keepEq && existingSpk.length && r.completeMissingOnly)) {
      equipment.push(...existingSpk);
    } else if (r.audio.required && spkEvals[spkIdx]) {
      const ev = placeSpeakers(catalog.get(spkEvals[spkIdx].pick.productId)!, room, seating.seats, localId);
      equipment.push(...ev.instances);
      picks.speaker = attachAlts(
        spkEvals.map((s) => s.pick),
        ev.pick
      );
      why.push(`Speakers: ${ev.pick.reason}`);
    }

    const existingCam = keepExistingOf(ctx, catalog, 'camera', keepEq);
    if (skip(existing.camera) || (keepEq && existingCam.length && r.completeMissingOnly)) {
      equipment.push(...existingCam);
    } else if (r.camera.required !== 'not_required' && camEvals[camIdx]) {
      const dispWall = equipment.find((e) => catalog.get(e.productId)?.category === 'display')?.wall;
      const ev = placeCamera(
        catalog.get(camEvals[camIdx].pick.productId)!,
        room,
        seating.seats,
        seating.tables,
        localId,
        dispWall
      );
      equipment.push(...ev.instances);
      picks.camera = attachAlts(
        camEvals.map((c) => c.pick),
        ev.pick
      );
      why.push(`Camera: ${ev.pick.reason}`);
    } else if (r.camera.required === 'required') {
      why.push('Camera: DATA INCOMPLETE — no catalog camera with horizontalFovDeg, or camera is optional and omitted.');
    }

    if (keepEq) {
      for (const e of ctx.equipment) {
        const cat = catalog.get(e.productId)?.category;
        if (!cat) continue;
        if (['display', 'microphone', 'speaker', 'camera'].includes(cat)) continue;
        if (!equipment.some((x) => x.instanceId === e.instanceId)) equipment.push(e);
      }
    }

    const needSwitching =
      r.system.switchingRequired === true ||
      (r.system.switchingRequired === 'auto' && equipment.filter((e) => catalog.get(e.productId)?.category === 'display').length > 1);
    const needDsp = r.system.dspRequired === true || (r.system.dspRequired === 'auto' && r.audio.required && r.audio.priority !== 'basic');

    const topo = buildSystemTopology({
      catalog,
      req: r,
      room,
      equipment,
      id: localId,
      needVideoPath: equipment.some((e) => catalog.get(e.productId)?.category === 'display'),
      needAudioPath: r.audio.required && equipment.some((e) => catalog.get(e.productId)?.category === 'speaker'),
      needSwitching,
      needDsp: needDsp || equipment.some((e) => catalog.get(e.productId)?.category === 'speaker')
    });
    const rawEquipment = [...equipment, ...topo.extraEquipment];
    const rackReq = evaluateRackRequirement(rawEquipment, catalog);
    let optionRacks: import('../av/AVRack').AVRack[] = [];
    let allEq = rawEquipment;

    if (rackReq.required) {
      optionRacks = [defaultRack];
      allEq = assignKnownRuToRack(rawEquipment, defaultRack, catalog);
      why.push(`AV rack: ${rackReq.reason} (${rackPlace.note})`);
    } else {
      why.push(`AV rack: ${rackReq.reason}`);
    }

    why.push(
      topo.connections.length
        ? `System: ${topo.connections.length} catalog-valid connection(s). Seat count did not select the topology.`
        : 'System: no catalog-valid path could be completed without inventing ports.'
    );

    const bullets =
      kind === 'minimal'
        ? ['Lower equipment count', 'Uses smallest passing display among ranked candidates when available']
        : kind === 'premium'
          ? ['Better viewing or coverage margin among ranked catalog candidates', 'May use more loudspeakers if the grid engine requires it']
          : ['Ranked by existing viewing/coverage engines', 'Catalog-complete products only'];

    return optionFromParts(
      kind,
      kind === 'minimal' ? 'Minimal' : kind === 'premium' ? 'Premium' : 'Balanced',
      bullets,
      room,
      seating.seats,
      seating.tables,
      allEq,
      catalog,
      picks,
      why.filter(Boolean),
      topo.notes,
      topo.connections,
      topo.routes,
      optionRacks
    );
  }

  stages.push({
    id: 'display',
    title: 'Select / evaluate displays',
    status: displayEvals[0] ? (displayEvals[0].fail ? 'warning' : 'done') : skip(existing.display) ? 'done' : 'incomplete',
    detail: displayEvals[0]?.pick.actual ?? displaysFilter.completenessReason
  });
  if (r.audio.required) {
    stages.push({
      id: 'speakers',
      title: 'Select / evaluate speakers',
      status: spkEvals[0] ? 'done' : skip(existing.audio) ? 'done' : 'incomplete',
      detail: spkEvals[0]?.pick.actual ?? spkFilter.completenessReason
    });
  }
  if (r.microphones.required) {
    stages.push({
      id: 'mics-eval',
      title: 'Evaluate microphone coverage',
      status: micEvals[0] ? 'done' : skip(existing.microphones) ? 'done' : 'incomplete',
      detail: micEvals[0]?.pick.actual ?? micFilter.completenessReason
    });
  }
  if (r.camera.required !== 'not_required') {
    stages.push({
      id: 'camera',
      title: 'Evaluate camera coverage',
      status: camEvals[0] ? (camEvals[0].pick.completeness === 'partial' ? 'warning' : 'done') : skip(existing.camera) ? 'done' : 'incomplete',
      detail: camEvals[0]?.pick.completenessReason ?? camFilter.completenessReason
    });
  }

  const lastDisp = Math.max(0, displayEvals.length - 1);
  const lastMic = Math.max(0, micEvals.length - 1);
  const lastSpk = Math.max(0, spkEvals.length - 1);
  const lastCam = Math.max(0, camEvals.length - 1);

  const balanced = assemble('balanced', 0, 0, 0, 0);
  const options: DesignOption[] = [balanced];
  const minimal = assemble('minimal', lastDisp, lastMic, lastSpk, lastCam);
  if (optionFingerprint(minimal) !== optionFingerprint(balanced)) options.push(minimal);
  if (spkEvals.length > 1) {
    const prem = assemble('premium', 0, 0, Math.min(1, lastSpk), 0);
    if (!options.some((o) => optionFingerprint(o) === optionFingerprint(prem))) options.push(prem);
  } else if (displayEvals.length > 1) {
    const prem = assemble('premium', Math.min(1, lastDisp), 0, 0, 0);
    if (!options.some((o) => optionFingerprint(o) === optionFingerprint(prem))) options.push(prem);
  }

  stages.push({
    id: 'topology',
    title: 'Build system topology',
    status: balanced.connections.length ? 'done' : 'warning',
    detail: `${balanced.connections.length} connection(s), ${balanced.routes.length} route(s)`
  });
  stages.push({
    id: 'validation',
    title: 'Run validation',
    status: balanced.validation.errorCount ? 'warning' : 'done',
    detail: `✓ ${balanced.validation.passCount}  ⚠ ${balanced.validation.warningCount}  ✕ ${balanced.validation.errorCount}`
  });

  return {
    status: 'ok',
    requirementIssues: validated.issues,
    requirements: r,
    stages,
    options,
    selectedOptionId: 'balanced',
    existing,
    missing: r.completeMissingOnly ? missing : [],
    assistant: stages,
    spatialIssues: auditGeneratedLayout({
      room: balanced.room,
      seats: balanced.seats,
      tables: balanced.tables,
      equipment: balanced.equipment,
      connections: balanced.connections,
      catalog
    })
  };
}

function layoutPretty(layout: string): string {
  if (layout === 'classroom') return 'Classroom';
  if (layout === 'boardroom' || layout === 'conference') return 'Conference';
  if (layout === 'training') return 'Training';
  if (layout === 'flexible') return 'Flexible';
  return layout;
}

function assignKnownRuToRack(
  equipment: EquipmentInstance[],
  rack: import('../av/AVRack').AVRack | undefined,
  catalog: EquipmentCatalog
): EquipmentInstance[] {
  if (!rack) return equipment;
  let cursor = 1;
  return equipment.map((e) => {
    const ru = e.rackUnits ?? catalog.get(e.productId)?.rackUnits;
    if (!ru || ru <= 0) return e;
    if (cursor + ru - 1 > rack.ruTotal) return e;
    const next = { ...e, rackId: rack.id, rackUnits: ru, rackPositionRU: cursor };
    cursor += ru;
    return next;
  });
}

function optionFingerprint(o: DesignOption): string {
  return o.equipment.map((e) => e.productId).sort().join('|') + ':' + o.equipment.length;
}

export function selectedOption(proposal: DesignProposal): DesignOption | null {
  return proposal.options.find((o) => o.id === proposal.selectedOptionId) ?? proposal.options[0] ?? null;
}

export function hasManualChanges(ctx: ProjectDesignContext, lastAutoIds: string[]): boolean {
  if (!lastAutoIds.length) return ctx.equipment.some((e) => e.origin === 'manual' || e.placementMode === 'manual');
  return ctx.equipment.some(
    (e) =>
      (lastAutoIds.includes(e.instanceId) && (e.placementMode === 'manual' || e.origin === 'manual')) ||
      (!lastAutoIds.includes(e.instanceId) && e.origin === 'manual')
  );
}
