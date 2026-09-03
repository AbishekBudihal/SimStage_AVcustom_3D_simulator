/**
 * SystemCanvas.ts
 * Professional signal-flow editor. Same equipment instances as 3D/Plan.
 */

import type { AppState } from '../../app/AppState';
import { loadDefaultCatalog } from '../../catalog/loadCatalog';
import { canConnectPorts } from '../../system/PortCompatibility';
import { resolveInstancePorts } from '../../system/PortResolver';
import { enumerateSignalPaths, pathLabel } from '../../system/SignalPathEngine';
import { NODE_W, nodeHeight, orthoPath, disciplineForCategory } from '../../system/SystemLayout';
import type { ResolvedPort } from '../../system/SystemTypes';
import { validationReportFor } from '../../av/validation/validationCache';

const catalog = loadDefaultCatalog();

export function renderSystemCanvas(container: HTMLElement, state: AppState): void {
  container.innerHTML = '';
  container.className = 'system-canvas-host';

  if (!state.equipment.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = `<div class="empty-title">No devices in the project</div>
      <div class="empty-body">Add catalog equipment from Design or the System library. Topology is not tied to seat count.</div>`;
    container.appendChild(empty);
    return;
  }

  if (state.equipment.some((e) => !state.systemLayout[e.instanceId])) {
    state.ensureSystemLayout();
    return;
  }

  container.appendChild(renderToolbar(state));
  if (!state.connections.length) {
    const emptyCx = document.createElement('div');
    emptyCx.className = 'empty-state';
    emptyCx.innerHTML = `<div class="empty-title">No system connections yet</div>
      <div class="empty-body">Connect device ports to build the AV system. Routes are estimated, not measured cable pulls.</div>`;
    container.appendChild(emptyCx);
  }

  const stage = document.createElement('div');
  stage.className = 'system-stage';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'system-svg');
  let pan = { ...state.systemPan };
  let zoom = state.systemZoom;
  const applyView = (): void => {
    svg.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
    svg.style.transformOrigin = '0 0';
  };
  applyView();

  const q = state.systemSearch.trim().toLowerCase();
  const visible = state.equipment.filter((inst) => {
    if (!q) return true;
    const product = catalog.get(inst.productId);
    const ports = resolveInstancePorts(inst.instanceId, inst.productId, catalog);
    const hay = `${inst.name} ${product?.manufacturer ?? ''} ${product?.model ?? ''} ${product?.category ?? ''} ${ports.map((p) => p.label).join(' ')}`.toLowerCase();
    return hay.includes(q);
  });
  const hiddenIds = new Set(state.equipment.filter((e) => !visible.includes(e)).map((e) => e.instanceId));
  state.systemGroups.filter((g) => g.collapsed).forEach((g) => g.memberIds.forEach((id) => hiddenIds.add(id)));

  const maxX = Math.max(...visible.map((e) => (state.systemLayout[e.instanceId]?.x ?? 0) + NODE_W), 900);
  const maxY = Math.max(
    ...visible.map((e) => {
      const ports = resolveInstancePorts(e.instanceId, e.productId, catalog);
      const rows = Math.max(
        1,
        ports.filter((p) => p.direction !== 'output').length,
        ports.filter((p) => p.direction !== 'input').length
      );
      return (state.systemLayout[e.instanceId]?.y ?? 0) + nodeHeight(rows);
    }),
    640
  );
  svg.setAttribute('width', String(maxX + 120));
  svg.setAttribute('height', String(maxY + 120));

  const discX = new Map<string, number>();
  visible.forEach((inst) => {
    const disc = disciplineForCategory(catalog.get(inst.productId)?.category ?? '');
    const x = state.systemLayout[inst.instanceId]?.x ?? 0;
    if (!discX.has(disc) || x < (discX.get(disc) ?? 0)) discX.set(disc, x);
  });
  discX.forEach((x, label) => {
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.setAttribute('x', String(x));
    t.setAttribute('y', '16');
    t.setAttribute('class', 'sys-wire-label');
    t.textContent = label.toUpperCase();
    svg.appendChild(t);
  });

  state.connections.forEach((c, cIdx) => {
    if (hiddenIds.has(c.fromInstanceId) || hiddenIds.has(c.toInstanceId)) return;
    const cableId = `C-${String(cIdx + 1).padStart(3, '0')}`;
    const muted = state.systemFilter !== 'all' && c.signalType !== state.systemFilter;
    const a = portAnchor(state, c.fromInstanceId, c.fromPortId, 'out');
    const b = portAnchor(state, c.toInstanceId, c.toPortId, 'in');
    if (!a || !b) return;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', orthoPath(a.x, a.y, b.x, b.y));
    const sel = state.selectedConnectionId === c.id || state.highlightedConnectionIds.includes(c.id);
    path.setAttribute('class', `sys-wire sig-${c.signalType}${muted ? ' muted' : ''}${sel ? ' selected' : ''}`);
    path.setAttribute(
      'title',
      `${cableId} | ${c.signalType} · ${labelPort(state, c.fromInstanceId, c.fromPortId)} → ${labelPort(state, c.toInstanceId, c.toPortId)} · Transport ${c.transport} · ${c.physicalMedium}`
    );
    path.onclick = (ev) => {
      ev.stopPropagation();
      state.selectConnection(c.id);
    };
    svg.appendChild(path);
    if (state.systemDetailMode === 'pro' || state.systemCanvasMode === 'schematic') {
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('x', String((a.x + b.x) / 2));
      t.setAttribute('y', String((a.y + b.y) / 2 - 6));
      t.setAttribute('class', 'sys-wire-label');
      t.textContent = state.systemDetailMode === 'beginner' ? `${cableId} ${c.physicalMedium}` : `${cableId} ${c.physicalMedium} · ${c.signalType}`;
      svg.appendChild(t);
    }
  });

  visible.forEach((inst) => {
    if (hiddenIds.has(inst.instanceId)) return;
    svg.appendChild(renderNode(state, inst.instanceId));
  });

  const marquee = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  marquee.setAttribute('class', 'sys-marquee');
  marquee.style.display = 'none';
  svg.appendChild(marquee);

  let box: { x: number; y: number; w: number; h: number } | null = null;
  let draggingPan: { x: number; y: number; px: number; py: number } | null = null;
  stage.addEventListener(
    'wheel',
    (ev) => {
      ev.preventDefault();
      zoom = Math.min(2, Math.max(0.4, zoom + (ev.deltaY < 0 ? 0.08 : -0.08)));
      applyView();
    },
    { passive: false }
  );
  stage.addEventListener('pointerdown', (ev) => {
    if (ev.button === 1 || ev.altKey) {
      draggingPan = { x: pan.x, y: pan.y, px: ev.clientX, py: ev.clientY };
      stage.setPointerCapture(ev.pointerId);
      return;
    }
    if ((ev.target as Element).closest('.sys-node') || (ev.target as Element).closest('.sys-wire')) return;
    box = { x: ev.offsetX, y: ev.offsetY, w: 0, h: 0 };
  });
  stage.addEventListener('pointermove', (ev) => {
    if (draggingPan) {
      pan = { x: draggingPan.x + ev.clientX - draggingPan.px, y: draggingPan.y + ev.clientY - draggingPan.py };
      applyView();
      return;
    }
    if (!box) return;
    box.w = ev.offsetX - box.x;
    box.h = ev.offsetY - box.y;
    marquee.style.display = '';
    marquee.setAttribute('x', String(Math.min(box.x, box.x + box.w)));
    marquee.setAttribute('y', String(Math.min(box.y, box.y + box.h)));
    marquee.setAttribute('width', String(Math.abs(box.w)));
    marquee.setAttribute('height', String(Math.abs(box.h)));
  });
  stage.addEventListener('pointerup', (ev) => {
    if (draggingPan) {
      draggingPan = null;
      state.setSystemView(pan, zoom);
      return;
    }
    if (box && Math.abs(box.w) > 8 && Math.abs(box.h) > 8) {
      const x0 = Math.min(box.x, box.x + box.w);
      const y0 = Math.min(box.y, box.y + box.h);
      const x1 = Math.max(box.x, box.x + box.w);
      const y1 = Math.max(box.y, box.y + box.h);
      const hits = visible.filter((e) => {
        const p = state.systemLayout[e.instanceId];
        return p && p.x >= x0 && p.y >= y0 && p.x <= x1 && p.y <= y1;
      });
      if (hits[0]) {
        state.select('equipment', hits[0].instanceId);
        hits.slice(1).forEach((h) => state.select('equipment', h.instanceId, true));
      }
    } else if (!(ev.target as Element).closest('.sys-node') && !(ev.target as Element).closest('.sys-wire')) {
      if (state.systemConnectFrom) state.setSystemConnectFrom(null);
      else {
        state.selectConnection(null);
        state.select('none', null);
      }
    }
    box = null;
    marquee.style.display = 'none';
  });

  stage.appendChild(svg);
  container.appendChild(stage);
  container.appendChild(renderFooter(state));
}

