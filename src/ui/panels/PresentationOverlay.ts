/**
 * PresentationOverlay.ts
 * Client Presentation Mode (§20, §25, §28)
 *
 * Implements a non-technical, distraction-free executive presentation HUD:
 * - Executive header with project name, room archetype, date, and overall design health score.
 * - Guided camera tour navigation (Overview, Presenter View, Seated/Audience View, Display/Tech Focus).
 * - Non-technical AV capability highlight toggles (Sightlines & Viewing Comfort, Microphone Pickup Zones, Even Sound Reinforcement, Smart Camera Auto-Framing).
 * - Exit button.
 */

import type { AppState, PresentationTourStop } from '../../app/AppState';
import { validationReportFor } from '../../av/validation/validationCache';
import { computeDesignHealth } from '../../av/DesignHealth';
import { loadDefaultCatalog } from '../../catalog/loadCatalog';

const catalog = loadDefaultCatalog();

const TOUR_STOPS: Array<{ id: PresentationTourStop; label: string; icon: string; desc: string }> = [
  { id: 'overview', label: 'Overview', icon: '🏛', desc: 'Bird’s-eye architectural room perspective' },
  { id: 'presenter', label: 'Presenter', icon: '🧑‍🏫', desc: 'View from the front presentation wall facing participants' },
  { id: 'seated', label: 'Audience', icon: '🪑', desc: 'First-person view from central attendee seating' },
  { id: 'display', label: 'Technology', icon: '🖥', desc: 'Front-and-center focus on primary display & camera array' }
];

