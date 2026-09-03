/**
 * DesignHealthPanel.ts
 * Renders the design health score and per-subsystem breakdown.
 * Consumes DesignHealth — does not duplicate scoring logic.
 */

import type { AppState } from '../../app/AppState';
import { loadDefaultCatalog } from '../../catalog/loadCatalog';
import { runDesignValidation } from '../../av/validation/DesignValidationEngine';
import { computeDesignHealth, type SubsystemHealth } from '../../av/DesignHealth';

const catalog = loadDefaultCatalog();

export function renderDesignHealthSummary(container: HTMLElement, state: AppState): void {
  const report = runDesignValidation({
    room: state.room,
    seats: state.seats,
    tables: state.tables,
    equipment: state.equipment,
    connections: state.connections,
    routes: state.routes,
    racks: state.racks,
    catalog
  });
  const health = computeDesignHealth(report, state.equipment, state.seats, catalog);

  const wrapper = document.createElement('div');
  wrapper.className = 'design-health-summary';

  // Score header
  const header = document.createElement('div');
  header.className = 'design-health-header';
  const scoreEl = document.createElement('span');
  scoreEl.className = `design-health-score health-${scoreClass(health.score)}`;
  scoreEl.textContent = `${health.score}`;
  const labelEl = document.createElement('span');
  labelEl.className = 'design-health-label';
  labelEl.textContent = 'Design Health';
  header.appendChild(scoreEl);
  header.appendChild(labelEl);

  const counts = document.createElement('span');
  counts.className = 'design-health-counts';
  counts.innerHTML = `<span class="health-pass">✓ ${health.totalPasses}</span>` +
    `<span class="health-warn">⚠ ${health.totalWarnings}</span>` +
    `<span class="health-err">✕ ${health.totalErrors}</span>`;
  header.appendChild(counts);
  wrapper.appendChild(header);

  // Subsystem bars
  const bars = document.createElement('div');
  bars.className = 'design-health-bars';
  health.subsystems.filter((s) => s.active).forEach((sub) => {
    bars.appendChild(renderSubsystemBar(sub));
  });
  wrapper.appendChild(bars);

  container.appendChild(wrapper);
}

function renderSubsystemBar(sub: SubsystemHealth): HTMLElement {
  const row = document.createElement('div');
  row.className = 'health-bar-row';

  const label = document.createElement('span');
  label.className = 'health-bar-label';
  label.textContent = sub.label;
  row.appendChild(label);

  const bar = document.createElement('div');
  bar.className = 'health-bar-track';
  const fill = document.createElement('div');
  fill.className = `health-bar-fill health-${scoreClass(sub.score)}`;
  fill.style.width = `${sub.score}%`;
  bar.appendChild(fill);
  row.appendChild(bar);

  const val = document.createElement('span');
  val.className = 'health-bar-value';
  val.textContent = `${sub.score}`;
  row.appendChild(val);

  return row;
}

function scoreClass(score: number): string {
  if (score >= 80) return 'good';
  if (score >= 50) return 'fair';
  return 'poor';
}
