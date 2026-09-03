/**
 * EquipmentBrowser.ts
 * ────────────────────────────────────────────────────────────
 * Phase A/B of the equipment workflow: a real catalog browser
 * (search + category groups + filters + product cards) and, on
 * "Add to Design", a suggested-position review step instead of the
 * old "click the floor to place object" interaction.
 *
 * Local browsing state (search text, selected group, filters, which
 * product is open) is UI-only and lives in this module, not in
 * AppState — it doesn't belong in the project file. Only committed
 * equipment (via state.addEquipment) is project data.
 * ────────────────────────────────────────────────────────────
 */

import type { AppState } from '../../app/AppState';
import { createDefaultRoom } from '../../room/RoomModel';
import { loadDefaultCatalog } from '../../catalog/loadCatalog';
import { CATEGORY_GROUPS, type EquipmentProduct } from '../../catalog/EquipmentCatalog';
import type { EquipmentInstance } from '../../catalog/EquipmentCatalog';
import type { RoomModel } from '../../room/RoomModel';
import {
  suggestDisplayPlacement,
  suggestSpeakerDesign,
  suggestMicDesign,
  centerDisplayOnWall
} from '../../av/PlacementSuggestionEngine';
import { snapEquipment } from '../../interaction/SnapEngine';
import { catalogCardLine, m, mountSummary, NOT_SPECIFIED } from '../../catalog/CatalogPresentation';
import { analysisSupportLine, filterCatalog, productDescription, productFamily } from '../../catalog/CatalogEngineering';
import { selectPresentationWall } from '../../av/placement/PlacementCandidateEngine';
import {
  cameraEngineeringReady,
  displayEngineeringReady,
  micEngineeringReady,
  speakerEngineeringReady
} from '../../autodesign/CatalogCandidates';
import { loadUserLibrary } from '../../catalog/UserLibrary';
import { renderCustomDevicePanel } from './CustomDevicePanel';

const catalog = loadDefaultCatalog();

type Filters = {
  manufacturer: string;
  size: string;
  resolution: string;
  technology: string;
};

const browserState: {
  groupId: string;
  search: string;
  filters: Filters;
  openProductId: string | null;
} = {
  groupId: 'displays',
  search: '',
  filters: { manufacturer: '', size: '', resolution: '', technology: '' },
  openProductId: null
};

export function renderEquipmentStep(container: HTMLElement, state: AppState): void {
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'equip-browser';
  container.appendChild(wrap);

  const openProduct = browserState.openProductId ? catalog.get(browserState.openProductId) : undefined;

  if (openProduct) {
    renderSuggestionFlow(wrap, state, openProduct);
    return;
  }

  renderCatalogBrowser(wrap, state);
}

// ── CATALOG BROWSER (Phase A) ──────────────────────────────────

