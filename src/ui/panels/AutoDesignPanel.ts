import type { AppState } from '../../app/AppState';
import { defaultQuickRequirements, type DesignUseCase } from '../../autodesign/DesignRequirements';
import { LEARN_TOPICS } from '../../autodesign/Recommendations';
import { selectedOption } from '../../autodesign/DesignPipeline';
import type { DesignOption } from '../../autodesign/DesignProposal';
import { loadDefaultCatalog } from '../../catalog/loadCatalog';
import { ROOM_TEMPLATES } from '../../room/RoomTemplates';
import type { RoomType } from '../../room/RoomTemplateTypes';

const catalog = loadDefaultCatalog();

export function renderAutoDesignOverlay(host: HTMLElement, state: AppState): void {
  let el = host.querySelector('.ad-overlay') as HTMLElement | null;
  if (!state.autoDesignOpen) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement('div');
    el.className = 'ad-overlay';
    host.appendChild(el);
  }
  el.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'ad-card';
  el.appendChild(card);

  if (state.autoDesignRegenChoice) {
    renderRegen(card, state);
    return;
  }
  if (state.autoDesignProposal && state.autoDesignWhyOpen) {
    renderWhy(card, state);
    return;
  }
  if (state.autoDesignProposal) {
    renderProposal(card, state);
    return;
  }
  renderWizard(card, state);
}

function header(card: HTMLElement, title: string, state: AppState): void {
  const h = document.createElement('div');
  h.className = 'ad-header';
  const t = document.createElement('div');
  t.textContent = title;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'ad-close';
  close.textContent = '×';
  close.onclick = () => state.closeAutoDesign();
  h.append(t, close);
  card.appendChild(h);
}

function renderRegen(card: HTMLElement, state: AppState): void {
  header(card, 'Existing manual changes detected', state);
  const p = document.createElement('div');
  p.className = 'ad-body';
  p.textContent = 'This project has manual overrides or extra equipment. Auto Design will not overwrite them silently.';
  card.appendChild(p);
  const actions = document.createElement('div');
  actions.className = 'ad-actions';
  actions.append(
    btn('Create New Proposal', () => {
      state.autoDesignDraft = { ...state.autoDesignDraft, completeMissingOnly: true, constraints: { ...state.autoDesignDraft.constraints, keepExistingEquipment: true } };
      state.autoDesignRegenChoice = false;
      state.autoDesignProposal = null;
      state.notify();
    }, 'primary'),
    btn('Replace Auto-Generated Items', () => {
      state.autoDesignDraft = { ...state.autoDesignDraft, completeMissingOnly: false, constraints: { ...state.autoDesignDraft.constraints, keepExistingEquipment: false, keepExistingSeating: false } };
      state.autoDesignRegenChoice = false;
      state.autoDesignProposal = null;
      state.notify();
    }),
    btn('Cancel', () => state.closeAutoDesign())
  );
  card.appendChild(actions);
}

