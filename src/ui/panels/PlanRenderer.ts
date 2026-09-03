/**
 * PlanRenderer.ts
 * 2D plan view from the same project state as 3D. Supports selection,
 * click-to-select, and drag-to-move for equipment (with wall/ceiling snap).
 */

import type { AppState } from '../../app/AppState';
import type { RoomModel } from '../../room/RoomModel';
import { getActiveDisplay, computeSeatStatuses, projectObstacles } from '../../av/DesignAnalysis';
import { cachedCoverage } from '../../av/coverageCache';
import { cachedMicCoverage } from '../../av/micCoverageCache';
import { STATUS_RGB } from '../../av/HeatmapEngine';
import type { HeatmapImage } from '../../av/HeatmapEngine';
import { contourPolylines, fieldFromCells } from '../../av/simulation/SpatialField';
import { loadDefaultCatalog } from '../../catalog/loadCatalog';
import type { CheckStatus } from '../../av/ViewingDistanceEngine';
import { seatForward, presentationRotation } from '../../room/RoomGeometry';
import { snapEquipment, snapSeatPosition, snapTablePosition } from '../../interaction/SnapEngine';
import { rackServiceAabb } from '../../av/AVRack';
import {
  alignmentGuides,
  boxCadTargets,
  nearestCadSnap,
  roomCadTargets,
  type AlignmentGuide
} from '../../interaction/CadSnap';
import { computeSeatMicStatuses, resolveProjectMicrophones, usableMicPlacements } from '../../av/MicAnalysis';
import { cachedSpeakerCoverage } from '../../av/speakerCoverageCache';
import {
  computeSeatAudioStatuses,
  resolveProjectSpeakers,
  usableSpeakerPlacements
} from '../../av/SpeakerAnalysis';
import { cachedCameraCoverage } from '../../av/cameraCoverageCache';
import {
  computeSeatCameraStatuses,
  resolveProjectCameras,
  summarizeCameraCoverage,
  usableCameraPlacements
} from '../../av/CameraAnalysis';
import { cachedCableRoute } from '../../system/CableRouter';
import { cableRouteContext } from '../../system/cableContext';
import { isCableSelected, shouldDrawConnection, shouldShowCableRoutes } from '../../system/cableVisibility';

const catalog = loadDefaultCatalog();
const PX_PER_M = 46;

const STATUS_FILL: Record<CheckStatus, string> = { pass: '#2fae5a', warning: '#e0a934', fail: '#d6483f' };

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));
  return el;
}

function drawHeatmapGrid(
  svg: SVGSVGElement,
  grid: {
    cols: number;
    rows: number;
    cells: Array<{ col: number; row: number; x: number; z: number; overall: CheckStatus; score?: number; masked?: boolean }>;
  },
  roomWpx: number,
  roomDpx: number,
  image: HeatmapImage | null,
  room: RoomModel,
  state: AppState,
  toPx: (x: number, z: number) => [number, number],
  showContours: boolean
): void {
  if (image?.dataUrl) {
    const img = svgEl('image', {
      href: image.dataUrl,
      x: 0,
      y: 0,
      width: roomWpx,
      height: roomDpx,
      opacity: 0.55,
      preserveAspectRatio: 'none'
    });
    svg.appendChild(img);
  } else {
    const cellW = roomWpx / grid.cols;
    const cellD = roomDpx / grid.rows;
    grid.cells.forEach((cell) => {
      if (cell.masked) return;
      const [px, pz] = toPx(cell.x, cell.z);
      const [r, g, b] = STATUS_RGB[cell.overall];
      svg.appendChild(
        svgEl('rect', {
          x: px - cellW / 2,
          y: pz - cellD / 2,
          width: cellW,
          height: cellD,
          fill: `rgba(${r},${g},${b},0.32)`,
          stroke: 'none'
        })
      );
    });
  }
  if (!showContours) return;
  const field = fieldFromCells(room, grid.cols, grid.rows, grid.cells, state.tables, state.racks);
  contourPolylines(field, [0.5, 0.85]).forEach((c) => {
    for (let i = 0; i + 1 < c.points.length; i += 2) {
      const [x1, y1] = toPx(c.points[i].x, c.points[i].z);
      const [x2, y2] = toPx(c.points[i + 1].x, c.points[i + 1].z);
      svg.appendChild(
        svgEl('line', {
          x1,
          y1,
          x2,
          y2,
          stroke: c.iso >= 0.75 ? '#2fae5a' : '#c47b12',
          'stroke-width': 1.2,
          opacity: 0.85
        })
      );
    }
  });
}

