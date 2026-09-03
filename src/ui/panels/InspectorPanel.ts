import type { AppState } from '../../app/AppState';
import { loadDefaultCatalog } from '../../catalog/loadCatalog';
import { snapEquipment } from '../../interaction/SnapEngine';
import { renderDisplayAnalysisControls } from './DisplayAnalysisPanel';
import { renderMicAnalysisControls } from './MicAnalysisPanel';
import { renderAudioAnalysisControls } from './AudioAnalysisPanel';
import { renderCameraAnalysisControls } from './CameraAnalysisPanel';
import { resolveInstancePorts } from '../../system/PortResolver';
import { renderRoutingMatrix } from './RoutingMatrix';
import { describePath, enumerateSignalPaths } from '../../system/SignalPathEngine';
import { conferenceClearanceM } from '../../room/FurnitureRelayout';
import { furnitureTemplate } from '../../room/FurnitureCatalog';
import {
  matchTablePreset,
  practicalSeatCapacity,
  seatsOwnedByTable,
  TABLE_PRESETS,
  type TablePresetId
} from '../../room/ParametricTable';
import { getPresentationWall } from '../../room/RoomGeometry';
import { validationReportFor } from '../../av/validation/validationCache';
import { usedRackUnits } from '../../av/AVRack';
import { renderRackScheduleSection } from './RackSchedulePanel';
import { inspectSeat } from '../../av/SeatInspection';
import { compatibleDestinations, compatibleSources, canConnectPorts } from '../../system/PortCompatibility';
import { cachedCableRoute } from '../../system/CableRouter';
import { cableRouteContext } from '../../system/cableContext';
import { cableTypeOf } from '../../system/CableBoq';
import {
  deviceSignalFlowLines,
  portConnectionRole,
  portOccupancyState
} from '../../system/ConnectionStatus';
import {
  catalogCardLine,
  deg,
  inputSummary,
  kg,
  mm,
  m,
  mountSummary,
  NOT_SPECIFIED,
  typeLabel
} from '../../catalog/CatalogPresentation';
import { evaluatePlacement } from '../../av/PlacementFeedback';
import {
  analysisSupportLine,
  catalogMountKinds,
  defaultMountingKind,
  productDescription,
  productFamily,
  type MountingKind
} from '../../catalog/CatalogEngineering';

const catalog = loadDefaultCatalog();

function metricRow(container: HTMLElement, label: string, value: string, statusEl?: HTMLElement): void {
  const row = document.createElement('div');
  row.className = 'metric-row';
  const l = document.createElement('span'); l.className = 'label'; l.textContent = label;
  const v = document.createElement('span'); v.className = 'value'; v.textContent = value;
  row.append(l, v);
  if (statusEl) row.appendChild(statusEl);
  container.appendChild(row);
}

function statusPill(status: 'pass' | 'warning' | 'fail' | 'info'): HTMLElement {
  const el = document.createElement('span');
  el.className = `status-pill ${status === 'info' ? 'info' : status}`;
  el.textContent =
    status === 'pass' ? '✓ PASS' : status === 'warning' ? '⚠ WARNING' : status === 'fail' ? '✕ ERROR' : '○ INFO';
  return el;
}

function why(container: HTMLElement, label: string, text: string): void {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'why-link';
  btn.textContent = label;
  const body = document.createElement('div');
  body.className = 'why-body';
  body.hidden = true;
  body.textContent = text;
  btn.onclick = () => {
    body.hidden = !body.hidden;
  };
  container.append(btn, body);
}

function section(container: HTMLElement, title: string, open = true): HTMLElement {
  const d = document.createElement('details');
  d.className = 'insp-section';
  d.open = open;
  const s = document.createElement('summary');
  s.textContent = title;
  const inner = document.createElement('div');
  d.append(s, inner);
  container.appendChild(d);
  return inner;
}

function selectField(
  container: HTMLElement,
  label: string,
  value: string,
  options: { value: string; label: string }[],
  onChange: (v: string) => void
): void {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const lbl = document.createElement('label');
  lbl.textContent = label;
  const input = document.createElement('select');
  options.forEach((o) => {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    if (o.value === value) opt.selected = true;
    input.appendChild(opt);
  });
  input.onchange = () => onChange(input.value);
  wrap.append(lbl, input);
  container.appendChild(wrap);
}

function numField(container: HTMLElement, label: string, value: number, step: number, onChange: (v: number) => void): void {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const lbl = document.createElement('label');
  lbl.textContent = label;
  const input = document.createElement('input');
  input.type = 'number';
  input.step = String(step);
  input.value = String(value);
  input.onchange = () => onChange(Number(input.value));
  wrap.append(lbl, input);
  container.appendChild(wrap);
}

export function renderInspectorPanel(container: HTMLElement, state: AppState): void {
  container.innerHTML = '';
  const title = document.createElement('div');
  title.className = 'nav-section-title';
  container.appendChild(title);
  const body = document.createElement('div');
  container.appendChild(body);

  if (state.selectedConnectionId) {
    title.textContent = 'CONNECTION';
    renderConnectionInspector(body, state, state.selectedConnectionId);
    return;
  }

  if (state.selection.kind === 'seat' && state.selection.id) {
    title.textContent = `SEAT ${state.selection.id}`;
    renderSeatInspector(body, state, state.selection.id);
    return;
  }

  if (state.selection.kind === 'table' && state.selection.id) {
    title.textContent = 'TABLE';
    renderTableInspector(body, state, state.selection.id);
    return;
  }

  if (state.selection.kind === 'rack' && state.selection.id) {
    title.textContent = 'AV RACK';
    renderRackInspector(body, state, state.selection.id);
    return;
  }

  if (state.selection.kind === 'equipment' && state.selection.id) {
    const inst = state.equipment.find((e) => e.instanceId === state.selection.id);
    const product = inst ? catalog.get(inst.productId) : null;
    title.textContent = (product?.category ?? 'EQUIPMENT').replace(/_/g, ' ').toUpperCase();
    renderEquipmentInspector(body, state, state.selection.id);
    return;
  }

  if (state.selection.kind === 'room') {
    title.textContent = 'ROOM';
    renderRoomInspector(body, state);
    return;
  }

  if (state.selection.kind === 'none' || !state.selection.id) {
    title.textContent = 'PROPERTIES';
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    if (!state.equipment.length) {
      empty.innerHTML = `<div class="empty-title">No project objects selected</div>
        <div class="empty-body">Create a project or open an existing design, then add AV devices from the catalog.</div>`;
    } else {
      empty.innerHTML = `<div class="empty-title">No object selected</div>
        <div class="empty-body">Select an AV device, seat, table, or rack to view its properties.</div>`;
    }
    body.appendChild(empty);
    const catalogBtn = document.createElement('button');
    catalogBtn.className = 'btn primary';
    catalogBtn.textContent = 'Browse Catalog';
    catalogBtn.onclick = () => state.setDesignTool('catalog');
    const autoBtn = document.createElement('button');
    autoBtn.className = 'btn';
    autoBtn.textContent = 'Auto Design';
    autoBtn.onclick = () => state.requestAutoDesign();
    body.append(catalogBtn, autoBtn);
    return;
  }
}

