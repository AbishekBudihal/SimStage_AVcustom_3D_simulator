import type { AppState } from '../../app/AppState';
import { ROOM_PRESETS, applyPreset } from '../../room/RoomPresets';
import { createDefaultRoom } from '../../room/RoomModel';
import { defaultSeatingConfig, generateSeating, type SeatingLayout } from '../../room/SeatingGenerator';
import { renderEquipmentStep } from './EquipmentBrowser';
import { renderValidationPanel } from './ValidationPanel';
import { renderSimulationControlPanel } from './SimulationControlPanel';
import { renderSystemLibraryPanel } from './SystemLibraryPanel';
import { renderCableSchedulePanel } from './CableSchedulePanel';
import { renderDocumentationPanel } from './DocumentationPanel';

export function renderDesignPanel(container: HTMLElement, state: AppState): void {
  container.innerHTML = '';

  if (state.workspaceMode === 'validate') {
    renderValidationPanel(container, state);
    return;
  }
  if (state.workspaceMode === 'simulate') {
    renderSimulationControlPanel(container, state);
    return;
  }
  if (state.workspaceMode === 'docs') {
    renderDocumentationPanel(container, state);
    return;
  }
  if (state.workspaceMode === 'system') {
    const tabs = document.createElement('div');
    tabs.className = 'design-tools';
    (['library', 'cables'] as const).forEach((id) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tool-tab' + (state.systemPanelTab === id ? ' active' : '');
      b.textContent = id === 'library' ? 'Library' : 'Cables';
      b.onclick = () => state.setSystemPanelTab(id);
      tabs.appendChild(b);
    });
    container.appendChild(tabs);
    const body = document.createElement('div');
    container.appendChild(body);
    if (state.systemPanelTab === 'cables') {
      renderCableSchedulePanel(body, state);
    } else {
      renderSystemLibraryPanel(body, state);
    }
    return;
  }

  const tools = document.createElement('div');
  tools.className = 'design-tools';
  const tabs =
    state.uiComplexity === 'beginner'
      ? ([['room', 'Room'], ['catalog', 'Catalog']] as const)
      : ([['room', 'Room'], ['seating', 'Seating'], ['catalog', 'Catalog']] as const);
  tabs.forEach(([id, label]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tool-tab' + (state.designTool === id ? ' active' : '');
    b.textContent = label;
    b.onclick = () => state.setDesignTool(id);
    tools.appendChild(b);
  });
  container.appendChild(tools);

  const body = document.createElement('div');
  container.appendChild(body);

  switch (state.designTool) {
    case 'seating':
      renderSeatingStep(body, state);
      break;
    case 'catalog':
      renderEquipmentStep(body, state);
      break;
    default:
      renderProjectStep(body, state);
      renderRoomStep(body, state);
      break;
  }
}

function section(container: HTMLElement, title: string): HTMLElement {
  const t = document.createElement('div');
  t.className = 'nav-section-title';
  t.textContent = title;
  container.appendChild(t);
  const body = document.createElement('div');
  container.appendChild(body);
  return body;
}

function field(container: HTMLElement, labelText: string, input: HTMLElement): void {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const label = document.createElement('label');
  label.textContent = labelText;
  wrap.append(label, input);
  container.appendChild(wrap);
}

function renderProjectStep(container: HTMLElement, state: AppState): void {
  const body = section(container, 'Project Setup');
  const nameInput = document.createElement('input');
  nameInput.value = state.project.name;
  nameInput.oninput = () => (state.project.name = nameInput.value);
  field(body, 'Project Name', nameInput);

  const useCaseSelect = document.createElement('select');
  [
    ['huddle', 'Huddle Room'], ['small_meeting', 'Small Meeting Room'], ['conference', 'Medium Conference Room'],
    ['boardroom', 'Boardroom'], ['training', 'Training Room'], ['classroom', 'Classroom'],
    ['lecture_hall', 'Lecture Hall'], ['auditorium', 'Auditorium'], ['custom', 'Custom']
  ].forEach(([val, label]) => {
    const opt = document.createElement('option');
    opt.value = val; opt.textContent = label;
    if (val === state.project.roomUseCase) opt.selected = true;
    useCaseSelect.appendChild(opt);
  });
  useCaseSelect.onchange = () => (state.project.roomUseCase = useCaseSelect.value as any);
  field(body, 'What are you designing?', useCaseSelect);

  const autoBtn = document.createElement('button');
  autoBtn.className = 'btn primary';
  autoBtn.textContent = 'Auto Design';
  autoBtn.onclick = () => state.requestAutoDesign();
  body.appendChild(autoBtn);

  const nextBtn = document.createElement('button');
  nextBtn.className = 'btn primary';
  nextBtn.textContent = 'Continue → Room';
  nextBtn.onclick = () => {
    if (!state.room) {
      const room = applyPreset(createDefaultRoom(state.project.roomUseCase), state.project.roomUseCase);
      state.setRoom(room);
    }
    state.setDesignTool('room');
  };
  body.appendChild(nextBtn);
}