function renderWizard(card: HTMLElement, state: AppState): void {
  header(card, 'AUTO DESIGN', state);
  const modes = document.createElement('div');
  modes.className = 'ad-modes';
  ([['quick', 'Quick'], ['guided', 'Guided'], ['expert', 'Expert']] as const).forEach(([id, label]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ad-mode' + (state.autoDesignMode === id ? ' active' : '');
    b.textContent = label;
    b.onclick = () => state.setAutoDesignMode(id);
    modes.appendChild(b);
  });
  card.appendChild(modes);

  const body = document.createElement('div');
  body.className = 'ad-body';
  const d = state.autoDesignDraft;

  // Architectural Room Archetype Selection (§16, §1)
  const archSection = document.createElement('div');
  archSection.className = 'ad-archetypes';
  archSection.style.cssText = 'margin: 6px 0 12px 0;';
  const archLabel = document.createElement('div');
  archLabel.style.cssText = 'font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--text-secondary); margin-bottom: 6px; letter-spacing: 0.5px;';
  archLabel.textContent = 'Room Archetype';
  archSection.appendChild(archLabel);

  const archRow = document.createElement('div');
  archRow.style.cssText = 'display: flex; gap: 6px; flex-wrap: wrap;';

  const archetypes: Array<{ id: RoomType; label: string; icon: string }> = [
    { id: 'boardroom', label: 'Boardroom', icon: '🏛️' },
    { id: 'conference', label: 'Conference', icon: '👥' },
    { id: 'huddle', label: 'Huddle', icon: '💬' },
    { id: 'training', label: 'Training', icon: '🎓' },
    { id: 'classroom', label: 'Classroom', icon: '📚' },
    { id: 'executive', label: 'Executive', icon: '💼' },
    { id: 'multipurpose', label: 'Multipurpose', icon: '📐' }
  ];

  const currentType = d.roomType ?? (d.useCase === 'video_conference' ? 'boardroom' : d.useCase === 'training' ? 'training' : 'conference');

  archetypes.forEach((arch) => {
    const ab = document.createElement('button');
    ab.type = 'button';
    const isActive = currentType === arch.id;
    ab.className = 'ad-mode' + (isActive ? ' active' : '');
    ab.style.cssText = `padding: 5px 9px; font-size: 11px; cursor: pointer; border-radius: 4px; ${isActive ? 'background: var(--accent, #3b82f6); color: #fff; border-color: transparent;' : ''}`;
    ab.textContent = `${arch.icon} ${arch.label}`;
    ab.onclick = () => {
      const tmpl = ROOM_TEMPLATES[arch.id] ?? ROOM_TEMPLATES.conference;
      const avgCapacity = Math.round((tmpl.typicalCapacity[0] + tmpl.typicalCapacity[1]) / 2);
      state.setAutoDesignDraft({
        ...d,
        roomType: arch.id,
        room: {
          ...d.room,
          width: tmpl.defaultDimensions.width,
          length: tmpl.defaultDimensions.depth,
          height: tmpl.defaultDimensions.height
        },
        seating: {
          ...d.seating,
          count: avgCapacity
        },
        useCase: (arch.id === 'training' || arch.id === 'classroom') ? 'training' : (arch.id === 'huddle' || arch.id === 'boardroom') ? 'video_conference' : 'meeting',
        presentation: {
          ...d.presentation,
          displayCount: tmpl.recommendedAv.minDisplays > 1 ? 'dual' : 'single'
        },
        audio: {
          ...d.audio,
          speakerPreference: tmpl.recommendedAv.speakerDistribution.includes('ceiling') ? 'ceiling' : 'wall'
        }
      });
      state.notify();
    };
    archRow.appendChild(ab);
  });
  archSection.appendChild(archRow);
  body.appendChild(archSection);

  if (state.autoDesignMode === 'quick') {
    note(body, 'Enter the room size, how many people, and how the room is used. Then generate a starting design. You can inspect and change everything after Apply.');
  } else if (state.autoDesignMode === 'guided') {
    note(body, 'Each choice changes seating, viewing, coverage, or signal paths. Catalog specifications are never invented.');
  } else {
    note(body, 'Expert controls constrain catalog selection and placement. Engineering validity still wins over manufacturer preference.');
  }

  numRow(body, 'Room length (m)', d.room.length, (v) => state.setAutoDesignDraft({ room: { ...d.room, length: v } }));
  numRow(body, 'Room width (m)', d.room.width, (v) => state.setAutoDesignDraft({ room: { ...d.room, width: v } }));
  numRow(body, 'Room height (m)', d.room.height, (v) => state.setAutoDesignDraft({ room: { ...d.room, height: v } }));
  numRow(body, 'How many people use this room?', d.seating.count, (v) =>
    state.setAutoDesignDraft({ seating: { ...d.seating, count: v == null ? null : Math.round(v) } })
  );

  choice(
    body,
    'Use case',
    [
      ['meeting', 'Meeting'],
      ['presentation', 'Presentation'],
      ['video_conference', 'Video Conference'],
      ['hybrid', 'Hybrid Meeting'],
      ['training', 'Training']
    ],
    d.useCase,
    (v) => state.setAutoDesignDraft({ useCase: v as DesignUseCase })
  );
  if (state.autoDesignLearn || state.autoDesignMode === 'guided') why(body, 'displayCount');

  choice(
    body,
    'Displays',
    [
      ['single', 'Single'],
      ['dual', 'Dual'],
      ['no_preference', 'No preference']
    ],
    d.presentation.displayCount,
    (v) => state.setAutoDesignDraft({ presentation: { ...d.presentation, displayCount: v as typeof d.presentation.displayCount } })
  );
  if (state.autoDesignMode === 'guided') why(body, 'displaySize');

  choice(
    body,
    'Audio',
    [
      ['basic', 'Basic'],
      ['speech', 'Speech focused'],
      ['full_room', 'Full room audio']
    ],
    d.audio.priority,
    (v) =>
      state.setAutoDesignDraft({
        audio: { ...d.audio, required: true, priority: v as typeof d.audio.priority }
      })
  );

  choice(
    body,
    'Microphones',
    [
      ['table', 'Table'],
      ['ceiling', 'Ceiling'],
      ['no_preference', 'No preference']
    ],
    d.microphones.typePreference,
    (v) => state.setAutoDesignDraft({ microphones: { required: true, typePreference: v as typeof d.microphones.typePreference } })
  );
  if (state.autoDesignLearn) why(body, 'mics');

  choice(
    body,
    'Camera',
    [
      ['required', 'Required'],
      ['optional', 'Optional'],
      ['not_required', 'Not required']
    ],
    d.camera.required,
    (v) => state.setAutoDesignDraft({ camera: { required: v as typeof d.camera.required } })
  );

  if (state.autoDesignMode === 'guided' || state.autoDesignMode === 'expert') {
    const adv = document.createElement('div');
    adv.className = 'ad-section';
    adv.textContent = 'Guided options';
    body.appendChild(adv);
    check(body, 'Keep existing equipment when compatible', d.constraints.keepExistingEquipment, (on) =>
      state.setAutoDesignDraft({ constraints: { ...d.constraints, keepExistingEquipment: on } })
    );
    check(body, 'Complete missing subsystems only', d.completeMissingOnly, (on) => state.setAutoDesignDraft({ completeMissingOnly: on }));
    check(body, 'Do not use wall-mounted speakers', d.constraints.noWallSpeakers, (on) =>
      state.setAutoDesignDraft({ constraints: { ...d.constraints, noWallSpeakers: on } })
    );
  }

  if (state.autoDesignMode === 'expert') {
    const adv = document.createElement('div');
    adv.className = 'ad-section';
    adv.textContent = 'Expert constraints';
    body.appendChild(adv);
    numRow(body, 'Display size min (in)', d.presentation.sizeMinIn ?? null, (v) =>
      state.setAutoDesignDraft({ presentation: { ...d.presentation, sizeMinIn: v ?? undefined } })
    );
    numRow(body, 'Display size max (in)', d.presentation.sizeMaxIn ?? null, (v) =>
      state.setAutoDesignDraft({ presentation: { ...d.presentation, sizeMaxIn: v ?? undefined } })
    );
    textRow(body, 'Preferred manufacturers (comma)', d.preferences.manufacturers.join(', '), (s) =>
      state.setAutoDesignDraft({
        preferences: {
          ...d.preferences,
          manufacturers: s
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean)
        }
      })
    );
    check(body, 'Manufacturers exclusive (never invent specs to satisfy preference)', d.constraints.manufacturersExclusive, (on) =>
      state.setAutoDesignDraft({ constraints: { ...d.constraints, manufacturersExclusive: on } })
    );
    check(body, 'Do not place equipment on rear wall', d.constraints.noRearWallEquipment, (on) =>
      state.setAutoDesignDraft({ constraints: { ...d.constraints, noRearWallEquipment: on } })
    );
    check(body, 'Require DSP', d.system.dspRequired === true, (on) =>
      state.setAutoDesignDraft({ system: { ...d.system, dspRequired: on ? true : 'auto' } })
    );
    check(body, 'Require switching', d.system.switchingRequired === true, (on) =>
      state.setAutoDesignDraft({ system: { ...d.system, switchingRequired: on ? true : 'auto' } })
    );
    check(body, 'Require control surface', d.system.controlRequired, (on) =>
      state.setAutoDesignDraft({ system: { ...d.system, controlRequired: on } })
    );
    choice(
      body,
      'Speaker preference',
      [
        ['ceiling', 'Ceiling'],
        ['wall', 'Wall (engine gap if no ceiling grid)'],
        ['no_preference', 'No preference']
      ],
      d.audio.speakerPreference,
      (v) => state.setAutoDesignDraft({ audio: { ...d.audio, speakerPreference: v as typeof d.audio.speakerPreference } })
    );
  }

  const learn = document.createElement('label');
  learn.className = 'ad-learn';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = state.autoDesignLearn;
  cb.onchange = () => state.setAutoDesignLearn(cb.checked);
  learn.append(cb, document.createTextNode(' LEARN — show short Why? notes'));
  body.appendChild(learn);
  card.appendChild(body);

  const actions = document.createElement('div');
  actions.className = 'ad-actions';
  actions.append(
    btn('GENERATE DESIGN', () => state.generateAutoDesignProposal(), 'primary'),
    btn('Reset', () => {
      state.autoDesignDraft = defaultQuickRequirements();
      state.notify();
    }),
    btn('Cancel', () => state.closeAutoDesign())
  );
  card.appendChild(actions);
}