function renderRoomInspector(body: HTMLElement, state: AppState): void {
  const room = state.room;
  if (!room) return;
  const geo = section(body, 'Geometry', true);
  numField(geo, 'Width (m)', room.width, 0.1, (v) => state.setRoom({ ...room, width: v }));
  numField(geo, 'Length (m)', room.depth, 0.1, (v) => state.setRoom({ ...room, depth: v }));
  numField(geo, 'Height (m)', room.height, 0.1, (v) => state.setRoom({ ...room, height: v }));
  why(
    geo,
    'Why these dimensions?',
    'Room size is architectural. Changing it recalculates validation. Seating is not regenerated until you choose Regenerating Seating.'
  );
  const regen = document.createElement('button');
  regen.className = 'btn';
  regen.textContent = 'Regenerate Seating';
  regen.onclick = () => state.regenerateSeating();
  body.appendChild(regen);
}

function renderTableInspector(body: HTMLElement, state: AppState, tableId: string): void {
  const table = state.tables.find((t) => t.id === tableId);
  if (!table) return;
  const tmpl = furnitureTemplate(table.furnitureId ?? 'generic-conference');
  const beginner = state.uiComplexity === 'beginner';
  const owned = seatsOwnedByTable(table, state.seats, state.tables.length);
  const practical = practicalSeatCapacity(table);
  const preset = (table.presetId as TablePresetId | undefined) ?? matchTablePreset(table);

  metricRow(body, 'Type', tmpl.name);
  metricRow(
    body,
    'Dimensions',
    `${table.sizeX.toFixed(2)} Ã— ${table.sizeZ.toFixed(2)} Ã— ${(table.height ?? 0.73).toFixed(2)} m`
  );
  metricRow(body, 'Seats at this table', `${owned.length} / ${practical} practical`);
  if (state.room) {
    const clear = conferenceClearanceM(state.room, table);
    metricRow(body, 'Clearance', `${clear.toFixed(2)} m`, statusPill(clear >= 0.7 ? 'pass' : 'warning'));
  }

  why(
    body,
    'Why is this table this size?',
    'Width, depth and height are parametric. Chair positions are recomputed from usable edge length and occupant spacing â€” the mesh is not scaled independently of seating.'
  );

  const geo = section(body, 'Geometry', true);
  selectField(
    geo,
    'Preset',
    preset,
    TABLE_PRESETS.map((p) => ({ value: p.id, label: p.label })),
    (v) => state.applyTablePreset(tableId, v as TablePresetId)
  );
  numField(geo, 'Width (m)', table.sizeX, 0.05, (v) => state.updateTable(tableId, { sizeX: v }));
  numField(geo, 'Depth (m)', table.sizeZ, 0.05, (v) => state.updateTable(tableId, { sizeZ: v }));
  numField(geo, 'Height (m)', table.height ?? 0.73, 0.01, (v) => state.updateTable(tableId, { height: v }));
  selectField(
    geo,
    'Shape',
    table.shape ?? 'rect',
    [
      { value: 'rect', label: 'Rectangle' },
      { value: 'rounded_rect', label: 'Rounded rectangle' },
      { value: 'ellipse', label: 'Ellipse / round' }
    ],
    (v) => state.updateTable(tableId, { shape: v as 'rect' | 'rounded_rect' | 'ellipse' })
  );

  const place = section(body, 'Placement', !beginner);
  numField(place, 'Position X (m)', table.centerX, 0.05, (v) => state.updateTable(tableId, { centerX: v }));
  numField(place, 'Position Z (m)', table.centerZ, 0.05, (v) => state.updateTable(tableId, { centerZ: v }));
  metricRow(place, 'Orientation', table.sizeZ >= table.sizeX ? 'Long axis along room depth (Z)' : 'Long axis along room width (X)');
  const rotBtn = document.createElement('button');
  rotBtn.className = 'btn';
  rotBtn.textContent = 'Rotate 90Â°';
  rotBtn.onclick = () => state.rotateSelectedTable90();
  place.appendChild(rotBtn);

  const seating = section(body, 'Seating', true);
  numField(seating, 'Seat count', owned.length, 1, (v) => state.setTableSeatCount(tableId, v));
  metricRow(seating, 'Practical capacity', String(practical));
  metricRow(seating, 'Spacing', `${tmpl.recommendedSeatSpacing.toFixed(2)} m`);
  if (table.requestedSeats && table.requestedSeats > practical) {
    const warn = document.createElement('div');
    warn.className = 'badge-note';
    warn.textContent = `âš  ${table.requestedSeats} seats requested. This table supports about ${practical}. Increase dimensions or add another table.`;
    seating.appendChild(warn);
  }

  if (!beginner) {
    const eng = section(body, 'Engineering', true);
    metricRow(eng, 'Template', table.furnitureId ?? 'generic-conference');
    metricRow(eng, 'Chair from edge', `${tmpl.chairFromEdge} m`);
    metricRow(eng, 'Cable well', table.hasCableWell ? 'Yes' : 'No');
  }

  const val = section(body, 'Validation', true);
  const findings = validationReportFor(state).findings.filter(
    (f) => f.affectedObjects.some((o) => o.id === tableId) || f.code.startsWith('FURN')
  );
  if (!findings.length) {
    metricRow(val, 'Furniture', 'âœ“ PASS', statusPill('pass'));
  } else {
    findings.slice(0, 6).forEach((f) => {
      const sev = f.severity === 'error' ? 'fail' : f.severity === 'warning' ? 'warning' : f.severity === 'info' ? 'info' : 'pass';
      metricRow(val, f.code, f.title, statusPill(sev));
    });
  }

  const actions = document.createElement('div');
  const edit = document.createElement('button');
  edit.className = 'btn primary';
  edit.textContent = 'Edit';
  edit.onclick = () => state.setDesignTool('seating');
  const dup = document.createElement('button');
  dup.className = 'btn';
  dup.textContent = 'Duplicate';
  dup.onclick = () => state.duplicateSelectedTable();
  const align = document.createElement('button');
  align.className = 'btn';
  align.textContent = 'Align';
  align.onclick = () => state.alignSelectedTableCenter();
  const del = document.createElement('button');
  del.className = 'btn';
  del.textContent = 'Delete';
  del.onclick = () => state.deleteSelected();
  const issue = document.createElement('button');
  issue.className = 'btn';
  issue.textContent = 'View Issue';
  issue.onclick = () => state.setShellNav('validate');
  actions.append(edit, dup, align, del, issue);
  body.appendChild(actions);
}

