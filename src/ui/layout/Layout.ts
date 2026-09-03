import type { AppState } from '../../app/AppState';
import { renderDesignPanel } from '../panels/DesignPanel';
import { renderInspectorPanel } from '../panels/InspectorPanel';
import { renderStatusBar } from '../panels/StatusBar';
import { renderViewerModeOverlay } from '../panels/ViewerModeOverlay';
import { renderPlanView } from '../panels/PlanRenderer';
import { renderElevationView } from '../panels/ElevationRenderer';
import { renderObjectBrowser } from '../panels/ObjectBrowser';
import { renderContextToolbar } from '../panels/ContextToolbar';
import { renderSystemCanvas } from '../panels/SystemCanvas';
import { renderAutoDesignOverlay } from '../panels/AutoDesignPanel';
import { renderDesignAssistant } from '../panels/DesignAssistantPanel';
import { renderProjectSetupOverlay } from '../panels/ProjectSetupOverlay';
import { downloadProject, parseProjectJson, loadProjectInto } from '../../app/ProjectStore';
import { validationReportFor } from '../../av/validation/validationCache';
import { computeDesignHealth } from '../../av/DesignHealth';
import { loadDefaultCatalog } from '../../catalog/loadCatalog';
import type { ShellNav } from '../workspace/projectSetup';

const healthCatalog = loadDefaultCatalog();

export interface LayoutRefs {
  viewportEl: HTMLElement;
}

const SHELL_TABS: Array<[ShellNav, string]> = [
  ['project', 'Project'],
  ['design', 'Design'],
  ['system', 'System'],
  ['simulate', 'Simulate'],
  ['validate', 'Validate'],
  ['docs', 'Docs']
];