function renderProposal(card: HTMLElement, state: AppState): void {
  const p = state.autoDesignProposal!;
  header(card, 'AUTO DESIGN PROPOSAL', state);
  const body = document.createElement('div');
  body.className = 'ad-body';

  if (p.status !== 'ok') {
    const err = document.createElement('div');
    err.className = 'ad-block';
    err.textContent = p.blockingReason?.startsWith('NO VALID LAYOUT') ? 'NO VALID LAYOUT' : p.status === 'no_valid_design' ? 'NO VALID DESIGN FOUND' : 'Requirements are not ready';
    body.appendChild(err);
    note(body, p.blockingReason ?? 'Cannot generate.');
    p.requirementIssues.forEach((i) => note(body, i.message));
    card.appendChild(body);
    const actions = document.createElement('div');
    actions.className = 'ad-actions';
    actions.append(
      btn('Modify requirements', () => {
        state.autoDesignProposal = null;
        state.notify();
      }, 'primary'),
      btn('Reduce seating', () => {
        const n = state.autoDesignDraft.seating.count;
        state.autoDesignDraft = {
          ...state.autoDesignDraft,
          seating: { ...state.autoDesignDraft.seating, count: n && n > 4 ? Math.max(4, n - 4) : 6 }
        };
        state.autoDesignProposal = null;
        state.notify();
      }),
      btn('Change layout', () => {
        state.autoDesignDraft = {
          ...state.autoDesignDraft,
          seating: { ...state.autoDesignDraft.seating, layout: 'classroom' }
        };
        state.autoDesignProposal = null;
        state.notify();
      }),
      btn('Increase room size', () => {
        const room = state.autoDesignDraft.room;
        state.autoDesignDraft = {
          ...state.autoDesignDraft,
          room: {
            length: (room.length ?? 8) + 2,
            width: (room.width ?? 6) + 2,
            height: room.height
          }
        };
        state.autoDesignProposal = null;
        state.notify();
      }),
      btn('Manual design', () => {
        state.closeAutoDesign();
        state.setDesignTool('seating');
      })
    );
    card.appendChild(actions);
    return;
  }

  const opt = selectedOption(p)!;
  if (picksRetained(opt, 'display')) {
    note(body, '✓ Existing display retained');
  }
  if (p.missing.length) note(body, 'Complete missing: ' + p.missing.join(', '));

  if (p.options.length > 1) {
    const row = document.createElement('div');
    row.className = 'ad-modes';
    p.options.forEach((o) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ad-mode' + (p.selectedOptionId === o.id ? ' active' : '');
      b.textContent = o.label;
      b.onclick = () => state.selectAutoDesignOption(o.id);
      row.appendChild(b);
    });
    body.appendChild(row);
  }

  summary(body, 'ROOM', `${opt.room.width.toFixed(1)} × ${opt.room.depth.toFixed(1)} × ${opt.room.height.toFixed(1)} m`);
  summary(body, 'SEATING', `${opt.seats.length} people`);
  summary(body, 'VIDEO', videoLine(opt));
  summary(body, 'AUDIO', audioLine(opt));
  summary(body, 'CAMERA', cameraLine(opt));
  summary(body, 'SYSTEM', systemLine(opt));
  summary(
    body,
    'VALIDATION',
    `✓ ${opt.validation.passCount} passed   ⚠ ${opt.validation.warningCount} warnings   ✕ ${opt.validation.errorCount} errors`
  );

  (['display', 'microphone', 'speaker', 'camera'] as const).forEach((k) => {
    const pick = opt.picks[k];
    if (!pick) return;
    const box = document.createElement('div');
    box.className = 'ad-pick';
    const incomplete = pick.completeness !== 'complete' || pick.status === 'incomplete';
    const title = document.createElement('div');
    title.className = 'ad-pick-title';
    title.textContent = incomplete
      ? `${k.toUpperCase()} — ⚠ DATA INCOMPLETE`
      : `${k.toUpperCase()} — ${pick.retainedExisting ? '✓ Existing retained — ' : '✓ '}${pick.name}`;
    box.appendChild(title);
    const reason = document.createElement('div');
    reason.className = 'muted';
    reason.textContent = pick.reason;
    box.appendChild(reason);
    if (incomplete) {
      const data = document.createElement('div');
      data.className = 'ad-block';
      data.style.marginTop = '6px';
      data.textContent = pick.completenessReason;
      box.appendChild(data);
      const catBtn = document.createElement('button');
      catBtn.type = 'button';
      catBtn.className = 'btn';
      catBtn.textContent = 'Open catalog';
      catBtn.onclick = () => {
        state.closeAutoDesign();
        state.setDesignTool('catalog');
      };
      box.appendChild(catBtn);
    } else {
      const crit = document.createElement('div');
      crit.className = 'muted';
      crit.textContent = `Criterion: ${pick.criterion}`;
      const act = document.createElement('div');
      act.className = 'muted';
      act.textContent = `Result: ${pick.actual}`;
      box.append(crit, act);
    }
    if (pick.explanation) {
      const expBox = document.createElement('div');
      expBox.style.cssText = 'margin-top: 8px; padding: 8px 10px; background: rgba(59, 130, 246, 0.08); border-left: 3px solid var(--accent, #3b82f6); border-radius: 4px; font-size: 11px;';
      const headline = document.createElement('div');
      headline.style.cssText = 'font-weight: 600; color: var(--text-primary); margin-bottom: 3px;';
      headline.textContent = `Rationale: ${pick.explanation.headline}`;
      const rationale = document.createElement('div');
      rationale.style.cssText = 'color: var(--text-secondary); line-height: 1.4;';
      rationale.textContent = pick.explanation.rationale;
      const std = document.createElement('div');
      std.style.cssText = 'color: var(--accent, #3b82f6); font-size: 10px; margin-top: 4px; font-weight: 500;';
      std.textContent = `Standards: ${pick.explanation.standardsCited.join(' • ')}`;
      expBox.append(headline, rationale, std);
      box.appendChild(expBox);
    }
    pick.alternatives.forEach((a) => {
      const alt = document.createElement('div');
      alt.className = 'muted';
      alt.textContent = `Alternative: ${a.name} — ${a.reason}`;
      box.appendChild(alt);
    });
    body.appendChild(box);
  });
  opt.topologyNotes.slice(0, 6).forEach((n) => note(body, n));
  p.spatialIssues.forEach((i) => note(body, i.message));
  card.appendChild(body);

  const actions = document.createElement('div');
  actions.className = 'ad-actions';
  actions.append(
    btn('APPLY DESIGN', () => state.applyAutoDesignProposal(), 'primary'),
    btn('WHY THIS DESIGN?', () => state.setAutoDesignWhyOpen(true)),
    btn('Modify', () => {
      state.autoDesignProposal = null;
      state.notify();
    }),
    btn('Cancel', () => state.closeAutoDesign())
  );
  card.appendChild(actions);
}