export function renderPlanView(container: HTMLElement, state: AppState): void {
  container.innerHTML = '';
  const room = state.room;
  if (!room) {
    const empty = document.createElement('div');
    empty.className = 'plan-empty';
    empty.textContent = 'Define a room to see the 2D plan.';
    container.appendChild(empty);
    return;
  }

  const padPx = 70;
  const w = room.width * PX_PER_M;
  const d = room.depth * PX_PER_M;
  const svg = svgEl('svg', {
    width: '100%',
    height: '100%',
    viewBox: `${-padPx} ${-padPx} ${w + padPx * 2} ${d + padPx * 2}`
  });
  svg.style.background = '#f7f8fa';

  const toPx = (x: number, z: number): [number, number] => [x * PX_PER_M + w / 2, z * PX_PER_M + d / 2];
  const toWorld = (px: number, pz: number): { x: number; z: number } => ({
    x: (px - w / 2) / PX_PER_M,
    z: (pz - d / 2) / PX_PER_M
  });

  svg.appendChild(svgEl('rect', { x: 0, y: 0, width: w, height: d, fill: '#ffffff', stroke: '#5c6370', 'stroke-width': 2.5 }));
  drawPlanGrid(svg, room, w, d, state.gridSpacingM);

  const display = getActiveDisplay(state.equipment, catalog);
  const obstacles = projectObstacles(room, state.tables, state.racks);
  const viz = state.displayAnalysis;
  const micViz = state.micAnalysis;
  const audioViz = state.audioAnalysis;
  const cameraViz = state.cameraAnalysis;
  const resolvedMics = resolveProjectMicrophones(state.equipment, catalog);
  const usableMics = usableMicPlacements(resolvedMics);
  const resolvedSpeakers = resolveProjectSpeakers(state.equipment, catalog);
  const usableSpeakers = usableSpeakerPlacements(resolvedSpeakers);
  const resolvedCameras = resolveProjectCameras(state.equipment, catalog);
  const usableCameras = usableCameraPlacements(resolvedCameras);

  if (cameraViz.enabled && cameraViz.heatmap) {
    const { grid, image } = cachedCameraCoverage(room, usableCameras, obstacles, cameraViz.samplingQuality);
    drawHeatmapGrid(svg, grid, w, d, image, room, state, toPx, cameraViz.contours);
  } else if (audioViz.enabled && audioViz.heatmap) {
    const { grid, image } = cachedSpeakerCoverage(room, usableSpeakers, audioViz.samplingQuality);
    drawHeatmapGrid(svg, grid, w, d, image, room, state, toPx, audioViz.contours);
  } else if (micViz.enabled && micViz.heatmap) {
    const { grid, image } = cachedMicCoverage(room, usableMics, micViz.samplingQuality);
    drawHeatmapGrid(svg, grid, w, d, image, room, state, toPx, micViz.contours);
  } else if (viz.enabled && viz.heatmap && display) {
    const { grid, image } = cachedCoverage(
      room,
      display,
      obstacles,
      viz.samplingQuality,
      viz.heatmapMetric,
      state.tables,
      state.racks
    );
    drawHeatmapGrid(svg, grid, w, d, image, room, state, toPx, viz.contours);
  }

  drawOpenings(svg, room, w, d);
  drawColumns(svg, room, toPx);
  drawDimensions(svg, room, w, d, state);

  drawAlignmentGuides(svg, state.alignmentGuides, toPx, w, d);
  drawMeasureOverlay(svg, state, toPx);

  // Tables
  state.tables.forEach((table) => {
    const [px, pz] = toPx(table.centerX, table.centerZ);
    const isSelected = state.selection.kind === 'table' && state.selection.id === table.id;
    const highlighted = state.highlightedTableIds.includes(table.id);
    const rx = table.shape === 'ellipse' ? (table.sizeX * PX_PER_M) / 2 : table.shape === 'rounded_rect' ? 10 : 3;
    const g = svgEl('g', { class: 'plan-table', 'data-table-id': table.id });
    const rect = svgEl('rect', {
      x: px - (table.sizeX * PX_PER_M) / 2,
      y: pz - (table.sizeZ * PX_PER_M) / 2,
      width: table.sizeX * PX_PER_M,
      height: table.sizeZ * PX_PER_M,
      fill: '#c4a882',
      stroke: isSelected || highlighted ? '#2f8cff' : '#6b5a42',
      'stroke-width': isSelected || highlighted ? 3 : 1.25,
      rx: String(rx)
    });
    g.appendChild(rect);
    if (table.hasCableWell) {
      g.appendChild(
        svgEl('rect', {
          x: px - 8,
          y: pz - 5,
          width: 16,
          height: 10,
          fill: '#3a3a40',
          rx: '2'
        })
      );
    }
    g.style.cursor = 'grab';
    g.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.viewportTool === 'measure') return;
      state.select('table', table.id);
    });
    enablePlanDrag(g, rect as SVGGraphicsElement, state, table.id, 'table', toWorld, room, px, pz);
    svg.appendChild(g);
  });

  state.racks.forEach((rack) => {
    const [px, pz] = toPx(rack.x, rack.z);
    const isSelected = state.selection.kind === 'rack' && state.selection.id === rack.id;
    const service = rackServiceAabb(rack);
    const [s0x, s0z] = toPx(service.minX, service.minZ);
    const [s1x, s1z] = toPx(service.maxX, service.maxZ);
    const rg = svgEl('g', { class: 'plan-rack', 'data-rack-id': rack.id });
    rg.appendChild(
      svgEl('rect', {
        x: Math.min(s0x, s1x),
        y: Math.min(s0z, s1z),
        width: Math.abs(s1x - s0x),
        height: Math.abs(s1z - s0z),
        fill: 'none',
        stroke: '#8a6d3b',
        'stroke-width': 1,
        'stroke-dasharray': '5 4'
      })
    );
    const body = svgEl('rect', {
      x: px - (rack.width * PX_PER_M) / 2,
      y: pz - (rack.depth * PX_PER_M) / 2,
      width: rack.width * PX_PER_M,
      height: rack.depth * PX_PER_M,
      fill: '#3a3d44',
      stroke: isSelected ? '#2f8cff' : '#1f2126',
      'stroke-width': isSelected ? 3 : 1.25
    });
    rg.appendChild(body);
    rg.style.cursor = 'grab';
    rg.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.viewportTool === 'measure') return;
      state.select('rack', rack.id);
    });
    enablePlanDrag(rg, body as SVGGraphicsElement, state, rack.id, 'rack', toWorld, room, px, pz);
    svg.appendChild(rg);
  });

  const displayForSeats = display;
  const showMicStatus = micViz.enabled && micViz.seatStatus;
  const showAudioStatus = audioViz.enabled && audioViz.seatStatus;
  const showCameraStatus = cameraViz.enabled && cameraViz.seatStatus;
  const showStatus = showMicStatus || showAudioStatus || showCameraStatus || (viz.enabled && viz.seatStatus);
  const statuses: Map<string, CheckStatus> = showMicStatus
    ? computeSeatMicStatuses(state.seats, state.equipment, catalog)
    : showAudioStatus
      ? computeSeatAudioStatuses(state.seats, state.equipment, catalog)
      : showCameraStatus
        ? computeSeatCameraStatuses(state.seats, state.equipment, catalog, state.room, state.tables)
        : viz.enabled && displayForSeats
          ? computeSeatStatuses(state.seats, displayForSeats, obstacles)
          : new Map();

  if (cameraViz.enabled && cameraViz.fovRegions) {
    resolvedCameras.forEach((cam) => {
      if (!cam.coverageRegion) return;
      const selected = state.selection.kind === 'equipment' && state.selection.id === cam.instanceId;
      const points = cam.coverageRegion.outline
        .map((p) => {
          const [px, pz] = toPx(p.x, p.z);
          return `${px},${pz}`;
        })
        .join(' ');
      svg.appendChild(
        svgEl('polygon', {
          points,
          fill: 'rgba(107,92,255,0.12)',
          stroke: selected ? '#2f8cff' : '#6b5cff',
          'stroke-width': selected ? 2.5 : 1.25
        })
      );
    });
  }

  if (cameraViz.enabled && cameraViz.blockedSightlines) {
    const summary = summarizeCameraCoverage(state.seats, state.equipment, catalog, state.room, state.tables);
    const highlight = state.highlightedSeatIds;
    summary.seatResults
      .filter((r) => r.inFov && !r.visible)
      .filter((r) => highlight.length === 0 || highlight.includes(r.seatId))
      .forEach((r) => {
        const cam = state.equipment.find((e) => e.instanceId === r.blockingCameraIds[0]);
        const seat = state.seats.find((s) => s.id === r.seatId);
        if (!cam || !seat) return;
        const [sx, sz] = toPx(seat.x, seat.z);
        const [cx, cz] = toPx(cam.position.x, cam.position.z);
        svg.appendChild(
          svgEl('line', {
            x1: sx,
            y1: sz,
            x2: cx,
            y2: cz,
            stroke: '#d6483f',
            'stroke-width': 1.5,
            'stroke-opacity': 0.85
          })
        );
      });
  }

  if (audioViz.enabled && audioViz.coverageRegions) {
    resolvedSpeakers.forEach((sp) => {
      if (!sp.coverageRegion) return;
      const selected = state.selection.kind === 'equipment' && state.selection.id === sp.instanceId;
      const points = sp.coverageRegion.outline
        .map((p) => {
          const [px, pz] = toPx(p.x, p.z);
          return `${px},${pz}`;
        })
        .join(' ');
      svg.appendChild(
        svgEl('polygon', {
          points,
          fill: 'rgba(214,140,50,0.12)',
          stroke: selected ? '#2f8cff' : '#c47a28',
          'stroke-width': selected ? 2.5 : 1.25
        })
      );
    });
  }

  if (micViz.enabled && micViz.pickupRegions) {
    resolvedMics.forEach((mic) => {
      if (!mic.pickupRegion) return;
      const selected = state.selection.kind === 'equipment' && state.selection.id === mic.instanceId;
      const points = mic.pickupRegion.outline
        .map((p) => {
          const [px, pz] = toPx(p.x, p.z);
          return `${px},${pz}`;
        })
        .join(' ');
      svg.appendChild(
        svgEl('polygon', {
          points,
          fill: 'rgba(90,167,212,0.12)',
          stroke: selected ? '#2f8cff' : '#5aa7d4',
          'stroke-width': selected ? 2.5 : 1.25,
          'fill-rule': 'evenodd'
        })
      );
    });
  }

  if (viz.enabled && viz.sightlines !== 'off' && displayForSeats) {
    const seats =
      viz.sightlines === 'selected' && state.selection.kind === 'seat' && state.selection.id
        ? state.seats.filter((s) => s.id === state.selection.id)
        : state.seats;
    seats.forEach((seat) => {
      const [sx, sz] = toPx(seat.x, seat.z);
      const [dx, dz] = toPx(displayForSeats.position.x, displayForSeats.position.z);
      const status: CheckStatus = statuses.get(seat.id) ?? 'fail';
      const [r, g, b] = STATUS_RGB[status];
      svg.appendChild(svgEl('line', {
        x1: sx, y1: sz, x2: dx, y2: dz,
        stroke: `rgb(${r},${g},${b})`,
        'stroke-width': 1.5,
        'stroke-opacity': 0.75
      }));
    });
  }

  state.seats.forEach((seat) => {
    const [px, pz] = toPx(seat.x, seat.z);
    const status = statuses.get(seat.id);
    const g = svgEl('g', { class: 'plan-seat', 'data-seat-id': seat.id });
    const isSelected = state.selection.kind === 'seat' && state.selection.id === seat.id;
    const forward = seatForward(seat.facing);
    const rect = svgEl('rect', {
      x: px - 8,
      y: pz - 7,
      width: 16,
      height: 14,
      rx: 3,
      fill: showStatus && status ? STATUS_FILL[status] : '#4a5568',
      stroke: isSelected ? '#2f8cff' : '#20222533',
      'stroke-width': isSelected ? 3 : 1
    });
    const back = svgEl('rect', {
      x: px - 8 - forward.x * 9,
      y: pz - 7 - forward.z * 9,
      width: 16,
      height: 5,
      rx: 1,
      fill: showStatus && status ? STATUS_FILL[status] : '#3a4458',
      stroke: 'none'
    });
    const tick = svgEl('line', {
      x1: px, y1: pz, x2: px + forward.x * 9, y2: pz + forward.z * 9,
      stroke: '#20222580', 'stroke-width': 2
    });
    g.append(back, rect, tick);
    g.style.cursor = 'grab';
    g.addEventListener('click', (e) => {
      e.stopPropagation();
      state.select('seat', seat.id);
    });
    enablePlanDrag(g, rect as SVGGraphicsElement, state, seat.id, 'seat', toWorld, room, px, pz);
    svg.appendChild(g);
  });

  const showCables = shouldShowCableRoutes(state);
  if (showCables && state.connections.length) {
    const ctx = cableRouteContext(state, catalog);
    const SIG_STROKE: Record<string, string> = {
      VIDEO: '#6aa4e8',
      AUDIO: '#6aae7a',
      USB: '#c4a35a',
      NETWORK: '#5aa88a',
      CONTROL: '#a8a8a8'
    };
    state.connections.forEach((c) => {
      if (!shouldDrawConnection(state, c)) return;
      const route = cachedCableRoute(c, ctx);
      const sel = isCableSelected(state, c);
      const stroke = sel ? '#2f8cff' : SIG_STROKE[c.signalType] ?? '#5aa88a';
      route.segments.forEach((s) => {
        const [x1, y1] = toPx(s.start.x, s.start.z);
        const [x2, y2] = toPx(s.end.x, s.end.z);
        svg.appendChild(
          svgEl('line', {
            x1,
            y1,
            x2,
            y2,
            stroke,
            'stroke-width': sel ? 2.4 : 1.4,
            'stroke-opacity': sel ? 0.95 : 0.55,
            fill: 'none'
          })
        );
      });
    });
  }

  state.equipment.forEach((inst) => {
    if (state.hiddenEquipmentIds.includes(inst.instanceId)) return;
    const product = catalog.get(inst.productId);
    if (!product) return;
    const [px, pz] = toPx(inst.position.x, inst.position.z);
      const isSelected =
        (state.selection.kind === 'equipment' && state.selection.id === inst.instanceId) ||
        state.additionalSelectedIds.includes(inst.instanceId);
    const g = svgEl('g', { class: 'plan-equipment' });
    g.style.cursor = 'grab';

    const rotY = inst.rotationY !== undefined ? inst.rotationY : (inst.wall ? presentationRotation(inst.wall) : 0);
    const rotDeg = -rotY * (180 / Math.PI);
    if (Math.abs(rotDeg) > 0.01) {
      g.setAttribute('transform', `rotate(${rotDeg.toFixed(2)}, ${px}, ${pz})`);
    }

    let hitTarget: SVGGraphicsElement;
    const wPx = Math.max(6, (product.physical.width || 0.12) * PX_PER_M);
    const dPx = Math.max(6, (product.physical.depth || 0.12) * PX_PER_M);
    if (product.category === 'display') {
      hitTarget = svgEl('rect', {
        x: px - wPx / 2,
        y: pz - 4,
        width: wPx,
        height: 8,
        fill: '#0d3a5c',
        stroke: isSelected ? '#2f8cff' : '#000',
        'stroke-width': isSelected ? 3 : 1
      });
      // Screen face accent (front +Z edge)
      const screenAccent = svgEl('line', {
        x1: px - wPx / 2 + 1,
        y1: pz + 4,
        x2: px + wPx / 2 - 1,
        y2: pz + 4,
        stroke: '#58a6ff',
        'stroke-width': 2
      });
      g.appendChild(screenAccent);
    } else if (product.category === 'camera') {
      hitTarget = svgEl('polygon', {
        points: `${px},${pz - 8} ${px + 7},${pz + 6} ${px - 7},${pz + 6}`,
        fill: '#1c1c1e',
        stroke: isSelected ? '#2f8cff' : '#20222580',
        'stroke-width': isSelected ? 3 : 1
      });
    } else if (product.category === 'speaker') {
      hitTarget = svgEl('rect', {
        x: px - wPx / 2,
        y: pz - dPx / 2,
        width: wPx,
        height: dPx,
        rx: 2,
        fill: '#232325',
        stroke: isSelected ? '#2f8cff' : '#20222580',
        'stroke-width': isSelected ? 3 : 1
      });
    } else if (product.category === 'microphone') {
      hitTarget = svgEl('ellipse', {
        cx: px,
        cy: pz,
        rx: wPx / 2,
        ry: dPx / 2,
        fill: '#d8d5cf',
        stroke: isSelected ? '#2f8cff' : '#20222580',
        'stroke-width': isSelected ? 3 : 1
      });
    } else {
      hitTarget = svgEl('rect', {
        x: px - wPx / 2,
        y: pz - dPx / 2,
        width: wPx,
        height: dPx,
        fill: '#8a8478',
        stroke: isSelected ? '#2f8cff' : '#20222580',
        'stroke-width': isSelected ? 3 : 1
      });
    }
    g.appendChild(hitTarget);

    g.addEventListener('click', (e) => {
      e.stopPropagation();
      state.select('equipment', inst.instanceId, e.shiftKey);
    });
    enablePlanDrag(g, hitTarget as SVGGraphicsElement, state, inst.instanceId, 'equipment', toWorld, room, px, pz);
    svg.appendChild(g);
  });

  svg.addEventListener('click', (e) => {
    if (state.viewportTool === 'measure') {
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const local = pt.matrixTransform(ctm.inverse());
      const world = toWorld(local.x, local.y);
      const targets = collectPlanTargets(state, room);
      const snapped = nearestCadSnap(world.x, world.z, targets, state.gridSpacingM);
      state.addMeasurePoint(snapped.x, snapped.z);
      state.setSnapNote(`${snapped.kind} snap`);
      return;
    }
    state.select('none', null);
  });
  container.appendChild(svg);
}

