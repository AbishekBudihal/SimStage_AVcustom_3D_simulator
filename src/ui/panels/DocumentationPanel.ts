/**
 * DocumentationPanel.ts
 * Renders BOM, Cable Schedule, Rack Schedule, and Engineering Report
 * as exportable tables with CSV/text download.
 */

import type { AppState } from '../../app/AppState';
import { loadDefaultCatalog } from '../../catalog/loadCatalog';
import { bomToCsv, bomToJson } from '../../docs/BomGenerator';
import { reportToText, reportToMarkdown, reportToJson } from '../../docs/EngineeringReport';
import { cableScheduleToCsv } from '../../system/CableSchedule';

const catalog = loadDefaultCatalog();

type DocTab = 'bom' | 'cables' | 'racks' | 'report';

let activeTab: DocTab = 'bom';

export function renderDocumentationPanel(container: HTMLElement, state: AppState): void {
  container.innerHTML = '';

  const title = document.createElement('div');
  title.className = 'nav-section-title';
  title.textContent = 'DOCUMENTATION';
  container.appendChild(title);

  // Tab bar
  const tabs = document.createElement('div');
  tabs.className = 'sub-tabs';
  const tabDefs: Array<{ id: DocTab; label: string }> = [
    { id: 'bom', label: 'BOM' },
    { id: 'cables', label: 'Cable Schedule' },
    { id: 'racks', label: 'Rack Schedule' },
    { id: 'report', label: 'Report' }
  ];
  tabDefs.forEach((t) => {
    const btn = document.createElement('button');
    btn.className = `sub-tab${activeTab === t.id ? ' active' : ''}`;
    btn.textContent = t.label;
    btn.onclick = () => { activeTab = t.id; renderDocumentationPanel(container, state); };
    tabs.appendChild(btn);
  });
  container.appendChild(tabs);

  const body = document.createElement('div');
  body.className = 'doc-body';
  container.appendChild(body);

  switch (activeTab) {
    case 'bom': renderBomTab(body, state); break;
    case 'cables': renderCablesTab(body, state); break;
    case 'racks': renderRacksTab(body, state); break;
    case 'report': renderReportTab(body, state); break;
  }
}

