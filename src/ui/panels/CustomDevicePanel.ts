/**
 * CustomDevicePanel.ts
 * Form-based UI for creating custom AV devices.
 * Steps: Identity → Physical → Ports → Rack → Engineering → Save.
 */

import type { AppState } from '../../app/AppState';
import type { EquipmentCategory } from '../../catalog/EquipmentCatalog';
import type { PortDefinition, SignalType, PortDirection, ConnectorId } from '../../system/SystemTypes';
import { buildCustomDevice, validateCustomDeviceInput, type CustomDeviceInput } from '../../catalog/CustomDeviceBuilder';
import { saveUserDevice } from '../../catalog/UserLibrary';
import { loadDefaultCatalog } from '../../catalog/loadCatalog';

const catalog = loadDefaultCatalog();

const CATEGORIES: Array<{ id: EquipmentCategory; label: string }> = [
  { id: 'display', label: 'Display' },
  { id: 'camera', label: 'Camera' },
  { id: 'microphone', label: 'Microphone' },
  { id: 'speaker', label: 'Speaker' },
  { id: 'dsp', label: 'DSP / Audio Processor' },
  { id: 'amplifier', label: 'Amplifier' },
  { id: 'switcher', label: 'Switcher / Matrix' },
  { id: 'extender', label: 'Extender' },
  { id: 'source', label: 'Source / Input' },
  { id: 'network', label: 'Network Equipment' },
  { id: 'control', label: 'Control Processor' },
  { id: 'codec', label: 'Codec / Collaboration' }
];

const SIGNAL_TYPES: SignalType[] = ['VIDEO', 'AUDIO', 'USB', 'NETWORK', 'CONTROL', 'POWER', 'SERIAL', 'GPIO', 'DANTE', 'AES67'];
const DIRECTIONS: PortDirection[] = ['input', 'output', 'bidirectional'];
const CONNECTORS: ConnectorId[] = ['hdmi', 'displayport', 'usbc', 'usb-a', 'rj45', 'xlr', 'line-trs', 'phoenix', 'speakon', 'dsub9', 'bnc', 'terminal-block'];

export function renderCustomDevicePanel(container: HTMLElement, state: AppState, onClose: () => void): void {
  container.innerHTML = '';

  const draft: Partial<CustomDeviceInput> = {
    manufacturer: '',
    model: '',
    partNumber: '',
    category: 'dsp',
    provenance: 'user_defined',
    width: 0.48,
    height: 0.044,
    depth: 0.3,
    power: { powerWatts: 0, voltage: 0, poeClass: 'none' },
    ports: []
  };

  const wrapper = document.createElement('div');
  wrapper.className = 'custom-device-panel';

  const title = document.createElement('div');
  title.className = 'nav-section-title';
  title.textContent = 'CREATE CUSTOM DEVICE';
  wrapper.appendChild(title);

  // --- Identity ---
  sectionTitle(wrapper, 'Identity & Metadata');
  textField(wrapper, 'Manufacturer', draft.manufacturer ?? '', (v) => { draft.manufacturer = v; });
  textField(wrapper, 'Model', draft.model ?? '', (v) => { draft.model = v; });
  textField(wrapper, 'Part Number / SKU (optional)', draft.partNumber ?? '', (v) => { draft.partNumber = v; });
  selectField(
    wrapper,
    'Data Provenance',
    [
      { value: 'user_defined', label: 'User / Company Defined' },
      { value: 'verified', label: 'Manufacturer Verified (Datasheet)' },
      { value: 'estimated', label: 'Engineering Estimate' }
    ],
    draft.provenance ?? 'user_defined',
    (v) => { draft.provenance = v as any; }
  );
  selectField(wrapper, 'Category', CATEGORIES.map((c) => ({ value: c.id, label: c.label })), draft.category ?? 'dsp', (v) => { draft.category = v as EquipmentCategory; });
  textField(wrapper, 'Description (optional)', draft.description ?? '', (v) => { draft.description = v; });
  textField(wrapper, '3D Model Asset URL / Path (.glb optional)', draft.modelAsset ?? '', (v) => { draft.modelAsset = v; });

  // --- Physical ---
  sectionTitle(wrapper, 'Physical Dimensions');
  numInput(wrapper, 'Width (m)', draft.width ?? 0.48, (v) => { draft.width = v; });
  numInput(wrapper, 'Height (m)', draft.height ?? 0.044, (v) => { draft.height = v; });
  numInput(wrapper, 'Depth (m)', draft.depth ?? 0.3, (v) => { draft.depth = v; });
  numInput(wrapper, 'Weight (kg, optional)', draft.weightKg ?? 0, (v) => { draft.weightKg = v > 0 ? v : undefined; });

  // --- Electrical / Power ---
  sectionTitle(wrapper, 'Electrical & Power (Optional)');
  numInput(wrapper, 'Power (Watts)', draft.powerWatts ?? 0, (v) => {
    draft.powerWatts = v > 0 ? v : undefined;
    if (!draft.power) draft.power = {};
    draft.power.powerWatts = v > 0 ? v : undefined;
  });
  numInput(wrapper, 'Voltage (V)', 0, (v) => {
    if (!draft.power) draft.power = {};
    draft.power.voltage = v > 0 ? v : undefined;
  });
  selectField(
    wrapper,
    'PoE Classification',
    [
      { value: 'none', label: 'None (AC / Local DC)' },
      { value: 'PoE (15.4W)', label: 'PoE 802.3af (15.4W)' },
      { value: 'PoE+ (30W)', label: 'PoE+ 802.3at (30W)' },
      { value: 'PoE++ (60W)', label: 'PoE++ 802.3bt Type 3 (60W)' },
      { value: 'PoE++ (90W)', label: 'PoE++ 802.3bt Type 4 (90W)' }
    ],
    'none',
    (v) => {
      if (!draft.power) draft.power = {};
      draft.power.poeClass = v !== 'none' ? v : undefined;
    }
  );

  // --- Rack ---
  sectionTitle(wrapper, 'Rack Properties');
  numInput(wrapper, 'Rack Units (0 = not rackable)', draft.rackUnits ?? 0, (v) => { draft.rackUnits = v > 0 ? v : undefined; draft.rackMountable = v > 0; });

  // --- Ports ---
  sectionTitle(wrapper, 'Ports');
  const portHost = document.createElement('div');
  wrapper.appendChild(portHost);

  const addPortBtn = document.createElement('button');
  addPortBtn.className = 'btn';
  addPortBtn.textContent = '+ Add Port';
  addPortBtn.onclick = () => {
    if (!draft.ports) draft.ports = [];
    const idx = draft.ports.length + 1;
    draft.ports.push({
      id: `port-${idx}`,
      label: `Port ${idx}`,
      direction: 'input',
      signalTypes: ['VIDEO'],
      connector: 'hdmi'
    });
    renderPorts(portHost, draft.ports);
  };
  wrapper.appendChild(addPortBtn);

  // --- Errors + Actions ---
  const errorEl = document.createElement('div');
  errorEl.className = 'custom-device-errors';
  wrapper.appendChild(errorEl);

  const actions = document.createElement('div');
  actions.className = 'custom-device-actions';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn primary';
  saveBtn.textContent = 'Save to Library & Add to Project';
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
  saveOnlyBtn.textContent = 'Save to Library Only';
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

  container.appendChild(wrapper);
}