function enablePlanDrag(
  group: SVGGElement,
  handle: SVGGraphicsElement,
  state: AppState,
  id: string,
  kind: 'seat' | 'equipment' | 'table' | 'rack',
  toWorld: (px: number, pz: number) => { x: number; z: number },
  room: RoomModel,
  originPx: number,
  originPz: number
): void {
  const svg = group.ownerSVGElement!;
  let dragging = false;
  let startSvgX = 0;
  let startSvgY = 0;
  let lastSvgX = 0;
  let lastSvgY = 0;
  const initialTransform = group.getAttribute('transform') || '';

  const clientToSvg = (clientX: number, clientY: number): { x: number; y: number } => {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const out = pt.matrixTransform(ctm.inverse());
    return { x: out.x, y: out.y };
  };

  const onMove = (e: PointerEvent): void => {
    if (!dragging) return;
    const cur = clientToSvg(e.clientX, e.clientY);
    lastSvgX = cur.x;
    lastSvgY = cur.y;
    const dx = lastSvgX - startSvgX;
    const dy = lastSvgY - startSvgY;
    group.setAttribute('transform', `translate(${dx} ${dy}) ${initialTransform}`.trim());
  };

  const onUp = (): void => {
    if (!dragging) return;
    dragging = false;
    group.style.cursor = 'grab';
    if (initialTransform) {
      group.setAttribute('transform', initialTransform);
    } else {
      group.removeAttribute('transform');
    }
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);

    const dx = lastSvgX - startSvgX;
    const dy = lastSvgY - startSvgY;
    const worldPos = toWorld(originPx + dx, originPz + dy);
    const cad = nearestCadSnap(worldPos.x, worldPos.z, collectPlanTargets(state, room, id), state.gridSpacingM);
    const others = collectAlignOthers(state, id);
    const guides = alignmentGuides({ x: cad.x, z: cad.z }, others);
    state.setAlignmentGuides(guides);

    if (kind === 'seat') {
      const snapped = snapSeatPosition(cad.x, cad.z);
      state.updateSeat(id, snapped, { recordHistory: false });
    } else if (kind === 'table') {
      const table = state.tables.find((t) => t.id === id);
      if (table) {
        const snapped = snapTablePosition(cad.x, cad.z, 0.05, room, table.sizeX, table.sizeZ);
        state.updateTable(id, { centerX: snapped.x, centerZ: snapped.z }, { recordHistory: false });
      }
    } else if (kind === 'rack') {
      const rack = state.racks.find((r) => r.id === id);
      if (rack) {
        const snapped = snapTablePosition(cad.x, cad.z, 0.05, room, rack.width, rack.depth);
        state.updateRack(id, { x: snapped.x, z: snapped.z }, { recordHistory: false });
      }
    } else {
      const inst = state.equipment.find((e) => e.instanceId === id);
      const product = inst ? catalog.get(inst.productId) : null;
      if (inst && product) {
        const snapped = snapEquipment(room, product, { ...inst.position, x: cad.x, z: cad.z }, inst.rotationY);
        state.updateEquipment(id, {
          position: snapped.position,
          rotationY: snapped.rotationY,
          wall: snapped.wall,
          placementMode: 'manual'
        }, { recordHistory: false });
        state.setSnapNote(`${cad.kind} · ${snapped.note}`);
      }
    }
    state.finishGesture();
  };

  handle.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (state.viewportTool === 'measure') return;
    if (state.viewportTool === 'rotate' && kind === 'table') {
      state.select('table', id);
      state.rotateSelectedTable90();
      return;
    }
    if (state.viewportTool === 'rotate' && kind === 'rack') {
      const rack = state.racks.find((r) => r.id === id);
      if (rack) {
        state.select('rack', id);
        state.updateRack(id, { rotationY: rack.rotationY + Math.PI / 2 });
      }
      return;
    }
    dragging = true;
    const start = clientToSvg(e.clientX, e.clientY);
    startSvgX = start.x;
    startSvgY = start.y;
    lastSvgX = start.x;
    lastSvgY = start.y;
    group.style.cursor = 'grabbing';
    state.prepareHistory();
    state.select(kind === 'table' ? 'table' : kind, id);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
}