function renderToolbar(state: AppState): HTMLElement {
  const toolbar = document.createElement('div');
  toolbar.className = 'system-canvas-toolbar';
  const report = validationReportFor(state);
  const status = document.createElement('span');
  status.className = 'system-status';
  status.textContent = `SYSTEM  ${state.connections.length} cx   ⚠ ${report.summary.warningCount}   ✕ ${report.summary.errorCount}`;
  status.title = 'Issue counts — not a scored percentage';
  const search = document.createElement('input');
  search.className = 'system-search';
  search.placeholder = 'Search HDMI, Q-SYS, Display…';
  search.value = state.systemSearch;
  search.oninput = () => state.setSystemSearch(search.value);
  toolbar.append(
    status,
    search,
    mkBtn('Auto Layout', () => state.autoLayoutSystem()),
    mkBtn('Group', () => state.groupSelected()),
    mkBtn('Validate', () => state.setWorkspaceMode('validate')),
    mkBtn('Diagram', () => state.setSystemPhysicalView(false), !state.systemPhysicalView),
    mkBtn('Room routes', () => {
      state.setShowCableRoutes(true);
      state.setSystemPhysicalView(true);
    }, state.systemPhysicalView),
    mkBtn('Edit', () => state.setSystemCanvasMode('edit'), state.systemCanvasMode === 'edit'),
    mkBtn('Labeled', () => state.setSystemCanvasMode('schematic'), state.systemCanvasMode === 'schematic'),
    mkBtn('Beginner', () => state.setSystemDetailMode('beginner'), state.systemDetailMode === 'beginner'),
    mkBtn('Pro', () => state.setSystemDetailMode('pro'), state.systemDetailMode === 'pro')
  );
  if (state.selectedEquipmentIds().length >= 2) {
    toolbar.append(mkBtn('Align', () => state.applySystemAlign('left')));
  }
  if (state.lastSystemError) {
    const err = document.createElement('span');
    err.className = 'system-error';
    err.textContent = state.lastSystemError;
    toolbar.appendChild(err);
  }
  return toolbar;
}

