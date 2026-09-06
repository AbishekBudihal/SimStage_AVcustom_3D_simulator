/**
 * SchematicImportModal.ts
 * Modal dialog for importing, validating, analyzing, and synchronizing
 * 2D AV schematics into the 3D workspace.
 *
 * Implements XTEN-AV style workflow:
 * 1. JSON Import / Preset Loading
 * 2. Automated Engineering Validation & Integrity Checks
 * 3. Power Budget & Rack Requirement Analysis
 * 4. 1-Click Sync to Authoritative AppState & 3D Environment
 */

import type { AppState } from '../../app/AppState';
import { parseSchematicJson } from '../../schematic/SchematicParser';
import { analyzeSchematic } from '../../schematic/SchematicAnalyzer';
import { syncSchematicTo3D, type SyncResult } from '../../schematic/Schematic3DSync';
import { boardroomSchematic, huddleSchematic } from '../../schematic/demoSchematics';
import type { AnalyzedSchematicPayload } from '../../schematic/SchematicTypes';

export function openSchematicImportModal(host: HTMLElement, state: AppState): void {
  // Remove existing instance if open
  const existing = host.querySelector('.schematic-import-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'setup-overlay schematic-import-overlay';

  const card = document.createElement('div');
  card.className = 'setup-card';
  card.style.maxWidth = '780px';
  card.style.maxHeight = '90vh';
  card.style.overflowY = 'auto';
  overlay.appendChild(card);

  // Header
  const headerRow = document.createElement('div');
  headerRow.style.display = 'flex';
  headerRow.style.justifyContent = 'space-between';
  headerRow.style.alignItems = 'flex-start';

  const titleWrap = document.createElement('div');
  const h2 = document.createElement('h2');
  h2.textContent = 'Import AV Schematic & Sync to 3D';
  h2.style.margin = '0 0 4px';
  const sub = document.createElement('p');
  sub.className = 'sub';
  sub.style.margin = '0 0 16px';
  sub.textContent = 'Import 2D schematic graph data, validate engineering signal flow & power budget, and automatically synthesize 3D room placement.';
  titleWrap.append(h2, sub);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'panel-collapse';
  closeBtn.textContent = '✕';
  closeBtn.style.fontSize = '14px';
  closeBtn.style.padding = '4px 8px';
  closeBtn.onclick = () => overlay.remove();

  headerRow.append(titleWrap, closeBtn);
  card.appendChild(headerRow);

  // Preset Buttons
  const presetLabel = document.createElement('div');
  presetLabel.className = 'setup-label';
  presetLabel.textContent = 'Reference Schematics / Presets';
  card.appendChild(presetLabel);

  const presetRow = document.createElement('div');
  presetRow.className = 'setup-chips';
  presetRow.style.marginBottom = '12px';

  let currentJson = JSON.stringify(boardroomSchematic(), null, 2);
  let analyzedPayload: AnalyzedSchematicPayload | null = null;

  const btnBoardroom = document.createElement('button');
  btnBoardroom.type = 'button';
  btnBoardroom.className = 'setup-choice active';
  btnBoardroom.textContent = 'Enterprise Boardroom (Dual 86", DSP, Amp, Rack)';

  const btnHuddle = document.createElement('button');
  btnHuddle.type = 'button';
  btnHuddle.className = 'setup-choice';
  btnHuddle.textContent = 'Huddle Space (USB Soundbar, 55" Display)';

  const btnEmpty = document.createElement('button');
  btnEmpty.type = 'button';
  btnEmpty.className = 'setup-choice';
  btnEmpty.textContent = 'Clear / Blank Template';

  presetRow.append(btnBoardroom, btnHuddle, btnEmpty);
  card.appendChild(presetRow);

  // Editor Section
  const editLabel = document.createElement('div');
  editLabel.className = 'setup-label';
  editLabel.textContent = 'Schematic JSON Data';
  card.appendChild(editLabel);

  const textarea = document.createElement('textarea');
  textarea.className = 'schematic-json-input';
  textarea.style.width = '100%';
  textarea.style.height = '180px';
  textarea.style.fontFamily = 'monospace';
  textarea.style.fontSize = '12px';
  textarea.style.padding = '8px';
  textarea.style.borderRadius = '6px';
  textarea.style.border = '1px solid var(--border)';
  textarea.style.background = 'var(--bg-panel-alt)';
  textarea.style.resize = 'vertical';
  textarea.value = currentJson;
  card.appendChild(textarea);

  // Results / Analysis HUD
  const analysisContainer = document.createElement('div');
  analysisContainer.style.marginTop = '14px';
  analysisContainer.style.padding = '12px';
  analysisContainer.style.borderRadius = '8px';
  analysisContainer.style.background = 'var(--bg-panel-alt)';
  analysisContainer.style.border = '1px solid var(--border)';
  analysisContainer.style.display = 'none';
  card.appendChild(analysisContainer);

  // Update presets handler
  const setPreset = (jsonStr: string, activeBtn: HTMLButtonElement) => {
    [btnBoardroom, btnHuddle, btnEmpty].forEach((b) => b.classList.remove('active'));
    activeBtn.classList.add('active');
    textarea.value = jsonStr;
    currentJson = jsonStr;
    runAnalysis();
  };

  btnBoardroom.onclick = () => setPreset(JSON.stringify(boardroomSchematic(), null, 2), btnBoardroom);
  btnHuddle.onclick = () => setPreset(JSON.stringify(huddleSchematic(), null, 2), btnHuddle);
  btnEmpty.onclick = () =>
    setPreset(
      JSON.stringify(
        {
          metadata: { title: 'Custom Project', targetRoom: { widthM: 6, depthM: 5, heightM: 3 } },
          nodes: [],
          links: []
        },
        null,
        2
      ),
      btnEmpty
    );

  // Action Buttons row
  const actionsRow = document.createElement('div');
  actionsRow.className = 'setup-actions';
  actionsRow.style.marginTop = '16px';

  const clearExistingCheck = document.createElement('label');
  clearExistingCheck.style.display = 'flex';
  clearExistingCheck.style.alignItems = 'center';
  clearExistingCheck.style.gap = '6px';
  clearExistingCheck.style.fontSize = '12px';
  clearExistingCheck.style.cursor = 'pointer';
  const clearInput = document.createElement('input');
  clearInput.type = 'checkbox';
  clearInput.checked = true;
  clearExistingCheck.append(clearInput, document.createTextNode('Clear existing workspace equipment before sync'));

  const btnAnalyze = document.createElement('button');
  btnAnalyze.type = 'button';
  btnAnalyze.className = 'btn';
  btnAnalyze.textContent = 'Analyze Schematic';

  const btnSync = document.createElement('button');
  btnSync.type = 'button';
  btnSync.className = 'btn primary';
  btnSync.textContent = 'Sync to 3D Workspace';
  btnSync.disabled = true;

  actionsRow.append(btnAnalyze, btnSync);
  card.appendChild(clearExistingCheck);
  card.appendChild(actionsRow);

  // Analysis function
  const runAnalysis = () => {
    try {
      const parseResult = parseSchematicJson(textarea.value);
      if (!parseResult.graph) {
        analysisContainer.style.display = 'block';
        analysisContainer.innerHTML = `<div style="color:var(--danger);font-weight:600;margin-bottom:6px;">Syntax / Schema Errors:</div><ul style="margin:0;padding-left:18px;color:var(--danger);">${parseResult.errors.map((e) => `<li>${e}</li>`).join('')}</ul>`;
        btnSync.disabled = true;
        analyzedPayload = null;
        return;
      }
      const catalog = state.getCatalog();
      const analyzed = analyzeSchematic(parseResult.graph, catalog);
      analyzedPayload = analyzed;

      analysisContainer.style.display = 'block';
      analysisContainer.innerHTML = '';

      const header = document.createElement('div');
      header.style.display = 'flex';
      header.style.justifyContent = 'space-between';
      header.style.alignItems = 'center';
      header.style.marginBottom = '8px';

      const statusBadge = document.createElement('span');
      statusBadge.style.fontWeight = '600';
      statusBadge.style.padding = '2px 8px';
      statusBadge.style.borderRadius = '4px';
      if (analyzed.validation.valid) {
        statusBadge.style.background = '#e6f4ea';
        statusBadge.style.color = 'var(--success)';
        statusBadge.textContent = '✓ Validation Passed';
        btnSync.disabled = false;
      } else {
        statusBadge.style.background = '#fce8e6';
        statusBadge.style.color = 'var(--danger)';
        statusBadge.textContent = `✕ Validation Failed (${analyzed.validation.issues.filter((i) => i.severity === 'error').length} Errors)`;
        btnSync.disabled = true;
      }

      const counts = document.createElement('span');
      counts.style.color = 'var(--text-secondary)';
      counts.style.fontSize = '12px';
      counts.textContent = `${analyzed.graph.nodes.length} Nodes · ${analyzed.graph.links.length} Connections · ${analyzed.validation.signalChainCount} Signal Chains`;

      header.append(statusBadge, counts);
      analysisContainer.appendChild(header);

      // Metric grid
      const grid = document.createElement('div');
      grid.style.display = 'grid';
      grid.style.gridTemplateColumns = 'repeat(3, 1fr)';
      grid.style.gap = '8px';
      grid.style.margin = '10px 0';

      const metric = (title: string, val: string, sub: string) => {
        const d = document.createElement('div');
        d.style.background = '#fff';
        d.style.padding = '8px';
        d.style.borderRadius = '6px';
        d.style.border = '1px solid var(--border)';
        d.innerHTML = `<div style="font-size:10px;text-transform:uppercase;color:var(--text-tertiary);">${title}</div>
          <div style="font-size:15px;font-weight:600;color:var(--text-primary);margin:2px 0;">${val}</div>
          <div style="font-size:10.5px;color:var(--text-secondary);">${sub}</div>`;
        return d;
      };

      grid.appendChild(
        metric(
          'Power Budget',
          `${analyzed.validation.powerSummary.totalWatts} W`,
          `${analyzed.validation.powerSummary.poeDeviceCount} PoE devices (${analyzed.validation.powerSummary.poeTotalWatts} W)`
        )
      );
      grid.appendChild(
        metric(
          'Rack Requirement',
          analyzed.rackRequired ? `${analyzed.totalRU} RU Required` : 'None Required',
          analyzed.rackRequired ? `Kind: ${analyzed.rackKind?.toUpperCase() ?? 'FLOOR'}` : 'Peripherals only'
        )
      );
      grid.appendChild(
        metric(
          'Cable Manifest',
          `${analyzed.cableManifest.length} Cables`,
          `Est. ~${analyzed.cableManifest.reduce((s, c) => s + c.estimatedLengthM, 0)}m total length`
        )
      );

      analysisContainer.appendChild(grid);

      // Issues list if any
      if (analyzed.validation.issues.length > 0) {
        const issuesList = document.createElement('div');
        issuesList.style.marginTop = '8px';
        issuesList.style.fontSize = '11.5px';
        analyzed.validation.issues.forEach((iss) => {
          const item = document.createElement('div');
          item.style.padding = '4px 0';
          item.style.color = iss.severity === 'error' ? 'var(--danger)' : 'var(--warning)';
          item.textContent = `[${iss.code}] ${iss.message}`;
          issuesList.appendChild(item);
        });
        analysisContainer.appendChild(issuesList);
      }
    } catch (err: unknown) {
      analysisContainer.style.display = 'block';
      analysisContainer.innerHTML = `<div style="color:var(--danger);font-weight:600;">Parse Error: ${
        err instanceof Error ? err.message : String(err)
      }</div>`;
      btnSync.disabled = true;
      analyzedPayload = null;
    }
  };

  btnAnalyze.onclick = runAnalysis;

  btnSync.onclick = () => {
    if (!analyzedPayload) return;
    const syncRes: SyncResult = syncSchematicTo3D(analyzedPayload, state, {
      clearExisting: clearInput.checked
    });

    // Notify user & switch to 3D view
    state.setWorkspaceMode('design');
    overlay.remove();

    state.lastSnapNote = `Schematic Synchronized: ${syncRes.equipmentAdded} devices, ${syncRes.connectionsAdded} connections added.`;
    state.notify();
  };

  // Run initial analysis on the default boardroom preset
  runAnalysis();

  host.appendChild(overlay);
}