export function renderPresentationOverlay(container: HTMLElement, state: AppState): void {
  let overlay = container.querySelector('.presentation-overlay') as HTMLElement | null;

  if (!state.presentationMode) {
    if (overlay) {
      overlay.remove();
    }
    return;
  }

  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'presentation-overlay';
    container.appendChild(overlay);
  }

  overlay.innerHTML = '';

  // 1. Executive Top Header
  const header = document.createElement('header');
  header.className = 'presentation-header';

  const leftBranding = document.createElement('div');
  leftBranding.className = 'presentation-branding';

  const titleRow = document.createElement('div');
  titleRow.className = 'presentation-title-row';

  const badge = document.createElement('span');
  badge.className = 'presentation-live-badge';
  badge.textContent = 'CLIENT PRESENTATION';

  const title = document.createElement('h1');
  title.className = 'presentation-title';
  title.textContent = state.project.name || 'Executive Boardroom Solution';

  titleRow.append(badge, title);

  const metaRow = document.createElement('div');
  metaRow.className = 'presentation-meta-row';

  const useCaseText = (state.project.roomUseCase || 'Executive Room').replace(/_/g, ' ').toUpperCase();
  const seatsCount = state.seats.length;
  const roomDimText = state.room ? `${state.room.width}m × ${state.room.depth}m` : '';

  metaRow.innerHTML = `
    <span>${useCaseText}</span>
    <span class="meta-dot">·</span>
    <span>${seatsCount} Seats</span>
    ${roomDimText ? `<span class="meta-dot">·</span><span>${roomDimText}</span>` : ''}
    ${state.project.designer ? `<span class="meta-dot">·</span><span>Prepared by: ${escapeHtml(state.project.designer)}</span>` : ''}
  `;

  leftBranding.append(titleRow, metaRow);

  // Health / Readiness Badge
  const report = validationReportFor(state);
  const health = computeDesignHealth(report, state.equipment, state.seats, catalog);

  const rightActions = document.createElement('div');
  rightActions.className = 'presentation-header-right';

  const healthPill = document.createElement('div');
  healthPill.className = `presentation-health-pill ${health.score >= 90 ? 'excellent' : health.score >= 75 ? 'good' : 'warning'}`;
  healthPill.innerHTML = `
    <span class="score">${health.score}/100</span>
    <span class="label">Engineering Health</span>
  `;

  const exitBtn = document.createElement('button');
  exitBtn.type = 'button';
  exitBtn.className = 'presentation-exit-btn';
  exitBtn.setAttribute('title', 'Exit Presentation Mode (Esc)');
  exitBtn.innerHTML = `<span>Exit</span> <kbd>Esc</kbd>`;
  exitBtn.onclick = () => state.exitPresentationMode();

  rightActions.append(healthPill, exitBtn);
  header.append(leftBranding, rightActions);

  // 2. Guided Camera Tour Bar (Bottom Center)
  const tourBar = document.createElement('div');
  tourBar.className = 'presentation-tour-bar';

  const tourHeader = document.createElement('div');
  tourHeader.className = 'presentation-tour-header';
  const currentStopInfo = TOUR_STOPS.find((s) => s.id === state.presentationStop) ?? TOUR_STOPS[0];
  tourHeader.innerHTML = `<span class="tour-stop-tag">CAMERA PERSPECTIVE</span> <span class="tour-desc">${currentStopInfo.desc}</span>`;

  const tourControls = document.createElement('div');
  tourControls.className = 'presentation-tour-controls';

  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.className = 'presentation-step-btn';
  prevBtn.textContent = '◀';
  prevBtn.title = 'Previous Camera View';
  prevBtn.onclick = () => state.stepPresentationStop(-1);

  tourControls.appendChild(prevBtn);

  TOUR_STOPS.forEach((stop) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `presentation-tour-btn ${state.presentationStop === stop.id ? 'active' : ''}`;
    btn.innerHTML = `<span class="btn-icon">${stop.icon}</span> <span>${stop.label}</span>`;
    btn.onclick = () => state.setPresentationStop(stop.id);
    tourControls.appendChild(btn);
  });

  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'presentation-step-btn';
  nextBtn.textContent = '▶';
  nextBtn.title = 'Next Camera View';
  nextBtn.onclick = () => state.stepPresentationStop(1);

  tourControls.appendChild(nextBtn);

  tourBar.append(tourHeader, tourControls);

  // 3. Client Capability Overlays (Floating Side Bar)
  const overlayPanel = document.createElement('div');
  overlayPanel.className = 'presentation-capability-panel';

  const overlayTitle = document.createElement('div');
  overlayTitle.className = 'presentation-capability-title';
  overlayTitle.textContent = 'AV Coverage Overlays';

  const overlaysList = document.createElement('div');
  overlaysList.className = 'presentation-capability-list';

  const overlayItems: Array<{ key: keyof typeof state.presentationOverlays; label: string; icon: string; tooltip: string }> = [
    { key: 'sightlines', label: 'Optimal Viewing & Sightlines', icon: '👁', tooltip: 'Shows participant sightlines and display viewing comfort' },
    { key: 'mic', label: 'Clear Voice Pickup', icon: '🎙', tooltip: 'Visualizes crystal-clear boundary/ceiling microphone pickup regions' },
    { key: 'audio', label: 'Even Sound Reinforcement', icon: '🔊', tooltip: 'Visualizes calibrated speaker acoustic coverage volumes' },
    { key: 'camera', label: 'Auto-Framing Camera Coverage', icon: '📹', tooltip: 'Visualizes optical camera field of view framing all seats' }
  ];

  overlayItems.forEach((item) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    const isActive = state.presentationOverlays[item.key];
    chip.className = `presentation-capability-chip ${isActive ? 'active' : ''}`;
    chip.title = item.tooltip;
    chip.innerHTML = `
      <span class="chip-icon">${item.icon}</span>
      <span class="chip-label">${item.label}</span>
      <span class="chip-status">${isActive ? 'ON' : 'OFF'}</span>
    `;
    chip.onclick = () => state.togglePresentationOverlay(item.key);
    overlaysList.appendChild(chip);
  });

  overlayPanel.append(overlayTitle, overlaysList);

  overlay.append(header, tourBar, overlayPanel);
}

function escapeHtml(str: string): string {
  return str.replace(/[&<>'"]/g, (tag) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[tag] || tag));
}
