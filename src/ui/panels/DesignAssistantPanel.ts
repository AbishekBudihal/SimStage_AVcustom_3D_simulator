import type { AppState } from '../../app/AppState';
import { loadDefaultCatalog } from '../../catalog/loadCatalog';
import { inventory } from '../../autodesign/DesignPipeline';
import { recommendationsAfterManual } from '../../autodesign/Recommendations';
import { selectedOption } from '../../autodesign/DesignPipeline';
import { validationReportFor } from '../../av/validation/validationCache';
import { getActiveDisplay, projectObstacles, summarizeDesignHealth } from '../../av/DesignAnalysis';
import { summarizeCameraCoverage } from '../../av/CameraAnalysis';
import { resolveProjectSpeakers, usableSpeakerPlacements } from '../../av/SpeakerAnalysis';
import { evaluateRoomAudioCoverage, DEFAULT_EAR_HEIGHT_M } from '../../av/SpeakerCoverageEngine';
import { systemCompletenessFromFindings } from '../../system/ConnectionStatus';

const catalog = loadDefaultCatalog();

export function renderDesignAssistant(host: HTMLElement, state: AppState): void {
  let el = host.querySelector('.ad-assistant') as HTMLElement | null;
  if (state.workspaceMode === 'system' || state.autoDesignOpen) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement('div');
    el.className = 'ad-assistant';
    host.appendChild(el);
  }
  el.innerHTML = '';

  const report = validationReportFor(state);
  const attention = report.summary.warningCount + report.summary.errorCount;
  const inv = inventory(
    {
      room: state.room,
      seats: state.seats,
      tables: state.tables,
      equipment: state.equipment,
      connections: state.connections,
      routes: state.routes
    },
    catalog
  );

  if (!state.assistantDrawerOpen) {
    el.className = 'ad-assistant chip';
    const title = document.createElement('div');
    title.className = 'ad-assistant-title';
    title.textContent = 'Design Assistant  ✦';
    const body = document.createElement('div');
    body.className = 'muted';
    body.textContent = attention
      ? (() => {
          const first = report.findings.find((f) => f.severity === 'error' || f.severity === 'warning');
          return first ? `${first.category.toUpperCase()}  ${first.title}` : `${attention} issues need attention`;
        })()
      : 'Room checklist looks clear';
    const review = document.createElement('button');
    review.className = 'btn primary';
    review.textContent = 'Review';
    review.onclick = () => state.toggleAssistantDrawer();
    el.append(title, body, review);
    return;
  }

  el.className = 'ad-assistant drawer';
  const title = document.createElement('div');
  title.className = 'ad-assistant-title';
  title.textContent = 'Design Assistant';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'ad-close';
  close.setAttribute('aria-label', 'Close assistant');
  close.textContent = '✕';
  close.onclick = () => state.toggleAssistantDrawer();
  const head = document.createElement('div');
  head.style.display = 'flex';
  head.style.justifyContent = 'space-between';
  head.append(title, close);
  el.appendChild(head);

  // ── Tab switcher ──────────────────────────────────────────
  const tabsContainer = document.createElement('div');
  tabsContainer.className = 'ad-assistant-tabs';

  const copilotTabBtn = document.createElement('button');
  copilotTabBtn.type = 'button';
  copilotTabBtn.className = `ad-tab-btn ${state.assistantTab === 'copilot' ? 'active' : ''}`;
  copilotTabBtn.textContent = '✦ Copilot';
  copilotTabBtn.onclick = () => state.setAssistantTab('copilot');

  const checklistTabBtn = document.createElement('button');
  checklistTabBtn.type = 'button';
  checklistTabBtn.className = `ad-tab-btn ${state.assistantTab === 'checklist' ? 'active' : ''}`;
  checklistTabBtn.textContent = attention > 0 ? `📋 Checklist (${attention})` : '📋 Checklist';
  checklistTabBtn.onclick = () => state.setAssistantTab('checklist');

  tabsContainer.append(copilotTabBtn, checklistTabBtn);
  el.appendChild(tabsContainer);

  // ── Copilot Tab Content ───────────────────────────────────
  if (state.assistantTab === 'copilot') {
    const copilotBody = document.createElement('div');
    copilotBody.className = 'ad-copilot-body';

    // Quick action prompt chips
    const chipsContainer = document.createElement('div');
    chipsContainer.className = 'ad-prompt-chips';

    const quickPrompts = [
      { label: '⚡ Auto-Fix', cmd: 'auto fix issues' },
      { label: '📋 BOM', cmd: 'recommend bom' },
      { label: '🎯 Center Display', cmd: 'center display' },
      { label: '🔍 Audit', cmd: 'audit design' },
      { label: '📦 Equipment', cmd: 'list equipment' }
    ];

    quickPrompts.forEach(({ label, cmd }) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'ad-prompt-chip';
      chip.textContent = label;
      chip.disabled = state.copilotTyping;
      chip.onclick = () => state.sendCopilotMessage(cmd);
      chipsContainer.appendChild(chip);
    });
    copilotBody.appendChild(chipsContainer);

    // Chat Message Feed
    const feed = document.createElement('div');
    feed.className = 'ad-chat-feed';

    if (!state.copilotMessages.length) {
      const emptyNotice = document.createElement('div');
      emptyNotice.className = 'ad-chat-empty';
      emptyNotice.innerHTML = `
        <div style="font-weight:600;margin-bottom:4px;color:var(--text-primary);">SimStage AV Copilot</div>
        <div style="margin-bottom:6px;">I can audit system flow, recommend BOM equipment, optimize layout, and resolve engineering warnings automatically.</div>
        <div class="muted">Click a quick action above or type an instruction below.</div>
      `;
      feed.appendChild(emptyNotice);
    } else {
      state.copilotMessages.forEach((msg) => {
        const bubble = document.createElement('div');
        bubble.className = `ad-chat-bubble ${msg.role === 'user' ? 'user' : 'assistant'}`;

        const roleLabel = document.createElement('div');
        roleLabel.className = 'ad-bubble-role';
        roleLabel.textContent = msg.role === 'user' ? 'You' : '✦ Copilot';
        bubble.appendChild(roleLabel);

        const content = document.createElement('div');
        content.className = 'ad-bubble-content';
        content.textContent = msg.content;
        bubble.appendChild(content);

        feed.appendChild(bubble);
      });
    }

    if (state.copilotTyping) {
      const typing = document.createElement('div');
      typing.className = 'ad-chat-bubble assistant ad-typing-bubble';
      typing.innerHTML = '<span class="ad-typing-indicator">Copilot is working...</span>';
      feed.appendChild(typing);
    }

    copilotBody.appendChild(feed);

    // Auto scroll feed to bottom
    setTimeout(() => {
      feed.scrollTop = feed.scrollHeight;
    }, 10);

    // Input Row
    const inputRow = document.createElement('form');
    inputRow.className = 'ad-chat-input-row';
    inputRow.onsubmit = (e) => {
      e.preventDefault();
      const val = input.value.trim();
      if (val && !state.copilotTyping) {
        input.value = '';
        state.sendCopilotMessage(val);
      }
    };

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'ad-chat-input';
    input.placeholder = 'Ask copilot or type an action...';
    input.disabled = state.copilotTyping;

    const sendBtn = document.createElement('button');
    sendBtn.type = 'submit';
    sendBtn.className = 'ad-chat-send-btn';
    sendBtn.textContent = '➤';
    sendBtn.disabled = state.copilotTyping;

    inputRow.append(input, sendBtn);
    copilotBody.appendChild(inputRow);

    if (state.copilotMessages.length > 0) {
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'ad-chat-clear-btn';
      clearBtn.textContent = 'Clear chat history';
      clearBtn.onclick = () => state.clearCopilotHistory();
      copilotBody.appendChild(clearBtn);
    }

    el.appendChild(copilotBody);
    return;
  }

  // ── Checklist Tab Content ─────────────────────────────────
  const checklistBody = document.createElement('div');
  checklistBody.className = 'ad-checklist-body';

  const healthTitle = document.createElement('div');
  healthTitle.className = 'nav-section-title';
  healthTitle.textContent = 'DESIGN HEALTH';
  checklistBody.appendChild(healthTitle);
  const display = getActiveDisplay(state.equipment, catalog);
  const obstacles = projectObstacles(state.room, state.tables, state.racks);
  const viewing = summarizeDesignHealth(state.seats, display, obstacles);
  const viewRow = document.createElement('button');
  viewRow.type = 'button';
  viewRow.className = 'ad-asst-row';
  viewRow.style.cssText = 'display:block;width:100%;text-align:left;background:transparent;border:none;cursor:pointer';
  const viewMark = !display ? '—' : viewing.failCount ? '⚠' : viewing.warningCount ? '⚠' : '✓';
  viewRow.textContent = display
    ? `${viewMark} Display  ${viewing.passCount}/${viewing.totalSeats} seats within viewing guidance`
    : '— Display  no display to analyze';
  viewRow.onclick = () => {
    state.setWorkspaceMode('simulate');
    if (display) {
      const inst = state.equipment.find((e) => catalog.get(e.productId)?.category === 'display');
      if (inst) state.analyzeEquipment(inst.instanceId);
    }
  };
  checklistBody.appendChild(viewRow);

  const cam = summarizeCameraCoverage(state.seats, state.equipment, catalog, state.room, state.tables);
  if (state.equipment.some((e) => catalog.get(e.productId)?.category === 'camera')) {
    const camRow = document.createElement('button');
    camRow.type = 'button';
    camRow.className = 'ad-asst-row';
    camRow.style.cssText = viewRow.style.cssText;
    camRow.textContent = `${cam.visibleSeats === cam.totalSeats && cam.totalSeats ? '✓' : '⚠'} Camera  ${cam.visibleSeats}/${cam.totalSeats} seats in FOV (${cam.coveragePct}% geometric)`;
    camRow.onclick = () => {
      const inst = state.equipment.find((e) => catalog.get(e.productId)?.category === 'camera');
      if (inst) state.analyzeEquipment(inst.instanceId);
      else state.setWorkspaceMode('simulate');
    };
    checklistBody.appendChild(camRow);
  }

  const speakers = usableSpeakerPlacements(resolveProjectSpeakers(state.equipment, catalog));
  if (speakers.length) {
    const audio = evaluateRoomAudioCoverage(
      state.seats.map((s) => ({ seatId: s.id, x: s.x, z: s.z, earHeightM: DEFAULT_EAR_HEIGHT_M })),
      speakers
    );
    const audioRow = document.createElement('button');
    audioRow.type = 'button';
    audioRow.className = 'ad-asst-row';
    audioRow.style.cssText = viewRow.style.cssText;
    audioRow.textContent = `${audio.coveredSeats === audio.totalSeats ? '✓' : '⚠'} Audio  geometric coverage ${audio.coveredSeats}/${audio.totalSeats} seats`;
    audioRow.onclick = () => {
      const inst = state.equipment.find((e) => catalog.get(e.productId)?.category === 'speaker');
      if (inst) state.analyzeEquipment(inst.instanceId);
    };
    checklistBody.appendChild(audioRow);
  }

  const rackIssue = report.findings.find((f) => f.code.startsWith('RACK-') && f.severity !== 'pass');
  if (state.racks.length) {
    const rackRow = document.createElement('button');
    rackRow.type = 'button';
    rackRow.className = 'ad-asst-row';
    rackRow.style.cssText = viewRow.style.cssText;
    rackRow.textContent = rackIssue ? `⚠ Rack  ${rackIssue.title}` : '✓ Rack  service / capacity checks passing';
    rackRow.onclick = () => {
      state.setWorkspaceMode('validate');
      if (state.racks[0]) state.select('rack', state.racks[0].id);
    };
    checklistBody.appendChild(rackRow);
  }

  const sysItems = systemCompletenessFromFindings(report.findings, state.equipment, catalog);
  if (sysItems.length) {
    const sysTitle = document.createElement('div');
    sysTitle.className = 'nav-section-title';
    sysTitle.textContent = 'SYSTEM COMPLETENESS';
    checklistBody.appendChild(sysTitle);
    sysItems.forEach((item) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'ad-asst-row';
      row.style.cssText = viewRow.style.cssText;
      const mark = item.mark === 'ok' ? '✓' : item.mark === 'err' ? '✕' : item.mark === 'warn' ? '⚠' : '○';
      row.textContent = `${mark} ${item.label}`;
      row.onclick = () => state.setWorkspaceMode('system');
      checklistBody.appendChild(row);
    });
  }

  const attn = document.createElement('div');
  attn.className = 'badge-note';
  attn.textContent = `${attention} issue${attention === 1 ? '' : 's'} require attention`;
  checklistBody.appendChild(attn);

  const rows: Array<[string, boolean | 'warn' | 'err', () => void]> = [
    ['Room', inv.room, () => state.setShellNav('project')],
    ['Furniture', inv.seating, () => state.setDesignTool('seating')],
    ['Display', inv.display, () => state.setDesignTool('catalog')],
    ['Viewing', report.findings.some((f) => f.code.startsWith('VIEW') && f.severity !== 'pass') ? 'warn' : true, () => state.setWorkspaceMode('simulate')],
    ['Audio', inv.audio, () => state.setWorkspaceMode('simulate')],
    ['Camera', inv.camera ? true : 'warn', () => state.setDesignTool('catalog')],
    ['System', inv.routing ? true : 'err', () => state.setWorkspaceMode('system')],
    [
      'Cable',
      report.findings.some((f) => f.code.startsWith('CABLE-') && f.severity !== 'pass' && f.severity !== 'info')
        ? 'warn'
        : state.connections.length
          ? true
          : 'warn',
      () => {
        state.setWorkspaceMode('system');
        if (state.connections[0]) state.selectConnection(state.connections[0].id);
      }
    ]
  ];
  rows.forEach(([label, ok, go]) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'ad-asst-row';
    row.style.display = 'block';
    row.style.width = '100%';
    row.style.textAlign = 'left';
    row.style.background = 'transparent';
    row.style.border = 'none';
    row.style.cursor = 'pointer';
    const mark = ok === true ? '✓' : ok === 'err' ? '✕' : '⚠';
    row.textContent = `${mark} ${label}`;
    row.onclick = go;
    checklistBody.appendChild(row);
  });

  if (state.uiComplexity === 'pro') {
    const recs = recommendationsAfterManual(
      {
        room: state.room,
        seats: state.seats,
        tables: state.tables,
        equipment: state.equipment,
        connections: state.connections,
        routes: state.routes
      },
      catalog
    );
    recs
      .filter((r) => !state.dismissedRecommendationIds.includes(r.id))
      .forEach((r) => {
        const box = document.createElement('div');
        box.className = 'ad-rec';
        const t = document.createElement('strong');
        t.textContent = r.title;
        const m = document.createElement('div');
        m.textContent = r.message;
        box.append(t, m);
        checklistBody.appendChild(box);
      });
  }

  const opt = state.autoDesignProposal ? selectedOption(state.autoDesignProposal) : null;
  if (opt?.picks.camera?.completeness === 'partial') {
    const n = document.createElement('div');
    n.className = 'badge-note';
    n.textContent = '⚠ Camera: ' + opt.picks.camera.completenessReason;
    checklistBody.appendChild(n);
  }

  el.appendChild(checklistBody);
}