function renderRackInspector(body: HTMLElement, state: AppState, rackId: string): void {
  const rack = state.racks.find((r) => r.id === rackId);
  if (!rack) return;
  const assigned = state.equipment
    .filter((e) => e.rackId === rack.id)
    .sort((a, b) => (a.rackPositionRU ?? 0) - (b.rackPositionRU ?? 0));
  const used = usedRackUnits(assigned);
  metricRow(body, 'Rack type', rack.kind === 'wall' ? 'Wall-mounted' : 'Floor-standing');
  metricRow(body, 'Height / RU', `${rack.ruTotal} RU Â· ${rack.height.toFixed(2)} m`);
  metricRow(body, 'Width Ã— depth', `${rack.width.toFixed(2)} Ã— ${rack.depth.toFixed(2)} m`);
  metricRow(body, 'Used RU', String(used));
  metricRow(body, 'Available RU', String(rack.ruTotal - used));
  metricRow(body, 'Front clearance', `${rack.frontClearance.toFixed(2)} m`);
  metricRow(body, 'Rear clearance', `${rack.rearClearance.toFixed(2)} m`);
  numField(body, 'Position X (m)', rack.x, 0.05, (v) => state.updateRack(rackId, { x: v }));
  numField(body, 'Position Z (m)', rack.z, 0.05, (v) => state.updateRack(rackId, { z: v }));
  numField(body, 'Rotation Y (Â°)', (rack.rotationY * 180) / Math.PI, 5, (v) =>
    state.updateRack(rackId, { rotationY: (v * Math.PI) / 180 })
  );

  const elevHost = document.createElement('div');
  body.appendChild(elevHost);
  renderRackScheduleSection(elevHost, state, rackId);

  const del = document.createElement('button');
  del.className = 'btn';
  del.textContent = 'Remove rack';
  del.onclick = () => state.deleteSelected();
  body.appendChild(del);
}

