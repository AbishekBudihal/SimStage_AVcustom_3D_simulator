/**
 * ValidationPanel.ts
 * Findings list + Validate Design. Recalculates from current project
 * state via validationCache — never a stored undo snapshot.
 */

import type { AppState } from '../../app/AppState';
import { lastValidationDelta, validationReportFor } from '../../av/validation/validationCache';
import { priorityFor, type ValidationFinding } from '../../av/validation/ValidationTypes';
import { renderDesignHealthSummary } from './DesignHealthPanel';

export function renderValidationPanel(container: HTMLElement, state: AppState): void {
  container.innerHTML = '';
  const report = validationReportFor(state);
  const delta = lastValidationDelta();

  const head = document.createElement('div');
  head.className = 'nav-section-title';
  head.textContent = 'DESIGN VALIDATION';
  container.appendChild(head);

  const run = document.createElement('button');
  run.className = 'btn primary';
  run.textContent = 'Validate Design';
  run.onclick = () => {
    state.setWorkspaceMode('validate');
  };
  container.appendChild(run);

  const summary = document.createElement('div');
  summary.className = 'validation-summary';
  const st = report.summary;
  const statusLabel =
    st.designStatus === 'pass' ? 'PASSES CONFIGURED CHECKS' : st.designStatus === 'incomplete' ? 'INCOMPLETE' : 'ATTENTION REQUIRED';
  summary.innerHTML = `
    <div class="analysis-hero">${st.checksPerformed} checks performed<br><b>${statusLabel}</b></div>
    <div class="analysis-counts">
      <span class="status-pill pass">✓ ${st.passCount} passed</span>
      <span class="status-pill warning">⚠ ${st.warningCount} warnings</span>
      <span class="status-pill fail">✕ ${st.errorCount} errors</span>
    </div>
  `;
  container.appendChild(summary);

  // Design Health score and per-subsystem breakdown
  const healthHost = document.createElement('div');
  container.appendChild(healthHost);
  renderDesignHealthSummary(healthHost, state);

  if (delta?.message) {
    const d = document.createElement('div');
    d.className = 'badge-note';
    d.style.color = delta.improved ? 'var(--success)' : delta.worsened ? 'var(--warning)' : 'var(--text-secondary)';
    d.textContent = delta.message;
    container.appendChild(d);
  }

  const attention = report.findings
    .filter((f) => f.severity === 'error' || f.severity === 'warning')
    .sort((a, b) => rank(a) - rank(b));

  if (attention.length) {
    const attTitle = document.createElement('div');
    attTitle.className = 'nav-section-title';
    attTitle.textContent = 'ISSUES';
    container.appendChild(attTitle);
    attention.forEach((f) => {
      const pri = priorityFor(f);
      const row = document.createElement('div');
      row.className = 'finding-card' + (state.selectedFindingId === f.id ? ' active' : '');
      const seats = f.affectedObjects.filter((o) => o.kind === 'seat').map((o) => o.label);
      const metric = f.metric ? `${f.metric.name}: ${f.metric.actual} (expected ${f.metric.expected})` : '';
      row.innerHTML = `<div class="finding-kicker">${f.severity === 'error' ? '✕' : '⚠'} ${f.code} · ${f.category.toUpperCase()} · ${pri.toUpperCase()}</div>
        <div class="finding-title">${escapeHtml(f.title)}</div>
        <div class="muted">${escapeHtml(f.message)}</div>
        ${metric ? `<div class="muted">${escapeHtml(metric)}</div>` : ''}
        ${seats.length ? `<div class="muted">Affected: ${escapeHtml(seats.slice(0, 8).join(', '))}${seats.length > 8 ? '…' : ''}</div>` : ''}`;
      const actions = document.createElement('div');
      actions.className = 'finding-actions';
      const view = document.createElement('button');
      view.className = 'btn primary';
      view.textContent = 'Focus';
      view.title = 'Select the affected object and show this issue';
      view.onclick = (e) => {
        e.stopPropagation();
        inspect(state, f);
      };
      const analyze = document.createElement('button');
      analyze.className = 'btn';
      analyze.textContent = 'Analyze';
      analyze.title = 'Open Simulate for the related device';
      analyze.onclick = (e) => {
        e.stopPropagation();
        inspect(state, f);
        const eq = f.objectId || f.affectedObjects.find((o) => o.kind === 'equipment')?.id;
        if (eq) state.analyzeEquipment(eq);
      };
      actions.append(view, analyze);
      row.appendChild(actions);
      row.onclick = () => inspect(state, f);
      container.appendChild(row);
    });
  }

  const allTitle = document.createElement('div');
  allTitle.className = 'nav-section-title';
  allTitle.textContent = 'FINDINGS';
  container.appendChild(allTitle);

  report.findings.forEach((f) => {
    const card = document.createElement('div');
    card.className = 'finding-card' + (state.selectedFindingId === f.id ? ' active' : '');
    const mark = f.severity === 'pass' ? '✓' : f.severity === 'error' ? '✕' : f.severity === 'warning' ? '⚠' : 'i';
    card.innerHTML = `<div class="finding-kicker">${mark} ${f.code} · ${f.severity.toUpperCase()}</div>
      <div class="finding-title">${escapeHtml(f.title)}</div>
      <div class="muted">${escapeHtml(f.message)}</div>`;
    if (f.affectedObjects.length) {
      const aff = document.createElement('div');
      aff.className = 'muted';
      aff.textContent = 'Affected: ' + f.affectedObjects.map((o) => o.label).slice(0, 8).join(', ');
      card.appendChild(aff);
    }
    if (f.severity !== 'pass') {
      const actions = document.createElement('div');
      actions.className = 'finding-actions';
      const view = document.createElement('button');
      view.className = 'btn';
      view.textContent = 'Focus';
      view.title = 'Select the affected object and show this issue';
      view.onclick = (e) => {
        e.stopPropagation();
        inspect(state, f);
      };
      const analyze = document.createElement('button');
      analyze.className = 'btn';
      analyze.textContent = 'Analyze';
      analyze.onclick = (e) => {
        e.stopPropagation();
        inspect(state, f);
        const eq = f.objectId || f.affectedObjects.find((o) => o.kind === 'equipment')?.id;
        if (eq) state.analyzeEquipment(eq);
      };
      const det = document.createElement('button');
      det.className = 'btn';
      det.textContent = state.detailsFindingId === f.id ? 'Hide details' : 'Details';
      det.onclick = (e) => {
        e.stopPropagation();
        state.setDetailsFinding(state.detailsFindingId === f.id ? null : f.id);
      };
      actions.append(view, analyze, det);
      card.appendChild(actions);
    }
    if (state.detailsFindingId === f.id) {
      const det = document.createElement('div');
      det.className = 'badge-note';
      det.innerHTML = `<b>Check</b> ${escapeHtml(f.title)}<br>
        <b>Status</b> ${f.severity.toUpperCase()}<br>
        ${f.metric ? `<b>Actual</b> ${escapeHtml(f.metric.actual)}<br><b>Criteria</b> ${escapeHtml(f.metric.expected)}<br>` : ''}
        <b>Result</b> ${escapeHtml(f.explanation)}<br>
        <b>Source</b> ${escapeHtml(f.source)}`;
      if (f.recommendedActions.length) {
        det.innerHTML += `<br><b>Recommended actions</b><br>` + f.recommendedActions.map((a) => `• ${escapeHtml(a)}`).join('<br>');
      }
      card.appendChild(det);
    }
    card.onclick = () => {
      if (f.severity !== 'pass') inspect(state, f);
    };
    container.appendChild(card);
  });

  const note = document.createElement('div');
  note.className = 'badge-note';
  note.textContent =
    'Checks use the current viewing heuristic (engineering estimate, not AVIXA DISCAS), geometric angles, registered obstacles (tables/columns), microphone pickup from MicrophoneCoverageEngine, speaker SPL/dispersion from SpeakerCoverageEngine (free-field estimate, not room acoustics), camera FOV from CameraCoverageEngine (geometric frustum estimate, not image-quality or NVR simulation), and catalog-driven Device/Port/Connection topology (not room-size templates).';
  container.appendChild(note);
}

function inspect(state: AppState, f: ValidationFinding): void {
  const seats = f.affectedObjects.filter((o) => o.kind === 'seat').map((o) => o.id);
  const tables = f.affectedObjects.filter((o) => o.kind === 'table').map((o) => o.id);
  const equipment = f.affectedObjects.filter((o) => o.kind === 'equipment').map((o) => o.id);
  if (f.objectId && !equipment.includes(f.objectId)) equipment.push(f.objectId);
  state.inspectFinding(f.id, seats, tables, equipment, f.code);
}

function rank(f: ValidationFinding): number {
  const p = priorityFor(f);
  return p === 'high' ? 0 : p === 'medium' ? 1 : 2;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