function renderFooter(state: AppState): HTMLElement {
  const foot = document.createElement('div');
  foot.className = 'system-footer';
  const legend = document.createElement('div');
  legend.className = 'system-legend';
  (['all', 'VIDEO', 'AUDIO', 'USB', 'NETWORK', 'CONTROL'] as const).forEach((id) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'legend-chip' + (state.systemFilter === id ? ' active' : '') + (id === 'all' ? '' : ` sig-${id}`);
    b.textContent = id === 'all' ? 'All' : id;
    b.onclick = () => state.setSystemFilter(id);
    legend.appendChild(b);
  });
  const hint = document.createElement('span');
  hint.className = 'muted';
  hint.textContent = 'Alt-drag pan · wheel zoom · click wire · Delete disconnects';
  foot.append(legend, hint);
  const paths = enumerateSignalPaths(state.equipment, state.connections, catalog, state.routes);
  if (paths.length && state.systemCanvasMode !== 'schematic') {
    const list = document.createElement('div');
    list.className = 'signal-path-list';
    paths.slice(0, 6).forEach((p) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'path-row' + (p.complete ? '' : ' broken');
      row.textContent = `${p.complete ? '✓' : '✕'} ${p.signalType}: ${pathLabel(p, state.equipment)}`;
      row.onclick = () => {
        state.highlightedConnectionIds = p.connectionIds;
        state.selectedPathId = p.id;
        if (p.hops[0]) state.select('equipment', p.hops[0].instanceId);
      };
    list.appendChild(row);
    });
    foot.appendChild(list);
  }
  return foot;
}