function renderSeatInspector(body: HTMLElement, state: AppState, seatId: string): void {
  const seat = state.seats.find((s) => s.id === seatId);
  if (!seat) return;

  numField(body, 'Position X (m)', seat.x, 0.05, (v) => state.updateSeat(seatId, { x: v }));
  numField(body, 'Position Z (m)', seat.z, 0.05, (v) => state.updateSeat(seatId, { z: v }));
  numField(body, 'Rotation (Â°)', (seat.facing * 180) / Math.PI, 5, (v) =>
    state.updateSeat(seatId, { facing: (v * Math.PI) / 180 })
  );

  const insp = inspectSeat(seat, state.equipment, catalog, state.room, state.tables);
  metricRow(body, 'Occupant eye height', `${insp.occupant.eyeHeightM.toFixed(2)} m`);

  if (!insp.display) {
    const note = document.createElement('div');
    note.className = 'inspector-empty';
    note.textContent = 'No display placed yet â€” add one in the Equipment step to see viewing analysis for this seat.';
    body.appendChild(note);
  } else {
    const analysis = insp.display;
    const dt = section(body, 'DISPLAY', true);
    metricRow(dt, 'Distance', `${analysis.distance.value} m`);
    metricRow(dt, 'Horizontal angle', `${analysis.horizontalAngle.value}Â°`, statusPill(analysis.horizontalAngle.status));
    metricRow(dt, 'Vertical angle', `${analysis.verticalAngle.value}Â°`, statusPill(analysis.verticalAngle.status));
    metricRow(dt, 'Viewing distance', `${analysis.viewingDistance.value} m`, statusPill(analysis.viewingDistance.status));
    metricRow(dt, 'Visibility', analysis.visibility.value.replace('_', ' '), statusPill(analysis.visibility.status));
    metricRow(dt, 'Sightline', analysis.sightline.value, statusPill(analysis.sightline.status));
    metricRow(dt, 'Status', analysis.overall.toUpperCase(), statusPill(analysis.overall));
    const overall = document.createElement('div');
    overall.className = 'badge-note';
    overall.innerHTML = `Overall: ${statusPill(analysis.overall).outerHTML}<br><br><b>Methodology:</b> ${analysis.viewingDistance.method}`;
    dt.appendChild(overall);
    if (analysis.overall !== 'pass') {
      const go = document.createElement('button');
      go.className = 'btn';
      go.textContent = 'Analyze Display';
      go.onclick = () => {
        const d = state.equipment.find((e) => catalog.get(e.productId)?.category === 'display');
        if (d) state.analyzeEquipment(d.instanceId);
      };
      dt.appendChild(go);
    }
    if (analysis.sightline.status === 'fail') {
      const blocked = document.createElement('div');
      blocked.className = 'badge-note';
      blocked.style.color = 'var(--danger)';
      blocked.textContent = analysis.sightline.method;
      dt.appendChild(blocked);
    }
  }

  const viewerBtn = document.createElement('button');
  viewerBtn.className = 'btn primary';
  viewerBtn.textContent = 'View from this seat';
  viewerBtn.onclick = () => state.enterViewerMode(seat.id);
  body.appendChild(viewerBtn);

  if (insp.mic) {
    const micR = insp.mic;
    const micSec = section(body, 'MICROPHONE', true);
    metricRow(
      micSec,
      'Pickup (geometric)',
      micR.covered
        ? `inside Â· ${micR.nearestDistanceM ?? 'â€”'} m${micR.angularDeltaDeg != null ? ` Â· ${micR.angularDeltaDeg}Â°` : ''}`
        : `outside Â· ${micR.nearestDistanceM ?? 'â€”'} m`,
      statusPill(micR.status)
    );
    const micNote = document.createElement('div');
    micNote.className = 'badge-note';
    micNote.textContent = micR.criterion;
    micSec.appendChild(micNote);
    if (micR.status !== 'pass') {
      const go = document.createElement('button');
      go.className = 'btn';
      go.textContent = 'Analyze Pickup';
      go.onclick = () => {
        const m = state.equipment.find((e) => catalog.get(e.productId)?.category === 'microphone');
        if (m) state.analyzeEquipment(m.instanceId);
      };
      micSec.appendChild(go);
    }
  }

  if (insp.speaker) {
    const audio = insp.speaker;
    const spk = section(body, 'SPEAKER', true);
    metricRow(
      spk,
      'Coverage (geometric)',
      audio.inDispersion ? 'inside dispersion' : 'outside dispersion',
      statusPill(audio.inDispersion ? (audio.status === 'fail' ? 'warning' : audio.status) : 'fail')
    );
    metricRow(
      spk,
      'Estimated SPL',
      audio.splAtSeat != null ? `${audio.splAtSeat} dB @ ${audio.distanceM ?? 'â€”'} m` : 'outside dispersion / DATA INCOMPLETE',
      statusPill(audio.status)
    );
    const audioNote = document.createElement('div');
    audioNote.className = 'badge-note';
    audioNote.textContent = 'Method: geometric / free-field estimate â€” not room-acoustic simulation.';
    spk.appendChild(audioNote);
    if (!audio.inDispersion || audio.status === 'fail') {
      const go = document.createElement('button');
      go.className = 'btn';
      go.textContent = 'Analyze Coverage';
      go.onclick = () => {
        const s = state.equipment.find((e) => catalog.get(e.productId)?.category === 'speaker');
        if (s) state.analyzeEquipment(s.instanceId);
      };
      spk.appendChild(go);
    }
  }

  if (insp.camera) {
    const cam = insp.camera;
    const camIds = cam.visible ? cam.coveringCameraIds : cam.inFov ? cam.blockingCameraIds : [];
    const camSec = section(body, 'CAMERA', true);
    metricRow(camSec, 'FOV', cam.inFov ? 'Inside catalog HFOV (geometric)' : 'Outside catalog HFOV');
    metricRow(camSec, 'Sightline', cam.sightline.toUpperCase());
    metricRow(
      camSec,
      'Coverage',
      cam.visible ? `visible Â· ${camIds.join(', ') || 'â€”'}` : cam.inFov ? `blocked Â· ${camIds.join(', ')}` : 'outside FOV',
      statusPill(cam.status)
    );
    const camNote = document.createElement('div');
    camNote.className = 'badge-note';
    camNote.textContent = 'Method: geometric frustum from catalog HFOV. Not image quality or NVR simulation.';
    camSec.appendChild(camNote);
    if (cam.status !== 'pass') {
      const go = document.createElement('button');
      go.className = 'btn';
      go.textContent = 'Analyze FOV';
      go.onclick = () => {
        const c = state.equipment.find((e) => catalog.get(e.productId)?.category === 'camera');
        if (c) state.analyzeEquipment(c.instanceId);
      };
      camSec.appendChild(go);
    }
  }
}