function renderWhy(card: HTMLElement, state: AppState): void {
  header(card, 'WHY THIS DESIGN?', state);
  const opt = selectedOption(state.autoDesignProposal!);
  const body = document.createElement('div');
  body.className = 'ad-body';
  opt?.why.forEach((w, i) => {
    const row = document.createElement('div');
    row.className = 'ad-why';
    row.textContent = `${i + 1}. ${w}`;
    body.appendChild(row);
  });
  card.appendChild(body);
  const actions = document.createElement('div');
  actions.className = 'ad-actions';
  actions.append(btn('Back to proposal', () => state.setAutoDesignWhyOpen(false), 'primary'));
  card.appendChild(actions);
}

function picksRetained(opt: DesignOption, key: 'display' | 'microphone' | 'speaker' | 'camera'): boolean {
  return !!opt.picks[key]?.retainedExisting;
}

function videoLine(opt: DesignOption): string {
  const n = countCat(opt, 'display');
  const pick = opt.picks.display;
  if (pick?.retainedExisting) return '✓ Existing display retained · viewing evaluated';
  if (!n) return 'None proposed';
  return `✓ ${pick?.name ?? `${n} display(s)`} · viewing evaluated`;
}

function audioLine(opt: DesignOption): string {
  const sp = countCat(opt, 'speaker');
  const mic = countCat(opt, 'microphone');
  const bits = [];
  if (sp) bits.push(`✓ ${sp} speaker${sp === 1 ? '' : 's'}`);
  if (mic) bits.push(`✓ ${mic} microphone${mic === 1 ? '' : 's'}`);
  return bits.join(' · ') || 'None proposed';
}