function renderBomTab(body: HTMLElement, state: AppState): void {
  const bom = state.getBom();

  // Summary
  const summary = document.createElement('div');
  summary.className = 'doc-summary';
  const powerInfo = bom.totalPowerWatts > 0 ? ` · Power: ${bom.totalPowerWatts}W (PoE: ${bom.poePowerWatts}W)` : '';
  summary.textContent = `${bom.totalItems} items · ${bom.totalUniqueProducts} unique lines${bom.customDeviceCount > 0 ? ` · ${bom.customDeviceCount} custom` : ''}${powerInfo}`;
  body.appendChild(summary);

  if (bom.lines.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'badge-note';
    empty.textContent = 'No equipment in project. Add devices to generate BOM.';
    body.appendChild(empty);
    return;
  }

  // Table
  const table = document.createElement('table');
  table.className = 'doc-table';
  table.innerHTML = `<thead><tr>
    <th>Item</th><th>Part No</th><th>Manufacturer</th><th>Model</th><th>Category</th><th>Kind</th><th>Qty</th><th>Power</th><th>Rack</th>
  </tr></thead>`;
  const tbody = document.createElement('tbody');
  bom.lines.forEach((l) => {
    const tr = document.createElement('tr');
    const pn = l.partNumber ? `<code>${l.partNumber}</code>` : '—';
    const pw = l.powerWatts != null ? `${l.powerWatts} W` : '—';
    tr.innerHTML = `<td>${l.itemId}</td><td>${pn}</td><td>${l.manufacturer}</td><td>${l.model}</td>
      <td>${l.category}</td><td>${l.lineKind}</td><td>${l.quantity}</td><td>${pw}</td><td>${l.rackMounted ? '✓' : ''}</td>`;
    if (l.isCustomDevice) tr.classList.add('custom-device-row');
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  body.appendChild(table);

  // Export buttons
  const btnRow = document.createElement('div');
  btnRow.style.display = 'flex';
  btnRow.style.gap = '8px';
  btnRow.style.marginTop = '8px';
  addExportButton(btnRow, 'Export BOM (CSV)', () => bomToCsv(bom), 'bom.csv');
  addExportButton(btnRow, 'Export BOM (JSON)', () => bomToJson(bom), 'bom.json');
  body.appendChild(btnRow);
}

import type { CableScheduleRow } from '../../system/CableSchedule';

function renderCablesTab(body: HTMLElement, state: AppState): void {
  const schedule = state.getCableSchedule();

  const summary = document.createElement('div');
  summary.className = 'doc-summary';
  summary.textContent = `${schedule.summary.totalConnections} cables · ${schedule.summary.totalEstimatedLengthM.toFixed(1)} m total (estimated)`;
  body.appendChild(summary);

  if (schedule.rows.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'badge-note';
    empty.textContent = 'No connections in project. Connect devices to generate cable schedule.';
    body.appendChild(empty);
    return;
  }

  const table = document.createElement('table');
  table.className = 'doc-table';
  table.innerHTML = `<thead><tr>
    <th>ID</th><th>From</th><th>To</th><th>Signal</th><th>Cable</th><th>Length</th><th>Status</th>
  </tr></thead>`;
  const tbody = document.createElement('tbody');
  schedule.rows.forEach((r: CableScheduleRow) => {
    const tr = document.createElement('tr');
    const statusIcon = r.routeStatus === 'clear' ? '✓' : r.routeStatus === 'intersects-obstacle' ? '⚠' : '—';
    tr.innerHTML = `<td>${r.cableId}</td><td>${r.fromName}</td><td>${r.toName}</td>
      <td>${r.signalType}</td><td>${r.cableType}</td><td>${r.estimatedLengthM.toFixed(1)} m</td>
      <td>${statusIcon}</td>`;
    tr.onclick = () => state.selectConnection(r.connectionId);
    tr.style.cursor = 'pointer';
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  body.appendChild(table);

  addExportButton(body, 'Export Cable Schedule (CSV)', () => cableScheduleToCsv(schedule), 'cable-schedule.csv');
}

function renderRacksTab(body: HTMLElement, state: AppState): void {
  if (state.racks.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'badge-note';
    empty.textContent = 'No racks in project.';
    body.appendChild(empty);
    return;
  }

  const report = state.getEngineeringReport();
  for (const rack of report.racks) {
    const rackTitle = document.createElement('div');
    rackTitle.className = 'nav-section-title';
    rackTitle.textContent = `${rack.rackId} · ${rack.rackKind} · ${rack.ruTotal} RU`;
    body.appendChild(rackTitle);

    const info = document.createElement('div');
    info.className = 'doc-summary';
    info.textContent = `Used: ${rack.elevation.usedRU}/${rack.ruTotal} RU (${rack.elevation.utilizationPct}%) · Power: ${rack.power.totalKnownWatts} W`;
    body.appendChild(info);

    if (rack.elevation.assignments.length > 0) {
      const table = document.createElement('table');
      table.className = 'doc-table';
      table.innerHTML = `<thead><tr><th>RU</th><th>Equipment</th><th>Size</th></tr></thead>`;
      const tbody = document.createElement('tbody');
      rack.elevation.assignments.forEach((a) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>U${a.startRU}</td><td>${a.name}</td><td>${a.rackUnits} RU</td>`;
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      body.appendChild(table);
    }
  }
}

function renderReportTab(body: HTMLElement, state: AppState): void {
  const report = state.getEngineeringReport();
  const text = reportToText(report);

  const pre = document.createElement('pre');
  pre.className = 'doc-report-pre';
  pre.textContent = text;
  body.appendChild(pre);

  const btnRow = document.createElement('div');
  btnRow.style.display = 'flex';
  btnRow.style.gap = '8px';
  btnRow.style.marginTop = '8px';
  addExportButton(btnRow, 'Export Report (TXT)', () => text, 'engineering-report.txt');
  addExportButton(btnRow, 'Export Report (Markdown)', () => reportToMarkdown(report), 'engineering-report.md');
  addExportButton(btnRow, 'Export Report (JSON)', () => reportToJson(report), 'engineering-report.json');
  body.appendChild(btnRow);
}

function addExportButton(parent: HTMLElement, label: string, getData: () => string, filename: string): void {
  const btn = document.createElement('button');
  btn.className = 'btn primary';
  btn.style.marginTop = '8px';
  btn.textContent = label;
  btn.onclick = () => {
    const blob = new Blob([getData()], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };
  parent.appendChild(btn);
}