function renderRoomStep(container: HTMLElement, state: AppState): void {
  const body = section(container, 'Room Presets');
  const presetGrid = document.createElement('div');
  ROOM_PRESETS.forEach((p) => {
    const b = document.createElement('div');
    b.className = 'nav-item';
    b.textContent = `${p.label} · ${p.typicalCapacity[0]}-${p.typicalCapacity[1]} seats`;
    b.onclick = () => state.setRoom(applyPreset(state.room ?? createDefaultRoom(p.id), p.id));
    presetGrid.appendChild(b);
  });
  body.appendChild(presetGrid);

  const dimBody = section(container, 'Room Dimensions');
  if (!state.room) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML =
      '<div class="empty-title">No room defined</div><div class="empty-body">Open New Project to set type, capacity, and dimensions. A room is not created until you choose Auto Design or Start manually.</div>';
    dimBody.appendChild(empty);
    const newBtn = document.createElement('button');
    newBtn.className = 'btn primary';
    newBtn.textContent = 'New Project';
    newBtn.onclick = () => state.openNewProject();
    dimBody.appendChild(newBtn);
    return;
  }

  const room = state.room;

  const row = document.createElement('div');
  row.className = 'field-row';
  const wIn = document.createElement('input'); wIn.type = 'number'; wIn.step = '0.1'; wIn.value = String(room.width);
  const dIn = document.createElement('input'); dIn.type = 'number'; dIn.step = '0.1'; dIn.value = String(room.depth);
  const hIn = document.createElement('input'); hIn.type = 'number'; hIn.step = '0.1'; hIn.value = String(room.height);
  const apply = () => state.setRoom({ ...state.room!, width: Number(wIn.value), depth: Number(dIn.value), height: Number(hIn.value) });
  [wIn, dIn, hIn].forEach((i) => (i.onchange = apply));

  const wf = document.createElement('div'); wf.className = 'field'; wf.innerHTML = '<label>Width (m)</label>'; wf.appendChild(wIn);
  const df = document.createElement('div'); df.className = 'field'; df.innerHTML = '<label>Depth (m)</label>'; df.appendChild(dIn);
  const hf = document.createElement('div'); hf.className = 'field'; hf.innerHTML = '<label>Height (m)</label>'; hf.appendChild(hIn);
  row.append(wf, df, hf);
  dimBody.appendChild(row);
  const dimNote = document.createElement('div');
  dimNote.className = 'badge-note';
  dimNote.textContent = 'Changing room size does not regenerate seating. Use Regenerating Seating when you want a new furniture layout.';
  dimBody.appendChild(dimNote);
  const regen = document.createElement('button');
  regen.className = 'btn';
  regen.textContent = 'Regenerate Seating';
  regen.onclick = () => state.regenerateSeating(state.seats.length || state.setupDraft.capacity);
  dimBody.appendChild(regen);

  const next = document.createElement('button');
  next.className = 'btn primary';
  next.textContent = 'Continue → Seating';
  next.onclick = () => state.setDesignTool('seating');
  dimBody.appendChild(next);
}

function renderSeatingStep(container: HTMLElement, state: AppState): void {
  const body = section(container, 'Seating Configuration');
  const room = state.room ?? createDefaultRoom(state.project.roomUseCase);
  if (!state.room) state.setRoom(room);

  const layoutSelect = document.createElement('select');
  const layouts: [SeatingLayout, string][] = [
    ['conference', 'Conference'],
    ['boardroom', 'Boardroom'],
    ['training', 'Training'],
    ['classroom', 'Classroom'],
    ['flexible', 'Flexible'],
    ['custom', 'Custom'],
    ['theater', 'Theater'],
    ['u_shape', 'U-Shape'],
    ['hollow_square', 'Hollow Square'],
    ['auditorium_tiered', 'Auditorium (tiered rows)']
  ];
  layouts.forEach(([val, label]) => {
    const o = document.createElement('option'); o.value = val; o.textContent = label; layoutSelect.appendChild(o);
  });
  field(body, 'Layout', layoutSelect);

  const capInput = document.createElement('input');
  capInput.type = 'number'; capInput.value = '12';
  field(body, 'Capacity', capInput);

  const genBtn = document.createElement('button');
  genBtn.className = 'btn primary';
  genBtn.textContent = 'Regenerate Seating';
  genBtn.onclick = () => {
    const cfg = defaultSeatingConfig(Number(capInput.value), layoutSelect.value as SeatingLayout);
    const { seats, tables, warnings, valid, layoutReason } = generateSeating(state.room!, cfg);
    if (!valid) {
      const note = document.createElement('div');
      note.className = 'badge-note';
      note.style.color = 'var(--danger, #d6483f)';
      note.textContent =
        'NO VALID LAYOUT — ' +
        (warnings.find((w) => w.includes('cannot be accommodated')) ??
          'Requested seating cannot be accommodated with the selected room dimensions and required circulation.');
      body.appendChild(note);
      return;
    }
    state.setSeats(seats, tables, layoutSelect.value as SeatingLayout);
    const reason = document.createElement('div');
    reason.className = 'badge-note';
    reason.textContent = layoutReason;
    body.appendChild(reason);
    if (warnings.length) {
      const note = document.createElement('div');
      note.className = 'badge-note';
      note.style.color = 'var(--warning)';
      note.textContent = '⚠ ' + warnings.join(' ');
      body.appendChild(note);
    }
  };
  body.appendChild(genBtn);

  if (state.seats.length) {
    const summary = document.createElement('div');
    summary.className = 'badge-note';
    summary.textContent = `${state.seats.length} seats generated.`;
    body.appendChild(summary);
  }
}
