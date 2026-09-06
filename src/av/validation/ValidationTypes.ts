/**
 * ValidationTypes.ts
 * Structured findings for DesignValidationEngine. Not stored in undo
 * snapshots — always recalculated from project state.
 */

export type FindingSeverity = 'pass' | 'info' | 'warning' | 'error';
export type FindingCategory =
  | 'viewing'
  | 'display'
  | 'seating'
  | 'furniture'
  | 'audio'
  | 'microphone'
  | 'camera'
  | 'system'
  | 'rack'
  | 'equipment'
  | 'room'
  | 'power';
export type FindingPriority = 'high' | 'medium' | 'low';

export interface FindingMetric {
  name: string;
  actual: string;
  expected: string;
  unit?: string;
}

export interface ValidationFinding {
  id: string;
  code: string;
  severity: FindingSeverity;
  category: FindingCategory;
  title: string;
  message: string;
  explanation: string;
  metric?: FindingMetric;
  objectId?: string;
  affectedObjects: Array<{ kind: 'seat' | 'equipment' | 'table' | 'rack'; id: string; label: string }>;
  recommendedActions: string[];
  /** Variables a future Auto Design pass could try — not an auto-fix. */
  potentialVariables: string[];
  source: string;
}

export interface ValidationSummary {
  checksPerformed: number;
  passCount: number;
  infoCount: number;
  warningCount: number;
  errorCount: number;
  designStatus: 'pass' | 'attention' | 'incomplete';
}

export interface ValidationReport {
  findings: ValidationFinding[];
  summary: ValidationSummary;
  generatedFromSignature: string;
}

export interface ValidationCheckContext {
  signature: string;
}

export interface ValidationCheck {
  code: string;
  category: FindingCategory;
  title: string;
  evaluate: (ctx: import('./ValidationContext').ProjectValidationContext) => ValidationFinding[];
}

export interface ValidationDelta {
  previousErrors: number;
  previousWarnings: number;
  currentErrors: number;
  currentWarnings: number;
  errorsResolved: number;
  warningsResolved: number;
  improved: boolean;
  worsened: boolean;
  message: string;
}

export function summarizeFindings(findings: ValidationFinding[]): ValidationSummary {
  const passCount = findings.filter((f) => f.severity === 'pass').length;
  const infoCount = findings.filter((f) => f.severity === 'info').length;
  const warningCount = findings.filter((f) => f.severity === 'warning').length;
  const errorCount = findings.filter((f) => f.severity === 'error').length;
  let designStatus: ValidationSummary['designStatus'] = 'pass';
  if (errorCount > 0) designStatus = 'attention';
  else if (warningCount > 0) designStatus = 'attention';
  if (findings.some((f) => f.code === 'DISPLAY-001' && f.severity !== 'pass')) {
    if (errorCount === 0 && warningCount === 0) designStatus = 'incomplete';
  }
  return {
    checksPerformed: findings.length,
    passCount,
    infoCount,
    warningCount,
    errorCount,
    designStatus
  };
}

export function priorityFor(finding: ValidationFinding): FindingPriority {
  if (finding.severity === 'error') return 'high';
  if (finding.severity === 'warning') return 'medium';
  return 'low';
}

export function compareSummaries(prev: ValidationSummary | null, next: ValidationSummary): ValidationDelta {
  const previousErrors = prev?.errorCount ?? next.errorCount;
  const previousWarnings = prev?.warningCount ?? next.warningCount;
  const errorsResolved = Math.max(0, previousErrors - next.errorCount);
  const warningsResolved = Math.max(0, previousWarnings - next.warningCount);
  const improved = next.errorCount + next.warningCount < previousErrors + previousWarnings;
  const worsened = next.errorCount + next.warningCount > previousErrors + previousWarnings;
  let message = '';
  if (!prev) message = '';
  else if (improved && next.errorCount === 0 && next.warningCount === 0) {
    message = `Design improved — ${errorsResolved + warningsResolved} previous issue(s) resolved.`;
  } else if (improved) {
    message = `${errorsResolved} error(s) and ${warningsResolved} warning(s) resolved; ${next.errorCount} error(s) and ${next.warningCount} warning(s) remain.`;
  } else if (worsened) {
    message = 'Design health declined after the last change.';
  }
  return {
    previousErrors,
    previousWarnings,
    currentErrors: next.errorCount,
    currentWarnings: next.warningCount,
    errorsResolved,
    warningsResolved,
    improved,
    worsened,
    message
  };
}

export function designSignature(input: {
  room: unknown;
  seats: unknown;
  tables: unknown;
  equipment: unknown;
  connections?: unknown;
  routes?: unknown;
  racks?: unknown;
  cableLengthLimitsM?: unknown;
}): string {
  return JSON.stringify({
    room: input.room,
    seats: input.seats,
    tables: input.tables,
    equipment: input.equipment,
    connections: input.connections ?? [],
    routes: input.routes ?? [],
    racks: input.racks ?? [],
    cableLengthLimitsM: input.cableLengthLimitsM ?? {}
  });
}
