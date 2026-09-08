/**
 * DesignHealthHUD.ts
 * Real-time, floating interactive Design Health HUD with Click-to-Fix (§22, §28).
 * Displays live health score, score deductions, and deterministic 1-click remedies.
 */

import type { AppState } from '../../app/AppState';
import type { DesignHealthReport, ClickToFixAction, ScoreDeduction, SubsystemHealth } from '../../av/DesignHealth';

export function renderDesignHealthHUD(container: HTMLElement, state: AppState): void {
  let hud = container.querySelector('.design-health-hud-root') as HTMLElement | null;
  if (!hud) {
    hud = document.createElement('div');
    hud.className = 'design-health-hud-root';
    container.appendChild(hud);
  }

  const health = state.getDesignHealth();
  hud.innerHTML = '';

  // 1. Floating HUD Pill (Compact)
  const pill = document.createElement('div');
  pill.className = `health-hud-pill status-${scoreTier(health.score)}${state.healthHudOpen ? ' active' : ''}`;
  pill.title = 'Click to toggle Design Health & Click-to-Fix HUD';

  const scoreBadge = document.createElement('span');
  scoreBadge.className = 'health-hud-badge';
  scoreBadge.textContent = String(health.score);
  pill.appendChild(scoreBadge);

  const pillLabel = document.createElement('span');
  pillLabel.className = 'health-hud-label';
  const issueText = health.totalErrors > 0
    ? `${health.totalErrors} error${health.totalErrors > 1 ? 's' : ''}`
    : health.totalWarnings > 0
      ? `${health.totalWarnings} warning${health.totalWarnings > 1 ? 's' : ''}`
      : 'Optimal';
  pillLabel.textContent = `Health: ${issueText}`;
  pill.appendChild(pillLabel);

  const fixBadge = document.createElement('span');
  fixBadge.className = 'health-hud-fix-count';
  if (health.actionableFixes.length > 0) {
    fixBadge.textContent = `⚡ ${health.actionableFixes.length}`;
    fixBadge.title = `${health.actionableFixes.length} deterministic quick fix${health.actionableFixes.length > 1 ? 'es' : ''} available`;
    pill.appendChild(fixBadge);
  }

  pill.onclick = (e) => {
    e.stopPropagation();
    state.toggleHealthHud();
  };
  hud.appendChild(pill);

  // 2. Expanded Popover Panel
  if (state.healthHudOpen) {
    const panel = document.createElement('div');
    panel.className = 'health-hud-popover';

    // Header
    const head = document.createElement('div');
    head.className = 'health-hud-header';
    head.innerHTML = `
      <div class="health-hud-header-title">
        <span class="health-hud-score-large status-${scoreTier(health.score)}">${health.score}</span>
        <div>
          <div style="font-weight: 600; font-size: 13px;">DESIGN HEALTH SCORE</div>
          <div style="font-size: 11px; color: var(--text-secondary);">
            ${health.totalErrors} Errors (−8 pts) · ${health.totalWarnings} Warnings (−3 pts) · ${health.totalPasses} Passed
          </div>
        </div>
      </div>
    `;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'health-hud-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.title = 'Close Health HUD';
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      state.setHealthHudOpen(false);
    };
    head.appendChild(closeBtn);
    panel.appendChild(head);

    // Subsystem Bars
    const subBars = document.createElement('div');
    subBars.className = 'health-hud-subsystems';
    health.subsystems.filter((s) => s.active).forEach((sub) => {
      subBars.appendChild(createSubsystemRow(sub));
    });
    panel.appendChild(subBars);

    // Deductions & Click-to-Fix Actions
    if (health.deductions.length > 0) {
      const issuesTitle = document.createElement('div');
      issuesTitle.className = 'health-hud-section-title';
      issuesTitle.textContent = `ACTIONABLE DEDUCTIONS (${health.deductions.length})`;
      panel.appendChild(issuesTitle);

      const issueList = document.createElement('div');
      issueList.className = 'health-hud-deductions';
      health.deductions.forEach((ded) => {
        issueList.appendChild(createDeductionCard(ded, state));
      });
      panel.appendChild(issueList);
    } else {
      const clean = document.createElement('div');
      clean.className = 'health-hud-all-clean';
      clean.textContent = '✓ All active subsystem checks passed with zero deductions.';
      panel.appendChild(clean);
    }

    hud.appendChild(panel);
  }
}

function createSubsystemRow(sub: SubsystemHealth): HTMLElement {
  const row = document.createElement('div');
  row.className = 'health-hud-sub-row';

  const name = document.createElement('span');
  name.className = 'health-hud-sub-name';
  name.textContent = sub.label;
  row.appendChild(name);

  const track = document.createElement('div');
  track.className = 'health-hud-sub-track';
  const fill = document.createElement('div');
  fill.className = `health-hud-sub-fill status-${scoreTier(sub.score)}`;
  fill.style.width = `${sub.score}%`;
  track.appendChild(fill);
  row.appendChild(track);

  const val = document.createElement('span');
  val.className = 'health-hud-sub-val';
  val.textContent = `${sub.score}`;
  row.appendChild(val);

  return row;
}

function createDeductionCard(ded: ScoreDeduction, state: AppState): HTMLElement {
  const card = document.createElement('div');
  card.className = `health-hud-card ${ded.severity}`;

  const top = document.createElement('div');
  top.className = 'health-hud-card-top';

  const code = document.createElement('span');
  code.className = 'health-hud-card-code';
  code.textContent = ded.code;
  top.appendChild(code);

  const penalty = document.createElement('span');
  penalty.className = 'health-hud-card-penalty';
  penalty.textContent = `-${ded.penalty} pts`;
  top.appendChild(penalty);

  card.appendChild(top);

  const msg = document.createElement('div');
  msg.className = 'health-hud-card-msg';
  msg.textContent = ded.message;
  card.appendChild(msg);

  if (ded.affectedObjects.length > 0) {
    const aff = document.createElement('div');
    aff.className = 'health-hud-card-aff';
    aff.textContent = 'Affects: ' + ded.affectedObjects.map((o) => o.label).join(', ');
    card.appendChild(aff);
  }

  // Action Buttons
  const actions = document.createElement('div');
  actions.className = 'health-hud-card-actions';

  if (ded.fixAction) {
    const fixBtn = document.createElement('button');
    fixBtn.className = 'btn primary small health-hud-fix-btn';
    fixBtn.innerHTML = `⚡ ${ded.fixAction.label}`;
    fixBtn.title = ded.fixAction.description;
    fixBtn.onclick = (e) => {
      e.stopPropagation();
      state.applyClickToFix(ded.fixAction!);
    };
    actions.appendChild(fixBtn);
  }

  const focusBtn = document.createElement('button');
  focusBtn.className = 'btn small';
  focusBtn.textContent = 'Focus in 3D';
  focusBtn.onclick = (e) => {
    e.stopPropagation();
    const target = ded.affectedObjects[0];
    if (target) {
      state.select(target.kind, target.id);
      state.requestFocus();
    }
  };
  actions.appendChild(focusBtn);

  card.appendChild(actions);
  return card;
}

function scoreTier(score: number): 'good' | 'fair' | 'poor' {
  if (score >= 80) return 'good';
  if (score >= 50) return 'fair';
  return 'poor';
}
