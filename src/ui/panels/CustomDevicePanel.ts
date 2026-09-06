/**
 * CustomDevicePanel.ts
 * Purpose-driven Custom Device Builder UI (§4, §15).
 * Implements progressive disclosure with device type selectors and
 * category-specific engineering metadata tabs.
 */

import type { AppState } from '../../app/AppState';
import type { EquipmentCategory } from '../../catalog/EquipmentCatalog';
import type { PortDefinition, SignalType, PortDirection, ConnectorId } from '../../system/SystemTypes';
import {
  buildCustomDevice,
  validateCustomDeviceInput,
  getDeviceTypeDefaults,
  type CustomDeviceInput,
  type CustomDeviceType
} from '../../catalog/CustomDeviceBuilder';
import { saveUserDevice } from '../../catalog/UserLibrary';
import { loadDefaultCatalog } from '../../catalog/loadCatalog';

const catalog = loadDefaultCatalog();

const DEVICE_TYPES: Array<{ id: CustomDeviceType; label: string }> = [
  { id: 'display', label: 'Display' },
  { id: 'camera', label: 'Camera' },
  { id: 'microphone', label: 'Microphone' },
  { id: 'speaker', label: 'Speaker' },
  { id: 'dsp', label: 'DSP' },
  { id: 'amplifier', label: 'Amplifier' },
  { id: 'codec', label: 'Codec' },
  { id: 'matrix', label: 'Matrix' },
  { id: 'network_switch', label: 'Network Switch' },
  { id: 'control_processor', label: 'Control Processor' },
  { id: 'av_over_ip', label: 'AV-over-IP' },
  { id: 'converter', label: 'Converter' },
  { id: 'extender', label: 'Extender' },
  { id: 'rack', label: 'Rack' },
  { id: 'other', label: 'Other' }
];

const SIGNAL_TYPES: SignalType[] = [
  'VIDEO',
  'AUDIO',
  'USB',
  'NETWORK',
  'CONTROL',
  'POWER',
  'SERIAL',
  'GPIO',
  'DANTE',
  'AES67'
];
const DIRECTIONS: PortDirection[] = ['input', 'output', 'bidirectional'];
const CONNECTORS: ConnectorId[] = [
  'hdmi',
  'displayport',
  'usbc',
  'usb-a',
  'rj45',
  'xlr',
  'line-trs',
  'phoenix',
  'speakon',
  'dsub9',
  'bnc',
  'terminal-block'
];

type ActiveTab = 'identity' | 'physical' | 'engineering' | 'ports' | 'power_rack';