export function buildLayout(root: HTMLElement, state: AppState): LayoutRefs {
  root.innerHTML = '';

  const topbar = document.createElement('div');
  topbar.className = 'topbar';
  const brand = document.createElement('div');
  brand.className = 'brand';
  brand.textContent = 'SIMSTAGE';
  const modeSwitch = document.createElement('nav');
  modeSwitch.className = 'workspace-mode';
  modeSwitch.setAttribute('aria-label', 'Workspace');
  const projectName = document.createElement('input');
  projectName.className = 'project-name';
  projectName.title = 'Project name';
  const complexity = document.createElement('button');
  complexity.type = 'button';
  complexity.className = 'topbar-ghost';
  const newBtn = document.createElement('button');
  newBtn.textContent = 'New';
  newBtn.className = 'topbar-ghost';
  newBtn.onclick = () => state.openNewProject();
  const openBtn = document.createElement('button');
  openBtn.textContent = 'Open';
  openBtn.className = 'topbar-ghost';
  openBtn.title = 'Open a saved project';
  openBtn.setAttribute('aria-label', 'Open project');
  openBtn.onclick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      file
        .text()
        .then((text) => {
          const parsed = parseProjectJson(text);
          if (!parsed.ok) {
            state.setSnapNote(parsed.message);
            return;
          }
          const result = loadProjectInto(state, parsed.file);
          state.setSnapNote(result.ok ? 'Project loaded' : result.message);
        })
        .catch(() => state.setSnapNote('Could not read the project file.'));
    };
    input.click();
  };
  const exportBtn = document.createElement('button');
  exportBtn.textContent = 'Export';
  exportBtn.className = 'topbar-ghost';
  exportBtn.title = 'Save project as JSON';
  exportBtn.setAttribute('aria-label', 'Export project');
  exportBtn.onclick = () => downloadProject(state);
  const autoBtn = document.createElement('button');
  autoBtn.textContent = 'Auto Design';
  autoBtn.className = 'topbar-auto';
  autoBtn.onclick = () => state.requestAutoDesign();
  const healthChip = document.createElement('span');
  healthChip.className = 'health-chip';
  topbar.append(brand, modeSwitch, projectName, complexity, healthChip, autoBtn, newBtn, openBtn, exportBtn);

  const mainLayout = document.createElement('div');
  mainLayout.className = 'main-layout';

  const panelLeft = document.createElement('aside');
  panelLeft.className = 'panel-left';
  panelLeft.dataset.panel = 'project';
  const leftHead = document.createElement('div');
  leftHead.className = 'panel-head';
  const leftTitle = document.createElement('span');
  leftTitle.textContent = 'Project';
  const leftCollapse = document.createElement('button');
  leftCollapse.type = 'button';
  leftCollapse.className = 'panel-collapse';
  leftCollapse.setAttribute('aria-label', 'Collapse project panel');
  leftCollapse.textContent = '⟨';
  leftCollapse.onclick = () => state.toggleLeftPanel();
  leftHead.append(leftTitle, leftCollapse);
  const objectBrowserEl = document.createElement('div');
  objectBrowserEl.className = 'object-browser';
  const designPanelEl = document.createElement('div');
  designPanelEl.className = 'design-panel-body';
  panelLeft.append(leftHead, objectBrowserEl, designPanelEl);

  const viewportWrap = document.createElement('div');
  viewportWrap.className = 'viewport-wrap';
  const viewportChrome = document.createElement('div');
  viewportChrome.className = 'viewport-chrome';
  const viewSwitch = document.createElement('div');
  viewSwitch.className = 'viewmode-switch';
  (['3d', 'plan', 'elevation'] as const).forEach((mode) => {
    const b = document.createElement('button');
    b.textContent = mode === '3d' ? '3D' : mode === 'plan' ? 'Plan' : 'Elevation';
    b.onclick = () => state.setViewMode(mode);
    viewSwitch.appendChild(b);
  });
  const viewportTools = document.createElement('div');
  viewportTools.className = 'viewport-tools';
  viewportTools.setAttribute('aria-label', 'Viewport tools');
  const contextToolbarEl = document.createElement('div');
  contextToolbarEl.className = 'context-toolbar-wrap';
  viewportChrome.append(viewSwitch, viewportTools, contextToolbarEl);

  const viewportStage = document.createElement('div');
  viewportStage.className = 'viewport-stage';
  const viewportCanvas = document.createElement('div');
  viewportCanvas.id = 'viewport-canvas';
  const planContainer = document.createElement('div');
  planContainer.className = 'flat-view-canvas';
  const elevationContainer = document.createElement('div');
  elevationContainer.className = 'flat-view-canvas';
  const systemContainer = document.createElement('div');
  systemContainer.className = 'system-canvas-host';
  const viewerModeLayer = document.createElement('div');
  viewportStage.append(viewportCanvas, planContainer, elevationContainer, systemContainer, viewerModeLayer);
  const viewBar = document.createElement('div');
  viewBar.className = 'view-bar';
  viewBar.setAttribute('aria-label', 'View controls');
  viewportWrap.append(viewportChrome, viewportStage, viewBar);

  const panelRight = document.createElement('aside');
  panelRight.className = 'panel-right';
  panelRight.dataset.panel = 'properties';
  const rightHead = document.createElement('div');
  rightHead.className = 'panel-head';
  const rightTitle = document.createElement('span');
  rightTitle.textContent = 'Properties';
  const rightCollapse = document.createElement('button');
  rightCollapse.type = 'button';
  rightCollapse.className = 'panel-collapse';
  rightCollapse.setAttribute('aria-label', 'Collapse properties panel');
  rightCollapse.textContent = '⟩';
  rightCollapse.onclick = () => state.toggleRightPanel();
  rightHead.append(rightTitle, rightCollapse);
  const inspectorHost = document.createElement('div');
  inspectorHost.className = 'inspector-host';
  panelRight.append(rightHead, inspectorHost);
  mainLayout.append(panelLeft, viewportWrap, panelRight);

  const statusBar = document.createElement('div');
  statusBar.className = 'statusbar';
  root.append(topbar, mainLayout, statusBar);

  function renderModeSwitch(): void {
    modeSwitch.innerHTML = '';
    SHELL_TABS.forEach(([id, label]) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.className = state.shellNav === id ? 'active' : '';
      b.onclick = () => state.setShellNav(id);
      modeSwitch.appendChild(b);
    });
  }

  function renderFindingHud(): void {
    let hud = viewportStage.querySelector('.finding-hud') as HTMLElement | null;
    if (!hud) {
      hud = document.createElement('div');
      hud.className = 'finding-hud';
      viewportStage.appendChild(hud);
    }
    hud.innerHTML = '';
    if (!state.selectedFindingId) {
      hud.style.display = 'none';
      return;
    }
    const report = validationReportFor(state);
    const f = report.findings.find((x) => x.id === state.selectedFindingId);
    if (!f || f.severity === 'pass') {
      hud.style.display = 'none';
      return;
    }
    hud.style.display = '';
    hud.innerHTML = `<div class="finding-hud-code">${f.code}</div>
      <div>${f.title}</div>
      <div class="muted">${f.metric ? `${f.metric.actual}  ·  ${f.metric.expected}` : f.message}</div>`;
    if (f.category === 'system' && f.affectedObjects.some((o) => o.kind === 'equipment')) {
      const b = document.createElement('button');
      b.className = 'btn';
      b.textContent = 'View in Room';
      b.onclick = () => {
        const eq = f.affectedObjects.find((o) => o.kind === 'equipment');
        if (eq) state.select('equipment', eq.id);
        state.viewInRoom();
      };
      hud.appendChild(b);
    }
  }

  function renderAnalysisLegend(): void {
    let el = viewportStage.querySelector('.analysis-legend-hud') as HTMLElement | null;
    if (!el) {
      el = document.createElement('div');
      el.className = 'analysis-legend-hud';
      viewportStage.appendChild(el);
    }
    const d = state.displayAnalysis;
    const m = state.micAnalysis;
    const a = state.audioAnalysis;
    const c = state.cameraAnalysis;
    const heat =
      (d.enabled && d.heatmap && 'Viewing quality') ||
      (c.enabled && c.heatmap && 'Camera FOV coverage') ||
      (a.enabled && a.heatmap && 'Geometric speaker coverage') ||
      (m.enabled && m.heatmap && 'Mic pickup (geometric)') ||
      null;
    if (!heat) {
      el.style.display = 'none';
      return;
    }
    el.style.display = '';
    const metric =
      d.enabled && d.heatmap
        ? d.heatmapMetric === 'distance'
          ? 'Distance'
          : d.heatmapMetric === 'angle'
            ? 'Angle'
            : d.heatmapMetric === 'sightline'
              ? 'Sightline'
              : 'Overall'
        : '';
    el.innerHTML = `<div class="analysis-legend-title">${heat}${metric ? ` · ${metric}` : ''}</div>
      <div class="analysis-legend-bar"></div>
      <div class="analysis-legend-labels">${legendLabels(heat, metric)}</div>
      <div class="muted">${legendNote(heat, metric)}</div>`;
  }

  function renderAll(): void {
    renderModeSwitch();
    projectName.value = state.project.name;
    projectName.oninput = () => {
      state.project.name = projectName.value;
    };
    complexity.textContent = state.uiComplexity === 'beginner' ? 'Beginner' : 'Pro';
    complexity.title = 'Same project. Beginner hides extra engineering chrome.';
    complexity.onclick = () => state.setUiComplexity(state.uiComplexity === 'beginner' ? 'pro' : 'beginner');
    panelLeft.classList.toggle('beginner', state.uiComplexity === 'beginner');
    panelLeft.classList.toggle('collapsed', state.leftPanelCollapsed);
    panelRight.classList.toggle('collapsed', state.rightPanelCollapsed);
    leftCollapse.textContent = state.leftPanelCollapsed ? '⟩' : '⟨';
    rightCollapse.textContent = state.rightPanelCollapsed ? '⟨' : '⟩';

    viewportTools.innerHTML = '';
    ([['select', 'Select'], ['move', 'Move'], ['rotate', 'Rotate'], ['measure', 'Measure']] as const).forEach(([id, label]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.className = state.viewportTool === id ? 'active' : '';
      b.title = label;
      b.onclick = () => state.setViewportTool(id);
      viewportTools.appendChild(b);
    });
    const fit = document.createElement('button');
    fit.type = 'button';
    fit.textContent = 'Fit';
    fit.title = 'Fit (F)';
    fit.onclick = () => state.requestFocus();
    viewportTools.appendChild(fit);

    viewBar.innerHTML = '';
    if (state.leftPanelCollapsed) {
      const openL = document.createElement('button');
      openL.type = 'button';
      openL.textContent = 'Project';
      openL.title = 'Show project panel';
      openL.onclick = () => state.toggleLeftPanel();
      viewBar.appendChild(openL);
    }
    if (state.rightPanelCollapsed) {
      const openR = document.createElement('button');
      openR.type = 'button';
      openR.textContent = 'Properties';
      openR.title = 'Show properties panel';
      openR.onclick = () => state.toggleRightPanel();
      viewBar.appendChild(openR);
    }
    ([['persp', 'Perspective'], ['top', 'Top'], ['front', 'Front'], ['left', 'Left'], ['right', 'Right']] as const).forEach(([id, label]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.className = state.cameraView === id ? 'active' : '';
      b.onclick = () => state.setCameraView(id);
      viewBar.appendChild(b);
    });
    const gridLab = document.createElement('label');
    gridLab.textContent = 'Grid m';
    const gridIn = document.createElement('input');
    gridIn.type = 'number';
    gridIn.step = '0.05';
    gridIn.min = '0.05';
    gridIn.value = String(state.gridSpacingM);
    gridIn.title = 'Plan grid spacing';
    gridIn.onchange = () => state.setGridSpacing(Number(gridIn.value));
    viewBar.append(gridLab, gridIn);
    if (state.measureDistanceM != null) {
      const m = document.createElement('span');
      m.textContent = `Distance ${state.measureDistanceM.toFixed(2)} m`;
      viewBar.appendChild(m);
    }
    const report = validationReportFor(state);
    const health = computeDesignHealth(report, state.equipment, state.seats, healthCatalog);
    healthChip.className = 'health-chip ' + report.summary.designStatus;
    healthChip.textContent =
      report.summary.designStatus === 'pass'
        ? `${health.score} ✓ ${report.summary.passCount}`
        : `${health.score} ⚠ ${report.summary.warningCount}  ✕ ${report.summary.errorCount}`;
    healthChip.title = `Design Health: ${health.score}/100. ` + (
      report.summary.designStatus === 'pass'
        ? 'Configured checks are passing'
        : 'Open Validate for actionable design issues'
    );
    healthChip.onclick = () => state.setShellNav('validate');

    renderObjectBrowser(objectBrowserEl, state);
    renderDesignPanel(designPanelEl, state);
    renderInspectorPanel(inspectorHost, state);
    renderStatusBar(statusBar, state);
    renderContextToolbar(contextToolbarEl, state);
    renderFindingHud();
    renderAnalysisLegend();
    renderAutoDesignOverlay(viewportStage, state);
    renderProjectSetupOverlay(viewportStage, state);
    renderDesignAssistant(viewportStage, state);

    const system = state.workspaceMode === 'system' && !state.systemPhysicalView;
    viewportCanvas.style.display = !system && state.viewMode === '3d' ? '' : 'none';
    planContainer.style.display = !system && state.viewMode === 'plan' ? '' : 'none';
    elevationContainer.style.display = !system && state.viewMode === 'elevation' ? '' : 'none';
    systemContainer.style.display = system ? '' : 'none';
    viewSwitch.style.display = system ? 'none' : '';
    if (!system && state.viewMode === 'plan') renderPlanView(planContainer, state);
    if (!system && state.viewMode === 'elevation') renderElevationView(elevationContainer, state);
    if (system) renderSystemCanvas(systemContainer, state);
    viewerModeLayer.style.display = !system && state.viewMode === '3d' ? '' : 'none';
    renderViewerModeOverlay(viewerModeLayer, state);
    Array.from(viewSwitch.children).forEach((child, i) => {
      const mode = (['3d', 'plan', 'elevation'] as const)[i];
      child.classList.toggle('active', state.viewMode === mode);
    });
  }

  state.subscribe(renderAll);
  renderAll();

  window.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement | null;
    const typing = target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA');
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      state.undo();
      return;
    }
    if (mod && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault();
      state.redo();
      return;
    }
    if (typing) return;
    if (e.key === '1') state.setViewMode('3d');
    else if (e.key === '2') state.setViewMode('plan');
    else if (e.key === '3') state.setViewMode('elevation');
    else if (e.key === 'f' || e.key === 'F') state.requestFocus();
    else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      state.deleteSelected();
    } else if (e.key === 'Escape') {
      if (state.viewportTool === 'measure' || state.measurePoints.length) state.clearMeasure();
      if (state.setupOpen) state.closeSetup();
      else if (state.viewerMode.active) state.exitViewerMode();
      else state.select('none', null);
    }
  });

  return { viewportEl: viewportCanvas };
}