function renderNode(state: AppState, instanceId: string): SVGGElement {
  const inst = state.equipment.find((e) => e.instanceId === instanceId)!;
  const product = catalog.get(inst.productId);
  const pos = state.systemLayout[instanceId] ?? { x: 40, y: 40 };
  const ports = resolveInstancePorts(inst.instanceId, inst.productId, catalog);
  const inputs = ports.filter((p) => p.direction === 'input' || p.direction === 'bidirectional');
  const outputs = ports.filter((p) => p.direction === 'output' || p.direction === 'bidirectional');
  const h = nodeHeight(Math.max(inputs.length, outputs.length, 1));
  const cat = product?.category ?? 'other';
  const selected = state.selectedEquipmentIds().includes(instanceId);
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('class', `sys-node cat-${cat}${selected ? ' selected' : ''}`);
  g.setAttribute('transform', `translate(${pos.x}, ${pos.y})`);

  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('width', String(NODE_W));
  rect.setAttribute('height', String(h));
  rect.setAttribute('rx', '5');
  g.appendChild(rect);
  const bar = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bar.setAttribute('class', 'sys-cat-bar');
  bar.setAttribute('width', '4');
  bar.setAttribute('height', String(h));
  g.appendChild(bar);

  addText(g, '12', '14', 'sys-node-sub', (product?.manufacturer ?? '').slice(0, 28));
  addText(g, '12', '30', 'sys-node-title', inst.name.slice(0, 26));
  addText(g, '12', '44', 'sys-node-cat', (product?.category ?? 'device').toUpperCase());
  if (inst.rackId) addText(g, '140', '44', 'sys-node-sub', `RACK ${inst.rackId}`);
  if (product?.provenance === 'user_defined') addText(g, '140', '14', 'sys-node-sub', '★ CUSTOM');
  if (!ports.length) addText(g, '12', '64', 'sys-node-warn', 'DATA INCOMPLETE');

  if (state.systemCanvasMode !== 'schematic') {
    inputs.forEach((p, i) => g.appendChild(portHandle(state, p, 0, 58 + i * 18, 'in')));
    outputs.forEach((p, i) => g.appendChild(portHandle(state, p, NODE_W, 58 + i * 18, 'out')));
    inputs.forEach((p, i) => addText(g, '12', String(62 + i * 18), 'sys-port-label', p.label));
    outputs.forEach((p, i) => {
      const t = addText(g, String(NODE_W - 12), String(62 + i * 18), 'sys-port-label', p.label);
      t.setAttribute('text-anchor', 'end');
    });
  }

  let drag: { dx: number; dy: number; moved: boolean } | null = null;
  g.addEventListener('pointerdown', (ev) => {
    if ((ev.target as Element).getAttribute('data-port')) return;
    ev.stopPropagation();
    const cur = state.systemLayout[instanceId] ?? pos;
    drag = { dx: ev.clientX - cur.x, dy: ev.clientY - cur.y, moved: false };
    g.setPointerCapture(ev.pointerId);
  });
  g.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    drag.moved = true;
    g.setAttribute('transform', `translate(${ev.clientX - drag.dx}, ${ev.clientY - drag.dy})`);
  });
  g.addEventListener('pointerup', (ev) => {
    if (!drag) return;
    const x = ev.clientX - drag.dx;
    const y = ev.clientY - drag.dy;
    const moved = drag.moved;
    drag = null;
    if (moved && state.systemCanvasMode === 'edit') state.setSystemNodePos(instanceId, x, y);
    else state.select('equipment', instanceId, ev.shiftKey);
  });
  return g;
}