function cameraLine(opt: DesignOption): string {
  const pick = opt.picks.camera;
  if (pick && pick.completeness !== 'complete') return '⚠ DATA INCOMPLETE — FOV data missing from catalog';
  const n = countCat(opt, 'camera');
  if (!n) return 'Not required / not proposed';
  return `✓ ${n} camera · FOV evaluated`;
}

function systemLine(opt: DesignOption): string {
  if (!opt.connections.length) return '⚠ Signal paths incomplete (catalog ports missing — not invented)';
  return `✓ ${opt.connections.length} catalog-valid connection${opt.connections.length === 1 ? '' : 's'}`;
}

function countCat(opt: DesignOption, cat: string): number {
  return opt.equipment.filter((e) => catalog.get(e.productId)?.category === cat).length;
}

function btn(label: string, onClick: () => void, variant?: 'primary'): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn' + (variant === 'primary' ? ' primary' : '');
  b.textContent = label;
  b.onclick = onClick;
  return b;
}

function note(parent: HTMLElement, text: string): void {
  const n = document.createElement('div');
  n.className = 'badge-note';
  n.textContent = text;
  parent.appendChild(n);
}

function summary(parent: HTMLElement, k: string, v: string): void {
  const row = document.createElement('div');
  row.className = 'metric-row';
  row.innerHTML = `<span class="label">${k}</span><span class="value">${v}</span>`;
  parent.appendChild(row);
}

