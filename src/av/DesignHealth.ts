/**
 * DesignHealth.ts
 * Deterministic design health scoring derived from ValidationReport.
 * Every point deduction maps to a specific ValidationFinding.
 * Does not duplicate validation logic — consumes existing engine output.
 */

import type { ValidationReport, ValidationFinding, FindingCategory } from './validation/ValidationTypes';
import type { EquipmentInstance, EquipmentCatalog } from '../catalog/EquipmentCatalog';
import type { Seat } from '../room/SeatingGenerator';
import { evaluateRackRequirement } from './RackRequirement';

/** Subsystem categories that map to design health sections. */
export type HealthSubsystem =
  | 'display'
  | 'camera'
  | 'microphone'
  | 'audio'
  | 'connectivity'
  | 'rack'
  | 'placement';

export interface SubsystemHealth {
  subsystem: HealthSubsystem;
  label: string;
  score: number;
  maxScore: number;
  errors: number;
  warnings: number;
  passes: number;
  findings: string[];
  /** True if this subsystem has relevant equipment/context in the project. */
  active: boolean;
}

export interface DesignHealthReport {
  /** Overall 0–100 deterministic score. */
  score: number;
  subsystems: SubsystemHealth[];
  /** Total findings contributing to score deductions. */
  totalErrors: number;
  totalWarnings: number;
  totalPasses: number;
}

/** Points deducted per finding severity. Documented and testable. */
const ERROR_PENALTY = 8;
const WARNING_PENALTY = 3;

const SUBSYSTEM_MAP: Record<HealthSubsystem, { label: string; categories: FindingCategory[] }> = {
  display: { label: 'Display / Viewing', categories: ['display', 'viewing'] },
  camera: { label: 'Camera Coverage', categories: ['camera'] },
  microphone: { label: 'Microphone Coverage', categories: ['microphone'] },
  audio: { label: 'Speaker / Audio', categories: ['audio'] },
  connectivity: { label: 'Connectivity', categories: ['system'] },
  rack: { label: 'AV Rack', categories: ['rack'] },
  placement: { label: 'Placement', categories: ['equipment', 'furniture', 'seating'] }
};

function subsystemFor(category: FindingCategory): HealthSubsystem | null {
  for (const [key, val] of Object.entries(SUBSYSTEM_MAP)) {
    if (val.categories.includes(category)) return key as HealthSubsystem;
  }
  return null;
}

/**
 * Compute a deterministic design health score from an existing ValidationReport.
 *
 * Scoring model:
 * - Base score: 100
 * - Per error finding: −8 points
 * - Per warning finding: −3 points
 * - Info and pass findings: 0 deduction
 * - Floor: 0
 *
 * Empty/inactive subsystems are excluded from scoring (a room with no speakers
 * is not penalized for missing speaker coverage).
 */
export function computeDesignHealth(
  report: ValidationReport,
  equipment: EquipmentInstance[],
  seats: Seat[],
  catalog: EquipmentCatalog
): DesignHealthReport {
  // Determine which subsystems are active based on project content
  const hasCategory = (cat: string) => equipment.some((e) => catalog.get(e.productId)?.category === cat);
  const activeSubsystems = new Set<HealthSubsystem>();
  if (hasCategory('display') || hasCategory('projector') || hasCategory('video_wall')) activeSubsystems.add('display');
  if (hasCategory('camera')) activeSubsystems.add('camera');
  if (hasCategory('microphone')) activeSubsystems.add('microphone');
  if (hasCategory('speaker') || hasCategory('amplifier')) activeSubsystems.add('audio');
  const rackReq = evaluateRackRequirement(equipment, catalog);
  if (rackReq.required || equipment.some((e) => e.rackId) || report.findings.some((f) => f.category === 'rack')) {
    activeSubsystems.add('rack');
  }
  // Connectivity is active when there are connections (findings exist) or system-role devices
  const hasSystemFindings = report.findings.some((f) => f.category === 'system');
  if (hasSystemFindings) activeSubsystems.add('connectivity');
  // Placement is always active when equipment or seats exist
  if (equipment.length > 0 || seats.length > 0) activeSubsystems.add('placement');

  // Build per-subsystem health
  const subsystems: SubsystemHealth[] = [];
  for (const [key, meta] of Object.entries(SUBSYSTEM_MAP)) {
    const sub = key as HealthSubsystem;
    const active = activeSubsystems.has(sub);
    const relFindings = report.findings.filter((f) => {
      const mapped = subsystemFor(f.category);
      return mapped === sub;
    });
    const errors = relFindings.filter((f) => f.severity === 'error').length;
    const warnings = relFindings.filter((f) => f.severity === 'warning').length;
    const passes = relFindings.filter((f) => f.severity === 'pass').length;
    const penalty = errors * ERROR_PENALTY + warnings * WARNING_PENALTY;
    const score = active ? Math.max(0, 100 - penalty) : 100;

    subsystems.push({
      subsystem: sub,
      label: meta.label,
      score,
      maxScore: 100,
      errors,
      warnings,
      passes,
      findings: relFindings
        .filter((f) => f.severity === 'error' || f.severity === 'warning')
        .map((f) => f.id),
      active
    });
  }

  // Overall score: average of active subsystem scores
  const activeSubs = subsystems.filter((s) => s.active);
  const overallScore = activeSubs.length > 0
    ? Math.round(activeSubs.reduce((sum, s) => sum + s.score, 0) / activeSubs.length)
    : 100;

  return {
    score: Math.max(0, Math.min(100, overallScore)),
    subsystems,
    totalErrors: report.summary.errorCount,
    totalWarnings: report.summary.warningCount,
    totalPasses: report.summary.passCount
  };
}