function renderPorts(host: HTMLElement, ports: PortDefinition[]): void {
  host.innerHTML = '';
  ports.forEach((port, i) => {
    const row = document.createElement('div');
    row.className = 'port-editor-row';

    textField(row, 'ID', port.id, (v) => { port.id = v; }, 'port-field-sm');
    textField(row, 'Label', port.label, (v) => { port.label = v; }, 'port-field-sm');
    selectField(row, 'Dir', DIRECTIONS.map((d) => ({ value: d, label: d.toUpperCase() })), port.direction, (v) => { port.direction = v as PortDirection; }, 'port-field-sm');
    selectField(row, 'Signal', SIGNAL_TYPES.map((s) => ({ value: s, label: s })), port.signalTypes[0], (v) => { port.signalTypes = [v as SignalType]; }, 'port-field-sm');
    selectField(row, 'Connector', CONNECTORS.map((c) => ({ value: c, label: c })), port.connector, (v) => { port.connector = v as ConnectorId; }, 'port-field-sm');
    textField(row, 'Protocol', port.protocol ?? '', (v) => { port.protocol = v.trim() || undefined; }, 'port-field-sm');

    const del = document.createElement('button');
    del.className = 'btn btn-sm';
    del.textContent = '×';
    del.onclick = () => { ports.splice(i, 1); renderPorts(host, ports); };
    row.appendChild(del);

    host.appendChild(row);
  });
}

// --- Helpers ---

function sectionTitle(parent: HTMLElement, text: string): void {
  const el = document.createElement('div');
  el.className = 'nav-section-title';
  el.style.marginTop = '12px';
  el.textContent = text;
  parent.appendChild(el);
}

function textField(parent: HTMLElement, label: string, value: string, onChange: (v: string) => void, cls = ''): void {
  const row = document.createElement('label');
  row.className = `form-row ${cls}`;
  row.innerHTML = `<span class="form-label">${label}</span>`;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'form-input';
  input.value = value;
  input.onchange = () => onChange(input.value);
  row.appendChild(input);
  parent.appendChild(row);
}

function numInput(parent: HTMLElement, label: string, value: number, onChange: (v: number) => void): void {
  const row = document.createElement('label');
  row.className = 'form-row';
  row.innerHTML = `<span class="form-label">${label}</span>`;
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'form-input';
  input.value = String(value);
  input.step = '0.001';
  input.onchange = () => onChange(parseFloat(input.value) || 0);
  row.appendChild(input);
  parent.appendChild(row);
}

function selectField(parent: HTMLElement, label: string, options: Array<{ value: string; label: string }>, value: string, onChange: (v: string) => void, cls = ''): void {
  const row = document.createElement('label');
  row.className = `form-row ${cls}`;
  row.innerHTML = `<span class="form-label">${label}</span>`;
  const sel = document.createElement('select');
  sel.className = 'form-input';
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