function drawOpenings(svg: SVGSVGElement, room: RoomModel, w: number, d: number): void {
  room.openings.forEach((o) => {
    let x1 = 0, y1 = 0, x2 = 0, y2 = 0;
    if (o.wall === 'front') { x1 = o.offset * PX_PER_M; y1 = 0; x2 = (o.offset + o.width) * PX_PER_M; y2 = 0; }
    if (o.wall === 'back') { x1 = o.offset * PX_PER_M; y1 = d; x2 = (o.offset + o.width) * PX_PER_M; y2 = d; }
    if (o.wall === 'left') { x1 = 0; y1 = o.offset * PX_PER_M; x2 = 0; y2 = (o.offset + o.width) * PX_PER_M; }
    if (o.wall === 'right') { x1 = w; y1 = o.offset * PX_PER_M; x2 = w; y2 = (o.offset + o.width) * PX_PER_M; }
    svg.appendChild(svgEl('line', {
      x1, y1, x2, y2,
      stroke: o.kind === 'door' ? '#5a4632' : '#4a90d9',
      'stroke-width': 6
    }));
  });
}

function drawColumns(svg: SVGSVGElement, room: RoomModel, toPx: (x: number, z: number) => [number, number]): void {
  room.columns.forEach((c) => {
    const [px, pz] = toPx(c.x, c.z);
    svg.appendChild(
      svgEl('rect', {
        x: px - (c.width * PX_PER_M) / 2,
        y: pz - (c.depth * PX_PER_M) / 2,
        width: c.width * PX_PER_M,
        height: c.depth * PX_PER_M,
        fill: '#d8d5cf',
        stroke: '#9a978f'
      })
    );
  });
}

