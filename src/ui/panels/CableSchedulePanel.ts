/**
 * CableSchedulePanel.ts
 * Renders the cable schedule as an engineering table.
 * Uses existing CableSchedule + CableRouter — no duplicated routing.
 */

import type { AppState } from '../../app/AppState';
import { loadDefaultCatalog } from '../../catalog/loadCatalog';
import { cableSchedule } from '../../system/CableSchedule';
import { cableRouteContext } from '../../system/cableContext';

const catalog = loadDefaultCatalog();

export function renderCableSchedulePanel(container: HTMLElement, state: AppState): void {
  container.innerHTML = '';

  if (!state.connections.length) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = 'No connections in the project. Add connections in System view.';
    container.appendChild(empty);
    return;
  }

  const ctx = cableRouteContext(state, catalog);
  const schedule = cableSchedule(state.connections, state.equipment, ctx);

  // Summary header
  const summaryEl = document.createElement('div');
  summaryEl.className = 'cable-schedule-summary';
  summaryEl.innerHTML = `<div class="nav-section-title">Cable Schedule</div>`;

  const stats = document.createElement('div');
  stats.className = 'cable-schedule-stats';
  stats.innerHTML = `<span>${schedule.summary.totalConnections} cable${schedule.summary.totalConnections !== 1 ? 's' : ''}</span>` +
    `<span>${schedule.summary.totalEstimatedLengthM.toFixed(1)} m total (estimated)</span>`;
  summaryEl.appendChild(stats);

  // Type summary
  if (schedule.summary.byType.length > 0) {
    const typeList = document.createElement('div');
    typeList.className = 'cable-type-summary';
    for (const t of schedule.summary.byType) {
      const chip = document.createElement('span');
      chip.className = 'cable-type-chip';
      chip.textContent = `${t.cableType}: ${t.count}× ${t.totalLengthM.toFixed(1)} m`;
      typeList.appendChild(chip);
    }
    summaryEl.appendChild(typeList);
  }
  container.appendChild(summaryEl);

  // Table
  const table = document.createElement('table');
  table.className = 'cable-schedule-table';
  const thead = document.createElement('thead');
  thead.innerHTML = `<tr>
    <th>ID</th>
    <th>FROM</th>
    <th>TO</th>
    <th>SIGNAL</th>
    <th>TYPE</th>
    <th>LENGTH</th>
    <th>STATUS</th>
  </tr>`;
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const row of schedule.rows) {
    const tr = document.createElement('tr');
    tr.className = row.routeStatus === 'intersects-obstacle' ? 'cable-row-warn' : '';
    const statusIcon = row.routeStatus === 'clear' ? '✓' :
      row.routeStatus === 'intersects-obstacle' ? '⚠' : '—';
    tr.innerHTML = `<td class="cable-id">${shortId(row.connectionId)}</td>
      <td title="${row.fromPort}">${row.fromName}</td>
      <td title="${row.toPort}">${row.toName}</td>
      <td>${row.signalType}</td>
      <td>${row.cableType}</td>
      <td>${row.estimatedLengthM > 0 ? row.estimatedLengthM.toFixed(1) + ' m' : '—'}</td>
      <td class="cable-status-${row.routeStatus === 'clear' ? 'ok' : 'warn'}">${statusIcon}</td>`;
    tr.onclick = () => {
      state.select('equipment', row.fromInstanceId);
      if (state.selectedConnectionId !== row.connectionId) {
        state.selectConnection(row.connectionId);
      }
    };
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  container.appendChild(table);

  // Engineering note
  const note = document.createElement('div');
  note.className = 'muted cable-schedule-note';
  note.textContent = 'Lengths are geometric estimates from obstacle-aware routing. Not BIM tray design.';
  container.appendChild(note);
}

function shortId(id: string): string {
  const parts = id.split('-');
  return parts.length > 2 ? parts.slice(0, 2).join('-') : id.substring(0, 8);
}