function addText(g: SVGGElement, x: string, y: string, cls: string, text: string): SVGTextElement {
  const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  t.setAttribute('x', x);
  t.setAttribute('y', y);
  t.setAttribute('class', cls);
  t.textContent = text;
  g.appendChild(t);
  return t;
}

function portHandle(state: AppState, port: ResolvedPort, x: number, y: number, side: 'in' | 'out'): SVGCircleElement {
  const connected = state.connections.some(
    (c) =>
      (c.fromInstanceId === port.instanceId && c.fromPortId === port.id) ||
      (c.toInstanceId === port.instanceId && c.toPortId === port.id)
  );
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  el.setAttribute('cx', String(x));
  el.setAttribute('cy', String(y));
  el.setAttribute('r', connected ? '5.5' : '4.5');
  el.setAttribute('data-port', port.id);
  el.setAttribute('class', `${portClass(state, port)}${connected ? ' connected' : ''} dir-${port.direction}`);
  el.setAttribute(
    'title',
    `${port.label} · ${port.direction.toUpperCase()} · ${port.signalTypes.join('/')} · ${port.connector} · ${connected ? 'CONNECTED' : 'FREE'}`
  );
  el.addEventListener('pointerdown', (ev) => {
    ev.stopPropagation();
    ev.preventDefault();
    if (side === 'out' || port.direction === 'bidirectional') {
      state.setSystemConnectFrom({ instanceId: port.instanceId, portId: port.id });
    }
  });
  el.addEventListener('pointerup', (ev) => {
    ev.stopPropagation();
    const from = state.systemConnectFrom;
    if (!from) return;
    if (from.instanceId === port.instanceId && from.portId === port.id) return;
    state.addConnection(from.instanceId, from.portId, port.instanceId, port.id);
  });
  return el;
}

function portClass(state: AppState, port: ResolvedPort): string {
  const from = state.systemConnectFrom;
  if (!from) return 'sys-port';
  if (from.instanceId === port.instanceId && from.portId === port.id) return 'sys-port active';
  const srcEq = state.equipment.find((e) => e.instanceId === from.instanceId);
  if (!srcEq) return 'sys-port';
  const src = resolveInstancePorts(srcEq.instanceId, srcEq.productId, catalog).find((p) => p.id === from.portId);
  if (!src) return 'sys-port disabled';
  return canConnectPorts(src, port).ok ? 'sys-port valid' : 'sys-port disabled';
}

function portAnchor(state: AppState, instanceId: string, portId: string, side: 'in' | 'out'): { x: number; y: number } | null {
  const inst = state.equipment.find((e) => e.instanceId === instanceId);
  if (!inst) return null;
  const pos = state.systemLayout[instanceId] ?? { x: 40, y: 40 };
  const ports = resolveInstancePorts(inst.instanceId, inst.productId, catalog);
  const inputs = ports.filter((p) => p.direction === 'input' || p.direction === 'bidirectional');
  const outputs = ports.filter((p) => p.direction === 'output' || p.direction === 'bidirectional');
  const list = side === 'in' ? inputs : outputs;
  const idx = Math.max(0, list.findIndex((p) => p.id === portId));
  return { x: pos.x + (side === 'in' ? 0 : NODE_W), y: pos.y + 58 + idx * 18 };
}

function labelPort(state: AppState, instanceId: string, portId: string): string {
  const inst = state.equipment.find((e) => e.instanceId === instanceId);
  const p = inst
    ? resolveInstancePorts(inst.instanceId, inst.productId, catalog).find((x) => x.id === portId)
    : undefined;
  return `${inst?.name ?? instanceId} ${p?.label ?? portId}`;
}

function mkBtn(label: string, onClick: () => void, active = false): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn' + (active ? ' primary' : '');
  b.textContent = label;
  b.onclick = onClick;
  return b;
}