function drawDimensions(svg: SVGSVGElement, room: RoomModel, w: number, d: number, state: AppState): void {
  const widthDim = svgEl('text', { x: w / 2, y: -50, 'text-anchor': 'middle', 'font-size': 13, fill: '#1f2328' });
  widthDim.textContent = `${room.width.toFixed(2)} m`;
  widthDim.style.cursor = 'pointer';
  widthDim.addEventListener('click', (e) => {
    e.stopPropagation();
    state.select('room', 'room');
  });
  svg.appendChild(widthDim);
  svg.appendChild(svgEl('line', { x1: 0, y1: -40, x2: w, y2: -40, stroke: '#8a919c', 'stroke-width': 1 }));

  const depthDim = svgEl('text', {
    x: -50, y: d / 2, 'text-anchor': 'middle', 'font-size': 13, fill: '#1f2328',
    transform: `rotate(-90 ${-50} ${d / 2})`
  });
  depthDim.textContent = `${room.depth.toFixed(2)} m`;
  depthDim.style.cursor = 'pointer';
  depthDim.addEventListener('click', (e) => {
    e.stopPropagation();
    state.select('room', 'room');
  });
  svg.appendChild(depthDim);
  svg.appendChild(svgEl('line', { x1: -40, y1: 0, x2: -40, y2: d, stroke: '#8a919c', 'stroke-width': 1 }));
}