function renderEquipmentInspector(body: HTMLElement, state: AppState, instanceId: string): void {
  const inst = state.equipment.find((e) => e.instanceId === instanceId);
  if (!inst) return;
  const product = catalog.get(inst.productId);
  if (!product) return;

  const ident = section(body, 'IDENTITY', true);
  const identHead = document.createElement('div');
  identHead.className = 'equip-identity';
  const mfr = document.createElement('div');
  mfr.className = 'manufacturer';
  mfr.textContent = product.manufacturer;
  const model = document.createElement('div');
  model.className = 'model';
  model.textContent = product.model;
  const cat = document.createElement('div');
  cat.className = 'muted';
  cat.textContent = `${typeLabel(product)}${product.display ? ` Â· ${product.display.diagonalInches}"` : ''}`;
  identHead.append(mfr, model, cat);
  ident.appendChild(identHead);

  const prov = document.createElement('span');
  prov.className = `provenance ${product.provenance}`;
  prov.textContent = `${product.provenance.replace('_', ' ')} data`;
  ident.appendChild(prov);

  metricRow(ident, 'Manufacturer', product.manufacturer || NOT_SPECIFIED);
  metricRow(ident, 'Model', product.model || NOT_SPECIFIED);
  metricRow(ident, 'Category', product.category.replace(/_/g, ' '));
  metricRow(ident, 'Family', productFamily(product));
  metricRow(ident, 'Description', productDescription(product));
  const nameField = document.createElement('div');
  nameField.className = 'field';
  const nameLbl = document.createElement('label');
  nameLbl.textContent = 'Instance name';
  const nameIn = document.createElement('input');
  nameIn.value = inst.name;
  nameIn.onchange = () => state.updateEquipment(instanceId, { name: nameIn.value, placementMode: inst.placementMode });
  nameField.append(nameLbl, nameIn);
  ident.appendChild(nameField);

  const eng = section(body, 'ENGINEERING', true);
  const dataStatus = document.createElement('div');
  dataStatus.className = 'badge-note';
  let incomplete = false;
  if (
    product.category === 'speaker' &&
    (product.speaker?.maxSplAt1m == null ||
      (product.speaker?.dispersionDeg == null &&
        !(product.speaker?.horizontalDispersionDeg && product.speaker?.verticalDispersionDeg)))
  ) {
    incomplete = true;
    dataStatus.style.color = 'var(--warning)';
    dataStatus.textContent = 'DATA INCOMPLETE â€” speaker SPL or dispersion missing. Simulation will not invent values.';
  } else if (product.category === 'microphone' && !(product.microphone?.pickupRadiusM && product.microphone.pickupRadiusM > 0)) {
    incomplete = true;
    dataStatus.style.color = 'var(--warning)';
    dataStatus.textContent = 'DATA INCOMPLETE â€” pickupRadiusM missing.';
  } else if (product.category === 'camera' && !(product.camera?.horizontalFovDeg && product.camera.horizontalFovDeg > 0)) {
    incomplete = true;
    dataStatus.style.color = 'var(--warning)';
    dataStatus.textContent = 'DATA INCOMPLETE â€” horizontal FOV is required. Camera coverage unavailable.';
  } else if (product.category === 'display' && (!product.physical.width || !product.physical.height)) {
    incomplete = true;
    dataStatus.style.color = 'var(--warning)';
    dataStatus.textContent = 'DATA INCOMPLETE â€” display size missing.';
  } else {
    dataStatus.textContent = `DATA ${product.provenance.replace('_', ' ').toUpperCase()} â€” ${product.source ?? 'catalog record'}`;
  }
  eng.appendChild(dataStatus);
  if (incomplete) {
    why(eng, 'Why is this warning shown?', dataStatus.textContent ?? 'Required catalog engineering data is missing.');
    appendCatalogLink(eng, state);
  }
  metricRow(eng, 'Width', m(product.physical.width));
  metricRow(eng, 'Height', m(product.physical.height));
  metricRow(eng, 'Depth', m(product.physical.depth));
  metricRow(eng, 'Weight', kg(product.physical.weightKg));
  metricRow(eng, 'Catalog mounting', mountSummary(product));
  if (product.display) {
    metricRow(eng, 'Diagonal', `${product.display.diagonalInches}"`);
    metricRow(eng, 'Resolution', product.display.resolution || NOT_SPECIFIED);
    metricRow(eng, 'Aspect', product.display.aspectRatio || NOT_SPECIFIED);
    metricRow(eng, 'Brightness', product.display.brightnessNits != null ? `${product.display.brightnessNits} cd/mÂ²` : NOT_SPECIFIED);
  }
  if (product.microphone) {
    metricRow(eng, 'Pickup pattern', product.microphone.pattern || NOT_SPECIFIED);
    metricRow(
      eng,
      'Pickup radius',
      product.microphone.pickupRadiusM != null ? `${product.microphone.pickupRadiusM} m` : NOT_SPECIFIED
    );
    metricRow(eng, 'Beam width', product.microphone.beamWidthDeg != null ? `${product.microphone.beamWidthDeg}Â°` : NOT_SPECIFIED);
    metricRow(eng, 'Coverage model', product.microphone.coverageModel ?? NOT_SPECIFIED);
  }
  if (product.speaker) {
    metricRow(
      eng,
      'Max SPL @ 1 m',
      product.speaker.maxSplAt1m != null ? `${product.speaker.maxSplAt1m} dB` : NOT_SPECIFIED
    );
    metricRow(eng, 'Dispersion', product.speaker.dispersionDeg != null ? `${product.speaker.dispersionDeg}Â°` : NOT_SPECIFIED);
    metricRow(eng, 'Horizontal dispersion', deg(product.speaker.horizontalDispersionDeg));
    metricRow(eng, 'Vertical dispersion', deg(product.speaker.verticalDispersionDeg));
    metricRow(eng, 'Power', product.speaker.powerRating || NOT_SPECIFIED);
  }
  if (product.camera) {
    metricRow(eng, 'Horizontal FOV', product.camera.horizontalFovDeg != null ? deg(product.camera.horizontalFovDeg) : NOT_SPECIFIED);
    metricRow(eng, 'Vertical FOV', deg(product.camera.verticalFovDeg));
  }
  if (product.rackUnits != null) metricRow(eng, 'Catalog RU', `${product.rackUnits} RU`);
  metricRow(eng, 'Analysis', analysisSupportLine(product));

  const pose = section(body, 'PLACEMENT', true);
  if (product.category === 'display' && state.room) {
    why(
      pose,
      'Why is the display here?',
      `The ${getPresentationWall(state.room)} wall is the presentation span. Suggested placement stays off door and window exclusion zones.`
    );
  }
  const placeNote = evaluatePlacement(state.room, state.tables, product, inst.position);
  const placeEl = document.createElement('div');
  placeEl.className = 'badge-note';
  placeEl.style.color = placeNote.status === 'valid' ? 'var(--success)' : placeNote.status === 'invalid' ? 'var(--danger, #b42318)' : 'var(--warning)';
  placeEl.textContent = placeNote.note;
  pose.appendChild(placeEl);
  numField(pose, 'X (m)', inst.position.x, 0.01, (v) =>
    state.updateEquipment(instanceId, { position: { ...inst.position, x: v } })
  );
  numField(pose, 'Y (m)', inst.position.y, 0.01, (v) =>
    state.updateEquipment(instanceId, { position: { ...inst.position, y: v } })
  );
  numField(pose, 'Z (m)', inst.position.z, 0.01, (v) =>
    state.updateEquipment(instanceId, { position: { ...inst.position, z: v } })
  );
  numField(pose, 'Rotation Y (Â°)', (inst.rotationY * 180) / Math.PI, 5, (v) =>
    state.updateEquipment(instanceId, { rotationY: (v * Math.PI) / 180 })
  );
  const kinds = catalogMountKinds(product);
  metricRow(pose, 'Mounting type', (inst.mountingKind ?? defaultMountingKind(product)).replace(/_/g, ' '));
  if (kinds.length > 1) {
    selectField(
      pose,
      'Project mounting',
      inst.mountingKind ?? defaultMountingKind(product),
      kinds.map((k) => ({ value: k, label: k })),
      (v) => state.updateEquipment(instanceId, { mountingKind: v as MountingKind })
    );
  }

  const origin = inst.origin === 'auto' && inst.placementMode !== 'manual' ? 'AUTO' : inst.placementMode === 'manual' || inst.origin === 'manual' ? 'MANUAL OVERRIDE' : inst.placementMode === 'smart' ? 'SMART' : '';
  if (origin) {
    const originNote = document.createElement('div');
    originNote.className = 'badge-note';
    originNote.style.color = origin === 'MANUAL OVERRIDE' ? 'var(--warning)' : 'var(--success)';
    originNote.textContent =
      origin === 'AUTO'
        ? 'Placement: AUTO â€” generated starting position. Analysis uses this geometry.'
        : origin === 'SMART'
          ? 'Placement: SMART â€” catalog suggestion engine. Analysis uses this geometry.'
          : 'Placement: MANUAL OVERRIDE â€” analysis uses this position. Auto Design will not move it silently.';
    pose.appendChild(originNote);
  }

  const snapBtn = document.createElement('button');
  snapBtn.className = 'btn';
  snapBtn.textContent = 'Snap to valid surface';
  snapBtn.onclick = () => {
    if (!state.room) return;
    const snapped = snapEquipment(state.room, product, inst.position, inst.rotationY);
    state.updateEquipment(instanceId, {
      position: snapped.position,
      rotationY: snapped.rotationY,
      wall: snapped.wall,
      placementMode: 'manual'
    });
    state.setSnapNote(snapped.note);
  };
  pose.appendChild(snapBtn);

  const sys = section(body, 'SYSTEM', true);
  const ports = resolveInstancePorts(inst.instanceId, inst.productId, catalog);
  const inputs = ports.filter((p) => p.direction === 'input' || p.direction === 'bidirectional').length;
  const outputs = ports.filter((p) => p.direction === 'output' || p.direction === 'bidirectional').length;
  const linked = state.connections.filter((c) => c.fromInstanceId === inst.instanceId || c.toInstanceId === inst.instanceId);
  metricRow(sys, 'Inputs', String(inputs));
  metricRow(sys, 'Outputs', String(outputs));
  metricRow(sys, 'Connections', String(linked.length));

  if (state.lastSystemError) {
    const err = document.createElement('div');
    err.className = 'badge-note';
    err.style.color = 'var(--danger)';
    err.textContent = state.lastSystemError;
    sys.appendChild(err);
  }
  if (state.systemConnectFrom) {
    const fromEq = state.equipment.find((e) => e.instanceId === state.systemConnectFrom!.instanceId);
    const banner = document.createElement('div');
    banner.className = 'badge-note';
    banner.textContent = `Connecting from ${fromEq?.name ?? 'device'}… select a compatible port, or cancel.`;
    const cancel = document.createElement('button');
    cancel.className = 'btn';
    cancel.textContent = 'Cancel connect';
    cancel.onclick = () => state.setSystemConnectFrom(null);
    sys.append(banner, cancel);
  }

  if (state.racks.length) {
    const rackSel = document.createElement('select');
    const none = document.createElement('option');
    none.value = '';
    none.textContent = 'Not in rack';
    rackSel.appendChild(none);
    state.racks.forEach((r) => {
      const o = document.createElement('option');
      o.value = r.id;
      o.textContent = `${r.id} (${r.ruTotal} RU)`;
      if (inst.rackId === r.id) o.selected = true;
      rackSel.appendChild(o);
    });
    rackSel.onchange = () => state.assignEquipmentToRack(instanceId, rackSel.value || null);
    const wrap = document.createElement('div');
    wrap.className = 'field';
    const lab = document.createElement('label');
    lab.textContent = 'Rack';
    wrap.append(lab, rackSel);
    sys.appendChild(wrap);
    if (inst.rackId) {
      numField(sys, 'Position (RU)', inst.rackPositionRU ?? 1, 1, (v) =>
        state.updateEquipment(instanceId, { rackPositionRU: Math.max(1, Math.round(v)) })
      );
      if (product.rackUnits != null) {
        metricRow(sys, 'Size', `${product.rackUnits} RU`);
      } else {
        numField(sys, 'Size (RU)', inst.rackUnits ?? 0, 1, (v) => {
          const n = Math.round(v);
          state.updateEquipment(instanceId, { rackUnits: n > 0 ? n : undefined });
        });
        if (inst.rackUnits == null) metricRow(sys, 'Size', NOT_SPECIFIED);
      }
    }
  }

  if (!ports.length) {
    const miss = document.createElement('div');
    miss.className = 'badge-note';
    miss.style.color = 'var(--warning)';
    miss.textContent = 'DATA INCOMPLETE — no catalog ports. System connections cannot be drawn.';
    sys.appendChild(miss);
  } else {
    const connHead = document.createElement('div');
    connHead.className = 'nav-section-title';
    connHead.textContent = 'CONNECTIONS';
    sys.appendChild(connHead);
    const others = state.equipment.flatMap((e) =>
      e.instanceId === inst.instanceId ? [] : resolveInstancePorts(e.instanceId, e.productId, catalog)
    );
    const connectFromEq = state.systemConnectFrom
      ? state.equipment.find((e) => e.instanceId === state.systemConnectFrom!.instanceId)
      : undefined;
    const connectFrom = connectFromEq
      ? resolveInstancePorts(connectFromEq.instanceId, connectFromEq.productId, catalog).find(
          (p) => p.id === state.systemConnectFrom!.portId
        )
      : undefined;
    ports.forEach((p) => {
      const occ = portOccupancyState(p, state.connections);
      const role = portConnectionRole(p);
      const link = state.connections.find(
        (c) =>
          (c.fromInstanceId === inst.instanceId && c.fromPortId === p.id) ||
          (c.toInstanceId === inst.instanceId && c.toPortId === p.id)
      );
      let partner = 'Available';
      if (link) {
        const otherId = link.fromInstanceId === inst.instanceId ? link.toInstanceId : link.fromInstanceId;
        const otherPortId = link.fromInstanceId === inst.instanceId ? link.toPortId : link.fromPortId;
        const other = state.equipment.find((e) => e.instanceId === otherId);
        const otherPort = other
          ? resolveInstancePorts(other.instanceId, other.productId, catalog).find((x) => x.id === otherPortId)
          : undefined;
        partner = `← ${other?.name ?? otherId} ${otherPort?.label ?? otherPortId}`;
      }
      const mark = occ === 'connected' ? '✓' : role === 'required' ? '○' : '○';
      const hint =
        connectFrom && connectFrom.instanceId !== p.instanceId
          ? canConnectPorts(connectFrom, p).ok || canConnectPorts(p, connectFrom).ok
            ? ' ✓ compatible'
            : ' ✕ incompatible'
          : '';
      metricRow(
        sys,
        p.label,
        state.systemDetailMode === 'pro'
          ? `${mark} ${partner} · ${p.direction} · ${p.signalTypes.join('/')} · ${p.connector} · ${role}${hint}`
          : `${mark} ${partner}${hint}`
      );
      const actions = document.createElement('div');
      actions.style.display = 'flex';
      actions.style.gap = '6px';
      actions.style.flexWrap = 'wrap';
      if (link) {
        const disc = document.createElement('button');
        disc.className = 'btn';
        disc.textContent = 'Disconnect';
        disc.onclick = () => state.removeConnection(link.id);
        const show = document.createElement('button');
        show.className = 'btn';
        show.textContent = 'Show route';
        show.onclick = () => state.showConnectionRoute(link.id);
        actions.append(disc, show);
      } else {
        const connectBtn = document.createElement('button');
        connectBtn.className = 'btn primary';
        connectBtn.textContent = 'Connect';
        connectBtn.onclick = () => {
          if (state.systemConnectFrom && state.systemConnectFrom.instanceId !== p.instanceId) {
            const from = state.systemConnectFrom;
            const a = canConnectPorts(
              resolveInstancePorts(
                from.instanceId,
                state.equipment.find((e) => e.instanceId === from.instanceId)!.productId,
                catalog
              ).find((x) => x.id === from.portId)!,
              p
            );
            if (a.ok) state.addConnection(from.instanceId, from.portId, p.instanceId, p.id);
            else state.addConnection(p.instanceId, p.id, from.instanceId, from.portId);
            return;
          }
          state.setSystemConnectFrom({ instanceId: p.instanceId, portId: p.id });
        };
        actions.appendChild(connectBtn);
        const partners =
          p.direction === 'input' ? compatibleSources(p, others, state.connections) : compatibleDestinations(p, others, state.connections);
        if (partners.length) {
          const wrap = document.createElement('div');
          wrap.className = 'field';
          const sel = document.createElement('select');
          const ph = document.createElement('option');
          ph.value = '';
          ph.textContent = p.direction === 'input' ? `Connect source to ${p.label}…` : `Connect ${p.label} to…`;
          sel.appendChild(ph);
          partners.forEach((d) => {
            const eq = state.equipment.find((e) => e.instanceId === d.instanceId);
            const o = document.createElement('option');
            o.value = `${d.instanceId}::${d.id}`;
            o.textContent = `${eq?.name ?? d.instanceId} · ${d.label}`;
            sel.appendChild(o);
          });
          sel.onchange = () => {
            const [otherId, otherPort] = sel.value.split('::');
            if (!otherId || !otherPort) return;
            if (p.direction === 'input') state.addConnection(otherId, otherPort, p.instanceId, p.id);
            else state.addConnection(p.instanceId, p.id, otherId, otherPort);
          };
          wrap.appendChild(sel);
          actions.appendChild(wrap);
        }
      }
      sys.appendChild(actions);
    });
  }
  if (linked.length) {
    const flowHead = document.createElement('div');
    flowHead.className = 'nav-section-title';
    flowHead.textContent = 'SIGNAL FLOW';
    sys.appendChild(flowHead);
    deviceSignalFlowLines(inst.instanceId, state.equipment, state.connections, catalog, state.routes).forEach((line) => {
      const note = document.createElement('div');
      note.className = 'badge-note';
      note.textContent = line;
      sys.appendChild(note);
    });
    const showAll = document.createElement('button');
    showAll.className = 'btn';
    showAll.textContent = state.showCableRoutes ? 'Hide all cable routes' : 'Show cable routes in room';
    showAll.onclick = () => state.setShowCableRoutes(!state.showCableRoutes);
    sys.appendChild(showAll);
  }

  renderRoutingMatrix(sys, state, inst.instanceId);

  const paths = enumerateSignalPaths(state.equipment, state.connections, catalog, state.routes).filter((p) =>
    p.hops.some((h) => h.instanceId === inst.instanceId)
  );
  if (paths.length) {
    paths.slice(0, 4).forEach((p) => {
      const box = document.createElement('div');
      box.className = 'badge-note';
      const rows = describePath(p, state.equipment, state.connections);
      box.innerHTML =
        `<b>${p.signalType}</b> ${p.complete ? '✓ Complete' : '✕ Broken'}<br>` +
        rows.map((r) => (r.kind === 'cable' ? `&nbsp;&nbsp;↓ ${r.text}` : r.text)).join('<br>');
      if (!p.complete && p.breakReason) box.innerHTML += `<br>${p.breakReason}`;
      sys.appendChild(box);
    });
  }

  const analysis = section(body, 'ANALYSIS', true);
  if (['display', 'camera', 'speaker', 'microphone'].includes(product.category)) {
    const analyze = document.createElement('button');
    analyze.className = 'btn primary';
    analyze.textContent = 'Analyze';
    analyze.onclick = () => state.analyzeEquipment(instanceId);
    analysis.appendChild(analyze);
    metricRow(analysis, 'Model', analysisSupportLine(product));
  }
  if (product.category === 'display') {
    renderDisplayAnalysisControls(analysis, state);
  }
  if (product.category === 'microphone') {
    renderMicAnalysisControls(analysis, state);
  }
  if (product.category === 'speaker') {
    renderAudioAnalysisControls(analysis, state);
  }
  if (product.category === 'camera') {
    renderCameraAnalysisControls(analysis, state);
  }

  const val = section(body, 'VALIDATION', true);
  const findings = validationReportFor(state).findings.filter(
    (f) => f.objectId === instanceId || f.affectedObjects.some((o) => o.id === instanceId) || f.code.startsWith('EQUIP')
  );
  if (!findings.length) {
    metricRow(val, 'Status', '✓ No equipment findings', statusPill('pass'));
  } else {
    findings.slice(0, 8).forEach((f) => {
      const sev = f.severity === 'error' ? 'fail' : f.severity === 'warning' ? 'warning' : f.severity === 'info' ? 'info' : 'pass';
      metricRow(val, f.code, f.title, statusPill(sev));
    });
  }

  if (state.workspaceMode === 'system') {
    const roomBtn = document.createElement('button');
    roomBtn.className = 'btn';
    roomBtn.textContent = 'View in Room';
    roomBtn.onclick = () => state.viewInRoom();
    body.appendChild(roomBtn);
  }

  const delBtn = document.createElement('button');
  delBtn.className = 'btn';
  delBtn.textContent = 'Remove';
  delBtn.onclick = () => state.removeEquipment(inst.instanceId);
  body.appendChild(delBtn);
}