function renderCatalogBrowser(wrap: HTMLElement, state: AppState): void {
  const title = document.createElement('div');
  title.className = 'nav-section-title';
  title.textContent = 'EQUIPMENT';
  wrap.appendChild(title);

  const searchInput = document.createElement('input');
  searchInput.placeholder = 'Search equipment...';
  searchInput.value = browserState.search;
  searchInput.className = 'equip-search';
  searchInput.oninput = () => {
    browserState.search = searchInput.value;
    renderList();
  };
  wrap.appendChild(searchInput);

  const catTitle = document.createElement('div');
  catTitle.className = 'nav-section-title';
  catTitle.textContent = 'CATEGORY';
  wrap.appendChild(catTitle);

  const catList = document.createElement('div');
  wrap.appendChild(catList);
  CATEGORY_GROUPS.forEach((g) => {
    const item = document.createElement('div');
    item.className = 'nav-item' + (browserState.groupId === g.id ? ' active' : '');
    const count = catalog.byGroup(g.id).length;
    item.textContent = `${g.label}${count ? '' : ' (no catalog data)'}`;
    item.onclick = () => {
      browserState.groupId = g.id;
      browserState.filters = { manufacturer: '', size: '', resolution: '', technology: '' };
      renderEquipmentStep(wrap.parentElement!, state);
    };
    catList.appendChild(item);
  });

  // User Library section
  const userLib = loadUserLibrary();
  if (userLib.length > 0) {
    const userTitle = document.createElement('div');
    userTitle.className = 'nav-section-title';
    userTitle.textContent = 'USER LIBRARY';
    userTitle.style.marginTop = '8px';
    wrap.appendChild(userTitle);
    userLib.forEach((p) => {
      const item = document.createElement('div');
      item.className = 'nav-item';
      item.textContent = `★ ${p.manufacturer} ${p.model}`;
      item.title = p.description ?? p.category;
      item.onclick = () => {
        // Register in catalog if not already present
        if (!catalog.get(p.id)) catalog.register([p]);
        const id = `eq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        state.addEquipment({
          instanceId: id,
          productId: p.id,
          name: `${p.manufacturer} ${p.model}`,
          position: { x: 0, y: 1, z: 0 },
          rotationY: 0,
          placementMode: 'manual'
        });
        state.select('equipment', id);
      };
      wrap.appendChild(item);
    });
  }

  // Create Custom Device button
  const createBtn = document.createElement('button');
  createBtn.className = 'btn';
  createBtn.style.margin = '8px 12px';
  createBtn.style.fontSize = '10px';
  createBtn.textContent = '+ Create Custom Device';
  createBtn.onclick = () => {
    renderCustomDevicePanel(wrap.parentElement!, state, () => {
      renderEquipmentStep(wrap.parentElement!, state);
    });
  };
  wrap.appendChild(createBtn);

  const filterTitle = document.createElement('div');
  filterTitle.className = 'nav-section-title';
  filterTitle.textContent = 'FILTERS';
  wrap.appendChild(filterTitle);

  const filterBody = document.createElement('div');
  wrap.appendChild(filterBody);
  renderFilters(filterBody, state);

  const listTitle = document.createElement('div');
  listTitle.className = 'nav-section-title';
  wrap.appendChild(listTitle);

  const listBody = document.createElement('div');
  wrap.appendChild(listBody);

  function renderList(): void {
    const group = CATEGORY_GROUPS.find((g) => g.id === browserState.groupId)!;
    listTitle.textContent = group.label.toUpperCase();
    listBody.innerHTML = '';

    let products = filterCatalog(catalog.byGroup(browserState.groupId), {
      text: browserState.search,
      manufacturer: browserState.filters.manufacturer || undefined
    });
    if (browserState.filters.size) {
      products = products.filter((p) => String(p.display?.diagonalInches) === browserState.filters.size);
    }
    if (browserState.filters.resolution) {
      products = products.filter((p) => p.display?.resolution === browserState.filters.resolution);
    }

    if (products.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'badge-note';
      empty.textContent =
        catalog.byGroup(browserState.groupId).length === 0
          ? `No catalog data for ${group.label} yet. The data model (EquipmentProduct) supports this category — add entries to /data/*.json to populate it without any UI or engineering-logic changes.`
          : 'No equipment matches the current search/filters.';
      listBody.appendChild(empty);
      return;
    }

    products.forEach((p) => listBody.appendChild(renderProductCard(p, state, wrap)));
  }

  renderList();
}

function renderFilters(filterBody: HTMLElement, state: AppState): void {
  filterBody.innerHTML = '';
  const products = catalog.byGroup(browserState.groupId);

  const manufacturers = Array.from(new Set(products.map((p) => p.manufacturer))).sort();
  appendSelectFilter(filterBody, 'Manufacturer', manufacturers, browserState.filters.manufacturer, (v) => {
    browserState.filters.manufacturer = v;
    renderEquipmentStep(filterBody.closest('.equip-browser')!.parentElement!, state);
  });

  if (browserState.groupId === 'displays') {
    const sizes = Array.from(new Set(products.map((p) => p.display?.diagonalInches).filter(Boolean))).sort(
      (a, b) => (a as number) - (b as number)
    );
    appendSelectFilter(
      filterBody,
      'Display Size',
      sizes.map((s) => `${s}"`),
      browserState.filters.size ? `${browserState.filters.size}"` : '',
      (v) => {
        browserState.filters.size = v.replace('"', '');
        renderEquipmentStep(filterBody.closest('.equip-browser')!.parentElement!, state);
      }
    );

    const resolutions = Array.from(new Set(products.map((p) => p.display?.resolution).filter(Boolean))) as string[];
    appendSelectFilter(filterBody, 'Resolution', resolutions, browserState.filters.resolution, (v) => {
      browserState.filters.resolution = v;
      renderEquipmentStep(filterBody.closest('.equip-browser')!.parentElement!, state);
    });
  }
}

function appendSelectFilter(
  container: HTMLElement,
  label: string,
  options: string[],
  selected: string,
  onChange: (val: string) => void
): void {
  const field = document.createElement('div');
  field.className = 'field';
  const l = document.createElement('label');
  l.textContent = label;
  const select = document.createElement('select');
  const allOpt = document.createElement('option');
  allOpt.value = '';
  allOpt.textContent = 'All';
  select.appendChild(allOpt);
  options.forEach((o) => {
    const opt = document.createElement('option');
    opt.value = o;
    opt.textContent = o;
    if (o === selected) opt.selected = true;
    select.appendChild(opt);
  });
  select.onchange = () => onChange(select.value);
  field.append(l, select);
  container.appendChild(field);
}

function renderProductCard(p: EquipmentProduct, state: AppState, wrap: HTMLElement): HTMLElement {
  const card = document.createElement('div');
  card.className = 'equip-card';

  const prov = document.createElement('span');
  prov.className = `provenance ${p.provenance}`;
  prov.textContent = p.provenance.replace('_', ' ');
  card.appendChild(prov);

  const preview = document.createElement('div');
  preview.className = 'equip-card-preview';
  preview.textContent = categoryIcon(p);
  card.appendChild(preview);

  const mfr = document.createElement('div');
  mfr.className = 'manufacturer';
  mfr.textContent = p.manufacturer;
  const model = document.createElement('div');
  model.className = 'model';
  model.textContent = p.model;
  const specs = document.createElement('div');
  specs.className = 'specs';
  specs.textContent = `${catalogCardLine(p)} · ${mountSummary(p)}`;
  card.append(mfr, model, specs);
  const phys = document.createElement('div');
  phys.className = 'specs';
  phys.textContent = `${m(p.physical.width)} × ${m(p.physical.height)} × ${m(p.physical.depth)}`;
  card.appendChild(phys);

  const flags = document.createElement('div');
  flags.className = 'equip-card-flags';
  flags.innerHTML = `<span>Catalog specs</span>`;
  const incompleteHint = catalogIncompleteReason(p);
  if (incompleteHint) {
    flags.innerHTML = `<span class="data-incomplete">DATA INCOMPLETE</span>`;
    flags.title = incompleteHint;
  }
  card.appendChild(flags);

  const viewBtn = document.createElement('button');
  viewBtn.className = 'btn';
  viewBtn.textContent = 'View Details';
  viewBtn.onclick = () => {
    browserState.openProductId = p.id;
    renderEquipmentStep(wrap.parentElement!, state);
  };

  const addBtn = document.createElement('button');
  addBtn.className = 'btn primary';
  addBtn.textContent = 'Add to Design';
  addBtn.onclick = () => {
    browserState.openProductId = p.id;
    renderEquipmentStep(wrap.parentElement!, state);
  };

  card.append(viewBtn, addBtn);
  return card;
}

function renderProductEngineeringSheet(product: EquipmentProduct): HTMLElement {
  const box = document.createElement('div');
  box.className = 'suggestion-box';
  const title = document.createElement('div');
  title.className = 'nav-section-title';
  title.textContent = product.category.replace(/_/g, ' ').toUpperCase();
  box.appendChild(title);
  const rows: [string, string][] = [
    ['Manufacturer', product.manufacturer],
    ['Model', product.model],
    ['Family', productFamily(product)],
    ['Description', productDescription(product)],
    ['Width', m(product.physical.width)],
    ['Height', m(product.physical.height)],
    ['Depth', m(product.physical.depth)],
    ['Mounting', mountSummary(product)],
    ['Analysis', analysisSupportLine(product)]
  ];
  if (product.display) {
    rows.push(
      ['Diagonal', `${product.display.diagonalInches}"`],
      ['Resolution', product.display.resolution || NOT_SPECIFIED],
      ['Aspect', product.display.aspectRatio || NOT_SPECIFIED]
    );
  }
  rows.forEach(([l, v]) => {
    const row = document.createElement('div');
    row.className = 'metric-row';
    row.innerHTML = `<span class="label">${l}</span><span class="value">${v}</span>`;
    box.appendChild(row);
  });
  return box;
}

function categoryIcon(p: EquipmentProduct): string {
  switch (p.category) {
    case 'display':
      return 'DISP';
    case 'speaker':
      return 'SPK';
    case 'microphone':
      return 'MIC';
    case 'camera':
      return 'CAM';
    default:
      return p.category.slice(0, 4).toUpperCase();
  }
}

function catalogIncompleteReason(p: EquipmentProduct): string | null {
  if (p.category === 'display') return displayEngineeringReady(p);
  if (p.category === 'microphone') return micEngineeringReady(p);
  if (p.category === 'speaker') return speakerEngineeringReady(p);
  if (p.category === 'camera') return cameraEngineeringReady(p);
  return null;
}

// ── SUGGESTED POSITION / DESIGN FLOW (Phase B) ─────────────────

function renderSuggestionFlow(wrap: HTMLElement, state: AppState, product: EquipmentProduct): void {
  const back = document.createElement('button');
  back.className = 'btn';
  back.textContent = '← Back to catalog';
  back.onclick = () => {
    browserState.openProductId = null;
    renderEquipmentStep(wrap.parentElement!, state);
  };
  wrap.appendChild(back);

  const room = state.room ?? createDefaultRoom(state.project.roomUseCase);
  if (!state.room) state.setRoom(room);

  const header = document.createElement('div');
  header.className = 'suggestion-header';
  header.innerHTML = `<div class="manufacturer">${product.manufacturer}</div><div class="model">${product.model}</div>`;
  wrap.appendChild(header);
  wrap.appendChild(renderProductEngineeringSheet(product));

  if (product.category === 'display') {
    renderDisplaySuggestion(wrap, state, product, room);
  } else if (product.category === 'speaker') {
    renderSpeakerSuggestion(wrap, state, product, room);
  } else if (product.category === 'microphone') {
    renderMicSuggestion(wrap, state, product, room);
  } else if (product.category === 'camera') {
    const noteEl = document.createElement('div');
    noteEl.className = 'badge-note';
    noteEl.textContent =
      'Cameras are placed with existing wall snap (not Auto Design). Coverage is a geometric frustum estimate from catalog HFOV.';
    wrap.appendChild(noteEl);
    const addBtn = document.createElement('button');
    addBtn.className = 'btn primary';
    addBtn.textContent = 'Add to Design';
    addBtn.onclick = () => {
      const y = 1.6;
      const wall = selectPresentationWall(room, { seats: state.seats, tables: state.tables, product });
      const mounted = centerDisplayOnWall(room, product, wall);
      state.addEquipment({
        instanceId: `eq-${Date.now()}`,
        productId: product.id,
        name: `${product.manufacturer} ${product.model}`,
        position: { x: mounted.x, y, z: mounted.z },
        rotationY: mounted.rotationY,
        wall,
        placementMode: 'smart'
      });
      browserState.openProductId = null;
      state.setStep('equipment');
    };
    wrap.appendChild(addBtn);
  } else {
    const note = document.createElement('div');
    note.className = 'badge-note';
    note.textContent = `Automatic placement suggestions aren't built yet for this category — this product's engineering data model is in place, but the suggestion engine only covers displays, speakers, and microphones so far.`;
    wrap.appendChild(note);

    const addBtn = document.createElement('button');
    addBtn.className = 'btn primary';
    addBtn.textContent = 'Add to Design (center of room)';
    addBtn.onclick = () => {
      const snapped = snapEquipment(room, product, { x: 0, y: 1, z: 0 }, 0);
      state.addEquipment({
        instanceId: `eq-${Date.now()}`,
        productId: product.id,
        name: `${product.manufacturer} ${product.model}`,
        position: snapped.position,
        rotationY: snapped.rotationY,
        wall: snapped.wall,
        placementMode: 'manual'
      });
      browserState.openProductId = null;
      state.setStep('equipment');
    };
    wrap.appendChild(addBtn);
  }
}

function renderDisplaySuggestion(wrap: HTMLElement, state: AppState, product: EquipmentProduct, room: RoomModel): void {
  let suggestion = suggestDisplayPlacement(room, product, { seats: state.seats, tables: state.tables });

  const box = document.createElement('div');
  box.className = 'suggestion-box';
  wrap.appendChild(box);

  function draw(): void {
    box.innerHTML = '';
    const rows: [string, string][] = [
      ['Suggested position', suggestion.wall.charAt(0).toUpperCase() + suggestion.wall.slice(1) + ' wall'],
      ['Suggested mounting', suggestion.mount === 'wall' ? 'Wall' : 'Cart'],
      ['Suggested center height', `${suggestion.centerHeightM} m AFF`]
    ];
    rows.forEach(([l, v]) => {
      const row = document.createElement('div');
      row.className = 'metric-row';
      row.innerHTML = `<span class="label">${l}</span><span class="value">${v}</span>`;
      box.appendChild(row);
    });
    const rationale = document.createElement('div');
    rationale.className = 'badge-note';
    rationale.textContent = suggestion.rationale;
    box.appendChild(rationale);

    // Wall candidate scoring (§7/§8 of the spatial model) — a lightweight,
    // always-visible stand-in for a 3D "Show Placement Analysis" overlay:
    // shows why this wall won and why the others didn't, without needing a
    // separate debug mode.
    const candidateList = document.createElement('div');
    candidateList.className = 'wall-candidate-list';
    suggestion.candidates.forEach((c) => {
      const row = document.createElement('div');
      row.className = 'wall-candidate-row' + (c.wall === suggestion.wall ? ' chosen' : '');
      const flags = [c.hasDoor ? 'door' : null, c.hasWindow ? 'window' : null].filter(Boolean).join(', ');
      row.innerHTML = `<span class="wc-mark">${c.wall === suggestion.wall ? '✓' : (c.valid ? '' : '✗')}</span>` +
        `<span class="wc-wall">${c.wall}</span>` +
        `<span class="wc-clear">${c.usableWidthM.toFixed(1)}m clear</span>` +
        `<span class="wc-flags">${flags}</span>`;
      candidateList.appendChild(row);
    });
    box.appendChild(candidateList);
  }
  draw();

  const adjustBox = document.createElement('div');
  adjustBox.style.display = 'none';
  wrap.appendChild(adjustBox);

  const heightInput = document.createElement('input');
  heightInput.type = 'number';
  heightInput.step = '0.05';
  const heightField = document.createElement('div');
  heightField.className = 'field';
  heightField.innerHTML = '<label>Center height (m AFF)</label>';
  heightField.appendChild(heightInput);

  const wallSelect = document.createElement('select');
  (['front', 'back', 'left', 'right'] as const).forEach((w) => {
    const opt = document.createElement('option');
    opt.value = w;
    opt.textContent = w.charAt(0).toUpperCase() + w.slice(1) + ' wall';
    wallSelect.appendChild(opt);
  });
  const wallField = document.createElement('div');
  wallField.className = 'field';
  wallField.innerHTML = '<label>Wall</label>';
  wallField.appendChild(wallSelect);

  adjustBox.append(wallField, heightField);

  const btnRow = document.createElement('div');
  btnRow.className = 'field-row';

  const adjustBtn = document.createElement('button');
  adjustBtn.className = 'btn';
  adjustBtn.textContent = 'ADJUST';
  adjustBtn.onclick = () => {
    heightInput.value = String(suggestion.centerHeightM);
    wallSelect.value = suggestion.wall;
    adjustBox.style.display = adjustBox.style.display === 'none' ? '' : 'none';
  };

  const acceptBtn = document.createElement('button');
  acceptBtn.className = 'btn primary';
  acceptBtn.textContent = 'ACCEPT';
  acceptBtn.onclick = () => {
    const wall = (adjustBox.style.display === 'none' ? suggestion.wall : (wallSelect.value as typeof suggestion.wall));
    const centerHeightM = adjustBox.style.display === 'none' ? suggestion.centerHeightM : Number(heightInput.value);
    const placement = centerDisplayOnWall(room, product, wall);

    const instance: EquipmentInstance = {
      instanceId: `eq-${Date.now()}`,
      productId: product.id,
      name: `${product.manufacturer} ${product.model}`,
      position: { x: placement.x, y: centerHeightM, z: placement.z },
      rotationY: placement.rotationY,
      wall
    };
    state.addEquipment(instance);
    state.select('equipment', instance.instanceId);
    browserState.openProductId = null;
  };

  btnRow.append(adjustBtn, acceptBtn);
  wrap.appendChild(btnRow);

  const note = document.createElement('div');
  note.className = 'badge-note';
  note.textContent = 'After Accept, select this display in the 3D view or Inspector to fine-tune position and run viewing analysis.';
  wrap.appendChild(note);
}

function renderSpeakerSuggestion(wrap: HTMLElement, state: AppState, product: EquipmentProduct, room: RoomModel): void {
  const title = document.createElement('div');
  title.className = 'nav-section-title';
  title.textContent = 'SPEAKER DESIGN';
  wrap.appendChild(title);

  if (state.seats.length === 0) {
    const note = document.createElement('div');
    note.className = 'badge-note';
    note.textContent = 'Generate seating first (Seating step) so speaker coverage can be evaluated against actual seat positions.';
    wrap.appendChild(note);
    return;
  }

  const suggestion = suggestSpeakerDesign(room, state.seats, product);

  const box = document.createElement('div');
  box.className = 'suggestion-box';
  const rows: [string, string][] = [
    ['Suggested quantity', String(suggestion.quantity)],
    ['Suggested layout', suggestion.layout],
    ['Coverage', `${suggestion.coveragePct}% (${suggestion.coveredSeats}/${suggestion.totalSeats} seats)`]
  ];
  rows.forEach(([l, v]) => {
    const row = document.createElement('div');
    row.className = 'metric-row';
    row.innerHTML = `<span class="label">${l}</span><span class="value">${v}</span>`;
    box.appendChild(row);
  });
  const method = document.createElement('div');
  method.className = 'badge-note';
  method.textContent = suggestion.method;
  box.appendChild(method);
  wrap.appendChild(box);

  const applyBtn = document.createElement('button');
  applyBtn.className = 'btn primary';
  applyBtn.textContent = 'APPLY DESIGN';
  applyBtn.onclick = () => {
    suggestion.speakers.forEach((sp) => {
      const instance: EquipmentInstance = {
        instanceId: `eq-${Date.now()}-${sp.id}`,
        productId: product.id,
        name: `${product.manufacturer} ${product.model} (${sp.id})`,
        position: { x: sp.x, y: sp.y, z: sp.z },
        rotationY: 0
      };
      state.addEquipment(instance);
    });
    browserState.openProductId = null;
  };
  wrap.appendChild(applyBtn);
}

function renderMicSuggestion(wrap: HTMLElement, state: AppState, product: EquipmentProduct, room: RoomModel): void {
  void room;
  const title = document.createElement('div');
  title.className = 'nav-section-title';
  title.textContent = 'MICROPHONE DESIGN';
  wrap.appendChild(title);

  if (state.seats.length === 0) {
    const note = document.createElement('div');
    note.className = 'badge-note';
    note.textContent = 'Generate seating first (Seating step) so microphone coverage can be evaluated against actual seat positions.';
    wrap.appendChild(note);
    return;
  }

  const suggestion = suggestMicDesign(state.seats, product);

  const box = document.createElement('div');
  box.className = 'suggestion-box';
  const rows: [string, string][] = [
    ['Suggested quantity', String(suggestion.quantity)],
    ['Coverage', `${suggestion.coveragePct}% (${suggestion.coveredSeats}/${suggestion.totalSeats} seats)`]
  ];
  rows.forEach(([l, v]) => {
    const row = document.createElement('div');
    row.className = 'metric-row';
    row.innerHTML = `<span class="label">${l}</span><span class="value">${v}</span>`;
    box.appendChild(row);
  });
  const method = document.createElement('div');
  method.className = 'badge-note';
  method.textContent = suggestion.method;
  box.appendChild(method);
  wrap.appendChild(box);

  const mount = product.microphone!.mount;
  const y = mount === 'ceiling' ? 2.6 : mount === 'table' ? 0.75 : 1.2;

  const applyBtn = document.createElement('button');
  applyBtn.className = 'btn primary';
  applyBtn.textContent = 'APPLY DESIGN';
  applyBtn.onclick = () => {
    suggestion.placements.forEach((mp) => {
      const instance: EquipmentInstance = {
        instanceId: `eq-${Date.now()}-${mp.id}`,
        productId: product.id,
        name: `${product.manufacturer} ${product.model} (${mp.id})`,
        position: { x: mp.x, y, z: mp.z },
        rotationY: 0
      };
      state.addEquipment(instance);
    });
    browserState.openProductId = null;
  };
  wrap.appendChild(applyBtn);
}
