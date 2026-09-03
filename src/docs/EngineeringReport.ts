/**
 * EngineeringReport.ts
 * Aggregates existing engine outputs into a structured engineering report.
 * Does not duplicate any computation — consumes existing cached results.
 */

import type { AppState } from '../app/AppState';
import type { EquipmentCatalog } from '../catalog/EquipmentCatalog';
import { validationReportFor } from '../av/validation/validationCache';
import { computeDesignHealth, type DesignHealthReport } from '../av/DesignHealth';
import { generateBom, type BomReport } from './BomGenerator';
import { cableSchedule, type CableScheduleResult } from '../system/CableSchedule';
import { cableRouteContext } from '../system/cableContext';
import { rackElevation, rackPowerSummary, type RackElevation, type RackPowerSummary } from '../av/RackSchedule';
import type { ValidationFinding } from '../av/validation/ValidationTypes';

export interface RackReport {
  rackId: string;
  rackKind: string;
  ruTotal: number;
  elevation: RackElevation;
  power: RackPowerSummary;
}

export interface EngineeringReport {
  project: { name: string; designer: string; date: string };
  room: { width: number; length: number; height: number; useCase: string; seatCount: number };
  health: DesignHealthReport;
  bom: BomReport;
  cables: CableScheduleResult;
  racks: RackReport[];
  findings: ValidationFinding[];
  equipmentCount: number;
  connectionCount: number;
}

/**
 * Generate a complete engineering report from current project state.
 * All data is derived from existing engines — nothing is invented.
 */
export function generateEngineeringReport(
  state: AppState,
  catalog: EquipmentCatalog
): EngineeringReport {
  const validationReport = validationReportFor(state);
  const health = computeDesignHealth(validationReport, state.equipment, state.seats, catalog);
  const bom = generateBom(state.equipment, catalog);
  const ctx = cableRouteContext(state, catalog);
  const cables = cableSchedule(state.connections, state.equipment, ctx);

  const racks: RackReport[] = state.racks.map((rack) => ({
    rackId: rack.id,
    rackKind: rack.kind,
    ruTotal: rack.ruTotal,
    elevation: rackElevation(rack, state.equipment, catalog),
    power: rackPowerSummary(rack, state.equipment, catalog)
  }));

  return {
    project: {
      name: state.project.name,
      designer: state.project.designer,
      date: new Date().toISOString().split('T')[0]
    },
    room: {
      width: state.room?.width ?? 0,
      length: state.room?.depth ?? 0,
      height: state.room?.height ?? 0,
      useCase: state.project.roomUseCase,
      seatCount: state.seats.length
    },
    health,
    bom,
    cables,
    racks,
    findings: validationReport.findings.filter((f) => f.severity !== 'pass'),
    equipmentCount: state.equipment.length,
    connectionCount: state.connections.length
  };
}

/**
 * Export engineering report as human-readable text.
 */
export function reportToText(report: EngineeringReport): string {
  const lines: string[] = [];

  lines.push('═══════════════════════════════════════════');
  lines.push(`  AV ENGINEERING REPORT`);
  lines.push('═══════════════════════════════════════════');
  lines.push(`  Project: ${report.project.name}`);
  lines.push(`  Designer: ${report.project.designer}`);
  lines.push(`  Date: ${report.project.date}`);
  lines.push('');

  // Room
  lines.push('─── ROOM ───────────────────────────────');
  lines.push(`  ${report.room.width.toFixed(1)} × ${report.room.length.toFixed(1)} × ${report.room.height.toFixed(1)} m`);
  lines.push(`  Use case: ${report.room.useCase}`);
  lines.push(`  Seats: ${report.room.seatCount}`);
  lines.push('');

  // Design Health
  lines.push('─── DESIGN HEALTH ──────────────────────');
  lines.push(`  Score: ${report.health.score} / 100`);
  for (const sub of report.health.subsystems.filter((s) => s.active)) {
    const icon = sub.errors > 0 ? '✕' : sub.warnings > 0 ? '⚠' : '✓';
    lines.push(`    ${icon} ${sub.label}: ${sub.score}/100`);
  }
  lines.push('');

  // BOM
  lines.push('─── BILL OF MATERIALS ──────────────────');
  lines.push(`  ${report.bom.totalItems} items (${report.bom.totalUniqueProducts} unique products)`);
  for (const line of report.bom.lines) {
    lines.push(`    ${line.itemId}  ${line.manufacturer} ${line.model}  ×${line.quantity}${line.rackMounted ? '  [RACK]' : ''}`);
  }
  lines.push('');

  // Cable Schedule
  lines.push('─── CABLE SCHEDULE ─────────────────────');
  lines.push(`  ${report.cables.summary.totalConnections} cables, ${report.cables.summary.totalEstimatedLengthM.toFixed(1)} m total (estimated)`);
  for (const row of report.cables.rows) {
    lines.push(`    ${row.cableId}  ${row.fromName} → ${row.toName}  ${row.cableType}  ${row.estimatedLengthM.toFixed(1)} m`);
  }
  lines.push('');

  // Racks
  if (report.racks.length > 0) {
    lines.push('─── RACK SCHEDULES ─────────────────────');
    for (const rack of report.racks) {
      lines.push(`  ${rack.rackId} (${rack.rackKind}, ${rack.ruTotal} RU)`);
      lines.push(`    Used: ${rack.elevation.usedRU}/${rack.ruTotal} RU (${rack.elevation.utilizationPct}%)`);
      lines.push(`    Power: ${rack.power.totalKnownWatts} W known${rack.power.unknownCount > 0 ? `, ${rack.power.unknownCount} unknown` : ''}`);
    }
    lines.push('');
  }

  // Issues
  if (report.findings.length > 0) {
    lines.push('─── ISSUES ─────────────────────────────');
    for (const f of report.findings) {
      const icon = f.severity === 'error' ? '✕' : '⚠';
      lines.push(`    ${icon} [${f.id}] ${f.message}`);
    }
    lines.push('');
  }

  lines.push('═══════════════════════════════════════════');
  return lines.join('\n');
}