function drawPlanGrid(svg: SVGSVGElement, room: RoomModel, w: number, d: number, spacing: number): void {
  const step = Math.max(0.05, spacing) * PX_PER_M;
  for (let x = 0; x <= w + 0.5; x += step) {
    svg.appendChild(svgEl('line', { x1: x, y1: 0, x2: x, y2: d, stroke: '#e4e7ec', 'stroke-width': 1 }));
  }
  for (let y = 0; y <= d + 0.5; y += step) {
    svg.appendChild(svgEl('line', { x1: 0, y1: y, x2: w, y2: y, stroke: '#e4e7ec', 'stroke-width': 1 }));
  }
}

function drawAlignmentGuides(
  svg: SVGSVGElement,
  guides: AlignmentGuide[],
  toPx: (x: number, z: number) => [number, number],
  w: number,
  d: number
): void {
  guides.forEach((g) => {
    if (g.axis === 'x') {
      const [px] = toPx(g.value, 0);
      svg.appendChild(svgEl('line', { x1: px, y1: -20, x2: px, y2: d + 20, stroke: '#2f6fed', 'stroke-width': 1, 'stroke-dasharray': '4 3' }));
    } else {
      const [, pz] = toPx(0, g.value);
      svg.appendChild(svgEl('line', { x1: -20, y1: pz, x2: w + 20, y2: pz, stroke: '#2f6fed', 'stroke-width': 1, 'stroke-dasharray': '4 3' }));
    }
  });
}

