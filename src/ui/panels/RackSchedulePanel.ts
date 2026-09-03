/**
 * RackSchedulePanel.ts
 * Renders per-rack elevation and power summary.
 * Uses existing RackSchedule — no duplicated engineering logic.
 */

import type { AppState } from '../../app/AppState';
import { loadDefaultCatalog } from '../../catalog/loadCatalog';
import { rackElevation, rackPowerSummary } from '../../av/RackSchedule';

const catalog = loadDefaultCatalog();

export function renderRackScheduleSection(container: HTMLElement, state: AppState, rackId: string): void {
  const rack = state.racks.find((r) => r.id === rackId);
  if (!rack) return;

  const elev = rackElevation(rack, state.equipment, catalog);
  const power = rackPowerSummary(rack, state.equipment, catalog);

  // Section title
  const title = document.createElement('div');
  title.className = 'nav-section-title';
  title.textContent = 'RACK ELEVATION';
  container.appendChild(title);

  // Summary strip
  const summary = document.createElement('div');
  summary.className = 'rack-summary-strip';
  summary.innerHTML = `<span>${elev.usedRU}/${elev.ruTotal} RU used (${elev.utilizationPct}%)</span>` +
    `<span>${elev.freeRU} RU free</span>`;
  if (elev.incomplete) {
    summary.innerHTML += `<span class="rack-incomplete">⚠ Some devices have no RU data</span>`;
  }
  container.appendChild(summary);

  // Elevation table (RU grid)
  const table = document.createElement('table');
  table.className = 'rack-elevation-table';
  const thead = document.createElement('thead');
  thead.innerHTML = `<tr><th>RU</th><th>EQUIPMENT</th></tr>`;
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (let i = elev.slots.length - 1; i >= 0; i--) {
    const slot = elev.slots[i];
    const tr = document.createElement('tr');
    tr.className = slot.status === 'occupied' ? 'rack-slot-occupied' : 'rack-slot-free';
    const ruTd = document.createElement('td');
    ruTd.className = 'rack-ru-num';
    ruTd.textContent = `U${slot.ru}`;
    const eqTd = document.createElement('td');
    if (slot.status === 'occupied' && slot.deviceStart) {
      const assignment = elev.assignments.find((a) => a.instanceId === slot.equipmentId);
      eqTd.textContent = slot.equipmentName ?? '';
      if (assignment && assignment.rackUnits > 1) {
        eqTd.textContent += ` (${assignment.rackUnits} RU)`;
      }
      eqTd.className = 'rack-eq-name';
      tr.onclick = () => {
        if (slot.equipmentId) state.select('equipment', slot.equipmentId);
      };
    } else if (slot.status === 'occupied') {
      eqTd.textContent = '│';
      eqTd.className = 'rack-eq-cont';
    } else {
      eqTd.textContent = '—';
      eqTd.className = 'rack-eq-free';
    }
    tr.appendChild(ruTd);
    tr.appendChild(eqTd);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  container.appendChild(table);

  // Power summary (only if any data exists)
  if (power.lines.length > 0) {
    const powerTitle = document.createElement('div');
    powerTitle.className = 'nav-section-title';
    powerTitle.textContent = 'POWER SUMMARY';
    container.appendChild(powerTitle);

    const powerInfo = document.createElement('div');
    powerInfo.className = 'rack-power-info';
    powerInfo.innerHTML = `<span>Total known: ${power.totalKnownWatts} W</span>`;
    if (power.unknownCount > 0) {
      powerInfo.innerHTML += `<span class="rack-incomplete">${power.unknownCount} device${power.unknownCount > 1 ? 's' : ''} without power data</span>`;
    }
    if (power.complete) {
      powerInfo.innerHTML += `<span class="rack-complete">✓ All devices have power data</span>`;
    }
    container.appendChild(powerInfo);
  }
}