function legendLabels(heat: string, metric: string): string {
  if (heat.startsWith('Viewing') && metric === 'Angle') {
    return '<span>&gt;45° Poor</span><span>30–45°</span><span>≤30° Excellent</span>';
  }
  if (heat.startsWith('Viewing') && metric === 'Distance') {
    return '<span>Too far</span><span>Marginal</span><span>Within guidance</span>';
  }
  if (heat.includes('speaker')) {
    return '<span>Outside</span><span>Weak</span><span>Inside coverage</span>';
  }
  if (heat.includes('Mic')) {
    return '<span>Outside</span><span>Edge</span><span>Inside pickup</span>';
  }
  if (heat.includes('Camera')) {
    return '<span>Outside FOV</span><span>Blocked</span><span>Visible</span>';
  }
  return '<span>Poor</span><span>Marginal</span><span>Good</span><span>Excellent</span>';
}

function legendNote(heat: string, metric: string): string {
  if (heat.startsWith('Viewing') && metric === 'Angle') {
    return 'Horizontal off-axis angle. Pass ≤30°, warning 30–45°, fail >45°. Same viewing engine as validation.';
  }
  if (heat.includes('speaker')) {
    return 'Geometric / catalog dispersion. Not room-acoustic SPL prediction.';
  }
  if (heat.includes('Mic')) {
    return 'Catalog pickup radius / beam. Not polar-pattern physics.';
  }
  if (heat.includes('Camera')) {
    return 'Catalog horizontal FOV frustum. Vertical FOV only if in catalog.';
  }
  return 'Continuous floor field from sampled analysis. Furniture footprints are excluded.';
}