function drawMeasureOverlay(svg: SVGSVGElement, state: AppState, toPx: (x: number, z: number) => [number, number]): void {
  const pts = state.measurePoints;
  pts.forEach((p) => {
    const [px, pz] = toPx(p.x, p.z);
    svg.appendChild(svgEl('circle', { cx: px, cy: pz, r: 4, fill: '#2f6fed' }));
  });
  if (pts.length === 2) {
    const [a, b] = pts;
    const [x1, y1] = toPx(a.x, a.z);
    const [x2, y2] = toPx(b.x, b.z);
    svg.appendChild(svgEl('line', { x1, y1, x2, y2, stroke: '#2f6fed', 'stroke-width': 1.5 }));
    const label = svgEl('text', {
      x: (x1 + x2) / 2,
      y: (y1 + y2) / 2 - 6,
      'text-anchor': 'middle',
      'font-size': 12,
      fill: '#1f2328'
    });
    label.textContent = `${(state.measureDistanceM ?? 0).toFixed(2)} m`;
    svg.appendChild(label);
  }
}

function collectPlanTargets(state: AppState, room: RoomModel, excludeId?: string) {
  const targets = [...roomCadTargets(room)];
  state.tables.forEach((t) => {
    if (t.id === excludeId) return;
    targets.push(...boxCadTargets(t.centerX, t.centerZ, t.sizeX, t.sizeZ));
  });
  state.racks.forEach((r) => {
    if (r.id === excludeId) return;
    targets.push(...boxCadTargets(r.x, r.z, r.width, r.depth));
  });
  state.equipment.forEach((e) => {
    if (e.instanceId === excludeId) return;
    targets.push(...boxCadTargets(e.position.x, e.position.z, 0.4, 0.4));
  });
  return targets;
}

function collectAlignOthers(state: AppState, excludeId: string): Array<{ x: number; z: number }> {
  const out: Array<{ x: number; z: number }> = [{ x: 0, z: 0 }];
  state.tables.forEach((t) => {
    if (t.id !== excludeId) out.push({ x: t.centerX, z: t.centerZ });
  });
  state.racks.forEach((r) => {
    if (r.id !== excludeId) out.push({ x: r.x, z: r.z });
  });
  state.equipment.forEach((e) => {
    if (e.instanceId !== excludeId) out.push({ x: e.position.x, z: e.position.z });
  });
  return out;
}