function numRow(parent: HTMLElement, label: string, value: number | null, set: (v: number | null) => void): void {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const l = document.createElement('label');
  l.textContent = label;
  const i = document.createElement('input');
  i.type = 'number';
  i.step = '0.1';
  i.value = value == null ? '' : String(value);
  i.oninput = () => set(i.value === '' ? null : Number(i.value));
  wrap.append(l, i);
  parent.appendChild(wrap);
}

function textRow(parent: HTMLElement, label: string, value: string, set: (v: string) => void): void {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const l = document.createElement('label');
  l.textContent = label;
  const i = document.createElement('input');
  i.type = 'text';
  i.value = value;
  i.oninput = () => set(i.value);
  wrap.append(l, i);
  parent.appendChild(wrap);
}

function choice(parent: HTMLElement, label: string, options: string[][], value: string, set: (v: string) => void): void {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const l = document.createElement('label');
  l.textContent = label;
  wrap.appendChild(l);
  const row = document.createElement('div');
  row.className = 'ad-choices';
  options.forEach(([id, text]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ad-choice' + (value === id ? ' active' : '');
    b.textContent = text;
    b.onclick = () => set(id);
    row.appendChild(b);
  });
  wrap.appendChild(row);
  parent.appendChild(wrap);
}

function check(parent: HTMLElement, label: string, on: boolean, set: (v: boolean) => void): void {
  const wrap = document.createElement('label');
  wrap.className = 'ad-learn';
  const i = document.createElement('input');
  i.type = 'checkbox';
  i.checked = on;
  i.onchange = () => set(i.checked);
  wrap.append(i, document.createTextNode(' ' + label));
  parent.appendChild(wrap);
}

function why(parent: HTMLElement, topic: keyof typeof LEARN_TOPICS): void {
  const t = LEARN_TOPICS[topic];
  const n = document.createElement('div');
  n.className = 'ad-why-inline';
  n.textContent = `Why? ${t.a}`;
  parent.appendChild(n);
}