export function renderCustomDevicePanel(
  container: HTMLElement,
  state: AppState,
  onClose: () => void
): void {
  container.innerHTML = '';

  let activeType: CustomDeviceType = 'dsp';
  let activeTab: ActiveTab = 'identity';

  // Initialize draft with DSP defaults
  let draft: Partial<CustomDeviceInput> = {
    manufacturer: '',
    model: '',
    partNumber: '',
    provenance: 'user_defined',
    libraryTier: 'user',
    ...getDeviceTypeDefaults('dsp')
  };

  const wrapper = document.createElement('div');
  wrapper.className = 'custom-device-panel';
  wrapper.style.display = 'flex';
  wrapper.style.flexDirection = 'column';
  wrapper.style.gap = '8px';

  // Panel Title
  const title = document.createElement('div');
  title.className = 'nav-section-title';
  title.textContent = 'CUSTOM DEVICE BUILDER';
  wrapper.appendChild(title);

  // ── Step 1: Device Type Chips (§15) ──
  const typeSectionTitle = document.createElement('div');
  typeSectionTitle.style.fontSize = '10px';
  typeSectionTitle.style.textTransform = 'uppercase';
  typeSectionTitle.style.color = 'var(--text-tertiary)';
  typeSectionTitle.textContent = 'SELECT DEVICE TYPE';
  wrapper.appendChild(typeSectionTitle);

  const typeGrid = document.createElement('div');
  typeGrid.style.display = 'flex';
  typeGrid.style.flexWrap = 'wrap';
  typeGrid.style.gap = '4px';
  typeGrid.style.marginBottom = '8px';

  const typeButtons = new Map<CustomDeviceType, HTMLButtonElement>();

  DEVICE_TYPES.forEach((dt) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-sm' + (dt.id === activeType ? ' primary' : '');
    b.style.fontSize = '11px';
    b.style.padding = '3px 7px';
    b.textContent = dt.label;
    b.onclick = () => {
      activeType = dt.id;
      typeButtons.forEach((btn, k) => {
        if (k === dt.id) btn.classList.add('primary');
        else btn.classList.remove('primary');
      });

      // Apply smart defaults while preserving user identity inputs
      const defaults = getDeviceTypeDefaults(dt.id);
      draft = {
        manufacturer: draft.manufacturer,
        model: draft.model,
        partNumber: draft.partNumber,
        provenance: draft.provenance,
        libraryTier: draft.libraryTier,
        ...defaults
      };
      renderTabContent();
    };
    typeButtons.set(dt.id, b);
    typeGrid.appendChild(b);
  });
  wrapper.appendChild(typeGrid);

  // ── Step 2: Progressive Tab Header ──
  const tabRow = document.createElement('div');
  tabRow.style.display = 'flex';
  tabRow.style.gap = '2px';
  tabRow.style.borderBottom = '1px solid var(--border)';
  tabRow.style.paddingBottom = '4px';
  tabRow.style.marginBottom = '6px';

  const tabs: Array<{ id: ActiveTab; label: string }> = [
    { id: 'identity', label: 'Identity' },
    { id: 'physical', label: 'Physical' },
    { id: 'engineering', label: 'Engineering' },
    { id: 'ports', label: 'Ports' },
    { id: 'power_rack', label: 'Power & Rack' }
  ];

  const tabBtns = new Map<ActiveTab, HTMLButtonElement>();

  tabs.forEach((t) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-sm' + (t.id === activeTab ? ' primary' : '');
    btn.style.fontSize = '11px';
    btn.textContent = t.label;
    btn.onclick = () => {
      activeTab = t.id;
      tabBtns.forEach((b, k) => {
        if (k === t.id) b.classList.add('primary');
        else b.classList.remove('primary');
      });
      renderTabContent();
    };
    tabBtns.set(t.id, btn);
    tabRow.appendChild(btn);
  });
  wrapper.appendChild(tabRow);

  // ── Step 3: Tab Content Host ──
  const contentHost = document.createElement('div');
  contentHost.style.display = 'flex';
  contentHost.style.flexDirection = 'column';
  contentHost.style.gap = '6px';
  contentHost.style.maxHeight = '50vh';
  contentHost.style.overflowY = 'auto';
  contentHost.style.paddingRight = '4px';
  wrapper.appendChild(contentHost);

  const renderTabContent = () => {
    contentHost.innerHTML = '';

    if (activeTab === 'identity') {
      textField(contentHost, 'Manufacturer', draft.manufacturer ?? '', (v) => { draft.manufacturer = v; });
      textField(contentHost, 'Model', draft.model ?? '', (v) => { draft.model = v; });
      textField(contentHost, 'Part Number / SKU (optional)', draft.partNumber ?? '', (v) => { draft.partNumber = v; });
      selectField(
        contentHost,
        'Data Provenance',
        [
          { value: 'user_defined', label: 'User Defined' },
          { value: 'verified', label: 'Manufacturer Verified (Datasheet)' },
          { value: 'estimated', label: 'Engineering Estimate' }
        ],
        draft.provenance ?? 'user_defined',
        (v) => { draft.provenance = v as any; }
      );
      selectField(
        contentHost,
        'Library Tier',
        [
          { value: 'user', label: 'User Library (This Project)' },
          { value: 'company', label: 'Company Library (Shared)' }
        ],
        draft.libraryTier ?? 'user',
        (v) => { draft.libraryTier = v as any; }
      );
      textField(contentHost, 'Description', draft.description ?? '', (v) => { draft.description = v; });
      textField(contentHost, '3D Asset (.glb URL/path)', draft.modelAsset ?? '', (v) => { draft.modelAsset = v; });
      textField(contentHost, 'Engineering Notes', draft.notes ?? '', (v) => { draft.notes = v; });
    } else if (activeTab === 'physical') {
      numInput(contentHost, 'Width (m)', draft.width ?? 0.48, (v) => { draft.width = v; });
      numInput(contentHost, 'Height (m)', draft.height ?? 0.044, (v) => { draft.height = v; });
      numInput(contentHost, 'Depth (m)', draft.depth ?? 0.3, (v) => { draft.depth = v; });
      numInput(contentHost, 'Weight (kg, optional)', draft.weightKg ?? 0, (v) => { draft.weightKg = v > 0 ? v : undefined; });

      sectionTitle(contentHost, 'Mounting Capabilities');
      checkboxField(contentHost, 'Wall Mountable', draft.mounting?.wall ?? false, (v) => {
        if (!draft.mounting) draft.mounting = {};
        draft.mounting.wall = v;
      });
      checkboxField(contentHost, 'Ceiling Mountable', draft.mounting?.ceiling ?? false, (v) => {
        if (!draft.mounting) draft.mounting = {};
        draft.mounting.ceiling = v;
      });
      checkboxField(contentHost, 'Table / Surface', draft.mounting?.table ?? false, (v) => {
        if (!draft.mounting) draft.mounting = {};
        draft.mounting.table = v;
      });
      checkboxField(contentHost, 'Floor Standing', draft.mounting?.floor ?? false, (v) => {
        if (!draft.mounting) draft.mounting = {};
        draft.mounting.floor = v;
      });
      textField(contentHost, 'VESA Pattern (e.g. 400x400)', draft.mounting?.vesa ?? '', (v) => {
        if (!draft.mounting) draft.mounting = {};
        draft.mounting.vesa = v.trim() || undefined;
      });
    } else if (activeTab === 'engineering') {
      renderEngineeringTab(contentHost, activeType, draft);
    } else if (activeTab === 'ports') {
      renderPortsTab(contentHost, draft);
    } else if (activeTab === 'power_rack') {
      sectionTitle(contentHost, 'Electrical & Power (§11)');
      numInput(contentHost, 'Operating Power (Watts)', draft.powerWatts ?? 0, (v) => {
        draft.powerWatts = v > 0 ? v : undefined;
        if (!draft.power) draft.power = {};
        draft.power.powerWatts = v > 0 ? v : undefined;
      });
      selectField(
        contentHost,
        'PoE Class',
        [
          { value: 'none', label: 'None (AC / Local DC)' },
          { value: 'PoE (15.4W)', label: 'PoE 802.3af (15.4W)' },
          { value: 'PoE+ (30W)', label: 'PoE+ 802.3at (30W)' },
          { value: 'PoE++ (60W)', label: 'PoE++ 802.3bt Type 3 (60W)' },
          { value: 'PoE++ (90W)', label: 'PoE++ 802.3bt Type 4 (90W)' }
        ],
        draft.power?.poeClass ?? 'none',
        (v) => {
          if (!draft.power) draft.power = {};
          draft.power.poeClass = v !== 'none' ? v : undefined;
        }
      );

      sectionTitle(contentHost, 'Rack Enclosure Specs (§11)');
      checkboxField(contentHost, 'Rack Mountable', draft.rackMountable ?? (draft.rackUnits != null && draft.rackUnits > 0), (v) => {
        draft.rackMountable = v;
        if (!v) draft.rackUnits = undefined;
      });
      numInput(contentHost, 'Rack Units (RU)', draft.rackUnits ?? 0, (v) => {
        draft.rackUnits = v > 0 ? v : undefined;
        if (v > 0) draft.rackMountable = true;
      });
    }
  };

  // ── Step 4: Actions Footer ──
  const errorEl = document.createElement('div');
  errorEl.className = 'custom-device-errors';
  errorEl.style.fontSize = '11px';
  wrapper.appendChild(errorEl);

  const actions = document.createElement('div');
  actions.className = 'custom-device-actions';
  actions.style.display = 'flex';
  actions.style.gap = '6px';
  actions.style.marginTop = '8px';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn primary';
  saveBtn.textContent = 'Save & Add to Project';
  saveBtn.onclick = () => {
    const validation = validateCustomDeviceInput(draft);
    if (!validation.valid) {
      errorEl.textContent = validation.errors.join(' ');
      errorEl.style.color = 'var(--warning)';
      return;
    }
    try {
      const product = buildCustomDevice(draft as CustomDeviceInput);
      saveUserDevice(product);
      catalog.register([product]);
      const id = `eq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      state.addEquipment({
        instanceId: id,
        productId: product.id,
        name: `${product.manufacturer} ${product.model}`,
        position: { x: 0, y: 1, z: 0 },
        rotationY: 0,
        placementMode: 'manual'
      });
      state.select('equipment', id);
      onClose();
    } catch (e) {
      errorEl.textContent = (e as Error).message;
      errorEl.style.color = 'var(--warning)';
    }
  };

  const saveOnlyBtn = document.createElement('button');
  saveOnlyBtn.className = 'btn';
  saveOnlyBtn.textContent = 'Save to Library';
  saveOnlyBtn.onclick = () => {
    const validation = validateCustomDeviceInput(draft);
    if (!validation.valid) {
      errorEl.textContent = validation.errors.join(' ');
      errorEl.style.color = 'var(--warning)';
      return;
    }
    try {
      const product = buildCustomDevice(draft as CustomDeviceInput);
      saveUserDevice(product);
      catalog.register([product]);
      errorEl.textContent = `Saved: ${product.manufacturer} ${product.model}`;
      errorEl.style.color = 'var(--success)';
    } catch (e) {
      errorEl.textContent = (e as Error).message;
      errorEl.style.color = 'var(--warning)';
    }
  };

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.onclick = onClose;

  actions.append(saveBtn, saveOnlyBtn, cancelBtn);
  wrapper.appendChild(actions);

  renderTabContent();
  container.appendChild(wrapper);
}

/* ============================================================
   Category-Adaptive Engineering Specs Tab (§4, §15)
   ============================================================ */

function renderEngineeringTab(
  parent: HTMLElement,
  type: CustomDeviceType,
  draft: Partial<CustomDeviceInput>
): void {
  if (type === 'camera') {
    sectionTitle(parent, 'Camera Optics & FOV (§7)');
    numInput(parent, 'Horizontal FOV (°)', draft.camera?.horizontalFovDeg ?? 80, (v) => {
      if (!draft.camera) draft.camera = {};
      draft.camera.horizontalFovDeg = v > 0 ? v : undefined;
    });
    numInput(parent, 'Vertical FOV (°)', draft.camera?.verticalFovDeg ?? 50, (v) => {
      if (!draft.camera) draft.camera = {};
      draft.camera.verticalFovDeg = v > 0 ? v : undefined;
    });
    numInput(parent, 'Diagonal FOV (°)', draft.camera?.diagonalFovDeg ?? 0, (v) => {
      if (!draft.camera) draft.camera = {};
      draft.camera.diagonalFovDeg = v > 0 ? v : undefined;
    });
    checkboxField(parent, 'PTZ Mechanism', draft.camera?.ptz ?? false, (v) => {
      if (!draft.camera) draft.camera = {};
      draft.camera.ptz = v;
    });
    checkboxField(parent, 'Auto-Framing / Tracking', draft.camera?.tracking ?? false, (v) => {
      if (!draft.camera) draft.camera = {};
      draft.camera.tracking = v;
    });
  } else if (type === 'display') {
    sectionTitle(parent, 'Display Screen & Viewing (§10)');
    numInput(parent, 'Diagonal (inches)', draft.display?.diagonalInches ?? 55, (v) => {
      if (!draft.display) draft.display = {};
      draft.display.diagonalInches = v;
    });
    textField(parent, 'Resolution (e.g. 3840x2160)', draft.display?.resolution ?? '3840x2160', (v) => {
      if (!draft.display) draft.display = {};
      draft.display.resolution = v;
    });
    selectField(
      parent,
      'Aspect Ratio',
      [
        { value: '16:9', label: '16:9 (Standard)' },
        { value: '21:9', label: '21:9 (Ultrawide)' },
        { value: '16:10', label: '16:10' }
      ],
      draft.display?.aspectRatio ?? '16:9',
      (v) => {
        if (!draft.display) draft.display = {};
        draft.display.aspectRatio = v;
      }
    );
    selectField(
      parent,
      'Orientation',
      [
        { value: 'landscape', label: 'Landscape' },
        { value: 'portrait', label: 'Portrait' }
      ],
      draft.display?.orientation ?? 'landscape',
      (v) => {
        if (!draft.display) draft.display = {};
        draft.display.orientation = v as any;
      }
    );
  } else if (type === 'microphone') {
    sectionTitle(parent, 'Microphone Acoustic Pickup (§8)');
    numInput(parent, 'Pickup Radius (m)', draft.microphone?.pickupRadiusM ?? 3.5, (v) => {
      if (!draft.microphone) draft.microphone = {};
      draft.microphone.pickupRadiusM = v;
    });
    textField(parent, 'Polar Pattern', draft.microphone?.pattern ?? 'cardioid', (v) => {
      if (!draft.microphone) draft.microphone = {};
      draft.microphone.pattern = v;
    });
    selectField(
      parent,
      'Coverage Geometry',
      [
        { value: 'omni', label: 'Omni / Circular Disc' },
        { value: 'directional_sector', label: 'Directional Sector Cone' }
      ],
      draft.microphone?.coverageModel ?? 'omni',
      (v) => {
        if (!draft.microphone) draft.microphone = {};
        draft.microphone.coverageModel = v as any;
      }
    );
  } else if (type === 'speaker') {
    sectionTitle(parent, 'Speaker Dispersion & SPL (§9)');
    numInput(parent, 'Dispersion Angle (°)', draft.speaker?.dispersionDeg ?? 100, (v) => {
      if (!draft.speaker) draft.speaker = {};
      draft.speaker.dispersionDeg = v;
    });
    numInput(parent, 'Max SPL @ 1m (dB)', draft.speaker?.maxSplAt1m ?? 102, (v) => {
      if (!draft.speaker) draft.speaker = {};
      draft.speaker.maxSplAt1m = v > 0 ? v : undefined;
    });
    selectField(
      parent,
      'Power Class',
      [
        { value: 'passive', label: 'Passive (Requires Amplifier)' },
        { value: 'active', label: 'Active (Self-Powered)' }
      ],
      draft.speaker?.powerClass ?? 'passive',
      (v) => {
        if (!draft.speaker) draft.speaker = {};
        draft.speaker.powerClass = v as any;
      }
    );
  } else {
    sectionTitle(parent, 'Signal Forwarding & Matrix Routing (§12)');
    checkboxField(parent, 'Forwards Video Signal', draft.signalForwarding?.includes('VIDEO') ?? false, (v) => {
      const cur = new Set(draft.signalForwarding ?? []);
      if (v) cur.add('VIDEO');
      else cur.delete('VIDEO');
      draft.signalForwarding = Array.from(cur);
    });
    checkboxField(parent, 'Forwards Audio Signal', draft.signalForwarding?.includes('AUDIO') ?? false, (v) => {
      const cur = new Set(draft.signalForwarding ?? []);
      if (v) cur.add('AUDIO');
      else cur.delete('AUDIO');
      draft.signalForwarding = Array.from(cur);
    });
  }
}

/* ============================================================
   Ports Tab with Bandwidth & PoE (§12)
   ============================================================ */

function renderPortsTab(parent: HTMLElement, draft: Partial<CustomDeviceInput>): void {
  sectionTitle(parent, 'Device Engineering Ports (§12)');

  const portHost = document.createElement('div');
  parent.appendChild(portHost);

  const renderList = () => {
    portHost.innerHTML = '';
    const ports = draft.ports ?? [];

    ports.forEach((p, i) => {
      const row = document.createElement('div');
      row.style.background = 'var(--bg-panel-alt)';
      row.style.padding = '6px';
      row.style.borderRadius = '4px';
      row.style.border = '1px solid var(--border)';
      row.style.marginBottom = '6px';
      row.style.display = 'flex';
      row.style.flexDirection = 'column';
      row.style.gap = '4px';

      const top = document.createElement('div');
      top.style.display = 'flex';
      top.style.justifyContent = 'space-between';
      top.style.alignItems = 'center';

      const lbl = document.createElement('strong');
      lbl.style.fontSize = '11px';
      lbl.textContent = `Port ${i + 1}: ${p.label || p.id}`;

      const del = document.createElement('button');
      del.className = 'btn btn-sm';
      del.textContent = '✕ Remove';
      del.onclick = () => {
        ports.splice(i, 1);
        renderList();
      };
      top.append(lbl, del);
      row.appendChild(top);

      const grid = document.createElement('div');
      grid.style.display = 'grid';
      grid.style.gridTemplateColumns = '1fr 1fr';
      grid.style.gap = '4px';

      textField(grid, 'ID', p.id, (v) => { p.id = v; }, 'port-field-sm');
      textField(grid, 'Label', p.label, (v) => { p.label = v; }, 'port-field-sm');
      selectField(grid, 'Direction', DIRECTIONS.map((d) => ({ value: d, label: d.toUpperCase() })), p.direction, (v) => { p.direction = v as PortDirection; });
      selectField(grid, 'Signal', SIGNAL_TYPES.map((s) => ({ value: s, label: s })), p.signalTypes[0], (v) => { p.signalTypes = [v as SignalType]; });
      selectField(grid, 'Connector', CONNECTORS.map((c) => ({ value: c, label: c })), p.connector, (v) => { p.connector = v as ConnectorId; });
      textField(grid, 'Protocol', p.protocol ?? '', (v) => { p.protocol = v.trim() || undefined; });
      numInput(grid, 'Bandwidth (Gbps)', p.bandwidthGbps ?? 0, (v) => { p.bandwidthGbps = v > 0 ? v : undefined; });
      numInput(grid, 'PoE Draw (W)', p.poeRequirementWatts ?? 0, (v) => { p.poeRequirementWatts = v > 0 ? v : undefined; });

      row.appendChild(grid);
      portHost.appendChild(row);
    });
  };

  const addBtn = document.createElement('button');
  addBtn.className = 'btn';
  addBtn.style.fontSize = '11px';
  addBtn.textContent = '+ Add Engineering Port';
  addBtn.onclick = () => {
    if (!draft.ports) draft.ports = [];
    const idx = draft.ports.length + 1;
    draft.ports.push({
      id: `port-${idx}`,
      label: `Port ${idx}`,
      direction: 'input',
      signalTypes: ['VIDEO'],
      connector: 'hdmi'
    });
    renderList();
  };
  parent.appendChild(addBtn);

  renderList();
}

/* ============================================================
   UI Element Builders
   ============================================================ */

function sectionTitle(parent: HTMLElement, text: string): void {
  const el = document.createElement('div');
  el.className = 'nav-section-title';
  el.style.marginTop = '8px';
  el.style.marginBottom = '4px';
  el.textContent = text;
  parent.appendChild(el);
}

function textField(parent: HTMLElement, label: string, value: string, onChange: (v: string) => void, cls = ''): void {
  const row = document.createElement('label');
  row.className = `form-row ${cls}`;
  row.innerHTML = `<span class="form-label" style="font-size:11px;">${label}</span>`;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'form-input';
  input.style.fontSize = '11px';
  input.value = value;
  input.onchange = () => onChange(input.value);
  row.appendChild(input);
  parent.appendChild(row);
}

function numInput(parent: HTMLElement, label: string, value: number, onChange: (v: number) => void): void {
  const row = document.createElement('label');
  row.className = 'form-row';
  row.innerHTML = `<span class="form-label" style="font-size:11px;">${label}</span>`;
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'form-input';
  input.style.fontSize = '11px';
  input.value = String(value);
  input.step = '0.01';
  input.onchange = () => onChange(parseFloat(input.value) || 0);
  row.appendChild(input);
  parent.appendChild(row);
}

function selectField(
  parent: HTMLElement,
  label: string,
  options: Array<{ value: string; label: string }>,
  value: string,
  onChange: (v: string) => void,
  cls = ''
): void {
  const row = document.createElement('label');
  row.className = `form-row ${cls}`;
  row.innerHTML = `<span class="form-label" style="font-size:11px;">${label}</span>`;
  const sel = document.createElement('select');
  sel.className = 'form-input';
  sel.style.fontSize = '11px';
  options.forEach((o) => {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    if (o.value === value) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.onchange = () => onChange(sel.value);
  row.appendChild(sel);
  parent.appendChild(row);
}

function checkboxField(parent: HTMLElement, label: string, checked: boolean, onChange: (v: boolean) => void): void {
  const row = document.createElement('label');
  row.style.display = 'flex';
  row.style.alignItems = 'center';
  row.style.gap = '6px';
  row.style.fontSize = '11.5px';
  row.style.cursor = 'pointer';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = checked;
  cb.onchange = () => onChange(cb.checked);
  row.append(cb, document.createTextNode(label));
  parent.appendChild(row);
}