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
  room: {
    width: number;
    length: number;
    height: number;
    useCase: string;
    seatCount: number;
    templateId?: string;
    ceilingType?: string;
    lightingStyle?: string;
    flooringType?: string;
    wallStyle?: string;
    furnitureStyle?: string;
  };
  health: DesignHealthReport;
  bom: BomReport;
  cables: CableScheduleResult;
  racks: RackReport[];
  findings: ValidationFinding[];
  equipmentCount: number;
  connectionCount: number;
  power: {
    totalWatts: number;
    poeWatts: number;
  };
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
  const ctx = cableRouteContext(state, catalog);
  const cables = cableSchedule(state.connections, state.equipment, ctx);
  const bom = generateBom(state.equipment, catalog);

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
      seatCount: state.seats.length,
      templateId: state.room?.templateId,
      ceilingType: state.room?.ceilingType,
      lightingStyle: state.room?.lightingStyle,
      flooringType: state.room?.flooringType,
      wallStyle: state.room?.wallStyle,
      furnitureStyle: state.room?.furnitureStyle
    },
    health,
    bom,
    cables,
    racks,
    findings: validationReport.findings.filter((f) => f.severity !== 'pass'),
    equipmentCount: state.equipment.length,
    connectionCount: state.connections.length,
    power: {
      totalWatts: bom.totalPowerWatts,
      poeWatts: bom.poePowerWatts
    }
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

  // Room & Finishes
  lines.push('─── ROOM & ARCHITECTURAL ENVIRONMENT ─────');
  lines.push(`  Dimensions: ${report.room.width.toFixed(1)} × ${report.room.length.toFixed(1)} × ${report.room.height.toFixed(1)} m`);
  lines.push(`  Use case: ${report.room.useCase}${report.room.templateId ? ` (${report.room.templateId})` : ''}`);
  lines.push(`  Seats: ${report.room.seatCount}`);
  if (report.room.ceilingType || report.room.lightingStyle || report.room.flooringType || report.room.wallStyle) {
    lines.push(`  Ceiling: ${report.room.ceilingType ?? 'default'} | Lighting: ${report.room.lightingStyle ?? 'default'}`);
    lines.push(`  Flooring: ${report.room.flooringType ?? 'default'} | Walls: ${report.room.wallStyle ?? 'default'}`);
  }
  lines.push('');

  // Design Health
  lines.push('─── DESIGN HEALTH ──────────────────────');
  lines.push(`  Score: ${report.health.score} / 100`);
  for (const sub of report.health.subsystems.filter((s) => s.active)) {
    const icon = sub.errors > 0 ? '✕' : sub.warnings > 0 ? '⚠' : '✓';
    lines.push(`    ${icon} ${sub.label}: ${sub.score}/100`);
  }
  lines.push('');

  // Power Summary
  lines.push('─── POWER BUDGET ───────────────────────');
  lines.push(`  Total Power: ${report.power.totalWatts.toFixed(1)} W`);
  lines.push(`  PoE Power: ${report.power.poeWatts.toFixed(1)} W`);
  lines.push('');

  // BOM
  lines.push('─── BILL OF MATERIALS ──────────────────');
  lines.push(`  ${report.bom.totalItems} items (${report.bom.totalUniqueProducts} unique lines)`);
  for (const line of report.bom.lines) {
    const part = line.partNumber ? ` [PN: ${line.partNumber}]` : '';
    const power = line.powerWatts != null ? ` (${line.powerWatts}W)` : '';
    lines.push(`    ${line.itemId}  ${line.manufacturer} ${line.model}${part}  ×${line.quantity}${line.rackMounted ? '  [RACK]' : ''}${power}`);
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

/**
 * Export engineering report as formatted Markdown.
 */
export function reportToMarkdown(report: EngineeringReport): string {
  const lines: string[] = [];

  lines.push(`# Engineering Report: ${report.project.name}`);
  lines.push(`*Generated on ${report.project.date} by ${report.project.designer}*`);
  lines.push('');

  // Architectural Environment
  lines.push('## Room & Architectural Environment');
  lines.push(`- **Dimensions**: ${report.room.width.toFixed(1)}m (W) × ${report.room.length.toFixed(1)}m (D) × ${report.room.height.toFixed(1)}m (H)`);
  lines.push(`- **Use Case / Archetype**: ${report.room.useCase}${report.room.templateId ? ` (\`${report.room.templateId}\`)` : ''}`);
  lines.push(`- **Seating Capacity**: ${report.room.seatCount} seats`);
  if (report.room.ceilingType || report.room.lightingStyle || report.room.flooringType || report.room.wallStyle) {
    lines.push(`- **Finishes**: Ceiling: \`${report.room.ceilingType ?? 'default'}\` | Lighting: \`${report.room.lightingStyle ?? 'default'}\` | Flooring: \`${report.room.flooringType ?? 'default'}\` | Wall: \`${report.room.wallStyle ?? 'default'}\``);
  }
  lines.push('');

  // Design Health
  lines.push(`## Design Health Score: ${report.health.score} / 100`);
  lines.push('| Subsystem | Score | Errors | Warnings | Status |');
  lines.push('| :--- | :--- | :--- | :--- | :--- |');
  for (const sub of report.health.subsystems.filter((s) => s.active)) {
    const status = sub.errors > 0 ? '❌ Error' : sub.warnings > 0 ? '⚠️ Warning' : '✅ Good';
    lines.push(`| ${sub.label} | ${sub.score} / 100 | ${sub.errors} | ${sub.warnings} | ${status} |`);
  }
  lines.push('');

  // Power Budget
  lines.push('## Power Budget');
  lines.push(`- **Total Power Consumption**: ${report.power.totalWatts.toFixed(1)} W`);
  lines.push(`- **PoE Power Budget**: ${report.power.poeWatts.toFixed(1)} W`);
  lines.push('');

  // BOM
  lines.push('## Bill of Materials (BOM)');
  lines.push(`Total Items: **${report.bom.totalItems}** | Unique Products: **${report.bom.totalUniqueProducts}**`);
  lines.push('');
  lines.push('| Item | Part Number | Manufacturer | Model | Category | Kind | Qty | Power | Rack |');
  lines.push('| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |');
  for (const l of report.bom.lines) {
    const pn = l.partNumber ?? '—';
    const pw = l.powerWatts != null ? `${l.powerWatts}W` : '—';
    const rack = l.rackMounted ? 'Yes' : 'No';
    lines.push(`| ${l.itemId} | ${pn} | ${l.manufacturer} | ${l.model} | ${l.category} | ${l.lineKind} | ${l.quantity} | ${pw} | ${rack} |`);
  }
  lines.push('');

  // Cable Schedule
  lines.push('## Cable Schedule');
  lines.push(`Total Connections: **${report.cables.summary.totalConnections}** | Total Estimated Run: **${report.cables.summary.totalEstimatedLengthM.toFixed(1)} m**`);
  lines.push('');
  lines.push('| Cable ID | From | To | Signal | Cable Type | Est. Length | Status |');
  lines.push('| :--- | :--- | :--- | :--- | :--- | :--- | :--- |');
  for (const r of report.cables.rows) {
    lines.push(`| ${r.cableId} | ${r.fromName} | ${r.toName} | ${r.signalType} | ${r.cableType} | ${r.estimatedLengthM.toFixed(1)} m | ${r.routeStatus} |`);
  }
  lines.push('');

  // Racks
  if (report.racks.length > 0) {
    lines.push('## Equipment Racks');
    for (const r of report.racks) {
      lines.push(`### Rack ${r.rackId} (${r.rackKind.toUpperCase()}, ${r.ruTotal} RU)`);
      lines.push(`- Utilization: ${r.elevation.usedRU}/${r.ruTotal} RU (${r.elevation.utilizationPct}%)`);
      lines.push(`- Thermal/Power Load: ${r.power.totalKnownWatts} W`);
      if (r.elevation.assignments.length > 0) {
        lines.push('');
        lines.push('| Unit (RU) | Equipment | Height |');
        lines.push('| :--- | :--- | :--- |');
        for (const a of r.elevation.assignments) {
          lines.push(`| U${a.startRU} | ${a.name} | ${a.rackUnits} RU |`);
        }
      }
      lines.push('');
    }
  }

  // Findings
  if (report.findings.length > 0) {
    lines.push('## Engineering Findings & Warnings');
    for (const f of report.findings) {
      lines.push(`- **[${f.severity.toUpperCase()}]** \`${f.id}\`: ${f.message}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Export engineering report as JSON.
 */
export function reportToJson(report: EngineeringReport): string {
  return JSON.stringify(report, null, 2);
}