function appendCatalogLink(body: HTMLElement, state: AppState): void {
  const btn = document.createElement('button');
  btn.className = 'btn';
  btn.textContent = 'Edit Catalog';
  btn.onclick = () => state.setDesignTool('catalog');
  body.appendChild(btn);
}

function renderConnectionInspector(body: HTMLElement, state: AppState, id: string): void {
  const c = state.connections.find((x) => x.id === id);
  if (!c) return;
  const src = state.equipment.find((e) => e.instanceId === c.fromInstanceId);
  const dst = state.equipment.find((e) => e.instanceId === c.toInstanceId);
  const srcPort = src ? resolveInstancePorts(src.instanceId, src.productId, catalog).find((p) => p.id === c.fromPortId) : undefined;
  const dstPort = dst ? resolveInstancePorts(dst.instanceId, dst.productId, catalog).find((p) => p.id === c.toPortId) : undefined;
  const route = cachedCableRoute(c, cableRouteContext(state, catalog));
  metricRow(body, 'Source', src ? `${src.name} · ${srcPort?.label ?? c.fromPortId}` : c.fromInstanceId);
  metricRow(body, 'Destination', dst ? `${dst.name} · ${dstPort?.label ?? c.toPortId}` : c.toInstanceId);
  metricRow(body, 'Signal', c.signalType);
  metricRow(body, 'Cable', cableTypeOf(c));
  metricRow(body, 'Transport', c.transport);
  metricRow(body, 'Route length', `${route.totalLength.toFixed(2)} m (${route.segments.length} segments)`);
  metricRow(body, 'Path type', route.pathType);
  const limit = state.cableLengthLimitsM[cableTypeOf(c)];
  metricRow(body, 'Length check', limit == null ? 'No configured limit' : route.totalLength > limit ? `Exceeds ${limit} m` : `Within ${limit} m`);
  metricRow(
    body,
    'Status',
    route.status === 'clear'
      ? '✓ Connected · route clear'
      : route.status === 'intersects-obstacle'
        ? '⚠ Compatible but route intersects obstacle'
        : '○ Route estimate without room geometry'
  );
  const cableSel = document.createElement('select');
  const media = ['HDMI', 'DisplayPort', 'USB', 'USB-C', 'Cat6', 'Cat6A', 'Audio', 'Speaker', 'XLR', 'TRS', 'Fiber', 'Control'] as const;
  media.forEach((m) => {
    const o = document.createElement('option');
    o.value = m;
    o.textContent = m;
    if (cableTypeOf(c) === m) o.selected = true;
    cableSel.appendChild(o);
  });
  cableSel.onchange = () => state.updateConnectionCableType(c.id, cableSel.value as typeof media[number]);
  const cableWrap = document.createElement('div');
  cableWrap.className = 'field';
  const cableLab = document.createElement('label');
  cableLab.textContent = 'Cable type';
  cableWrap.append(cableLab, cableSel);
  body.appendChild(cableWrap);
  const srcBtn = document.createElement('button');
  srcBtn.className = 'btn';
  srcBtn.textContent = 'Focus Source';
  srcBtn.onclick = () => state.focusConnectionEndpoint('source');
  const dstBtn = document.createElement('button');
  dstBtn.className = 'btn';
  dstBtn.textContent = 'Focus Destination';
  dstBtn.onclick = () => state.focusConnectionEndpoint('destination');
  const show = document.createElement('button');
  show.className = 'btn primary';
  show.textContent = 'Show Route';
  show.onclick = () => state.showConnectionRoute(c.id);
  body.append(srcBtn, dstBtn, show);
  const disc = document.createElement('button');
  disc.className = 'btn';
  disc.textContent = 'Disconnect';
  disc.onclick = () => state.removeConnection(c.id);
  body.appendChild(disc);
}
