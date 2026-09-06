/**
 * DesignValidationEngine.ts
 * Consumes existing engineering engines and emits ValidationFindings.
 * Does not duplicate viewing math. Does not belong in undo snapshots.
 */

import type { RoomModel } from '../../room/RoomModel';
import type { Seat, TableSpec } from '../../room/SeatingGenerator';
import type { EquipmentInstance, EquipmentCatalog } from '../../catalog/EquipmentCatalog';
import type { SystemConnection, SystemRoute } from '../../system/SystemTypes';
import {
  analyzeAllSeatsAgainstDisplay,
  projectObstacles,
  resolveActiveDisplay
} from '../DesignAnalysis';
import { designSignature, summarizeFindings, type ValidationReport } from './ValidationTypes';
import { validationRegistry } from './ValidationRegistry';
import { BUILTIN_CHECKS } from './builtinChecks';
import { SYSTEM_CHECKS } from './systemChecks';
import { RACK_CHECKS } from './rackChecks';
import { CABLE_CHECKS } from './cableChecks';
import { ROOM_CHECKS } from './roomChecks';
import { POWER_CHECKS } from './powerChecks';
import type { ProjectValidationContext } from './ValidationContext';
import type { ValidationFinding } from './ValidationTypes';

let registered = false;

export function ensureBuiltinChecksRegistered(): void {
  if (registered) return;
  BUILTIN_CHECKS.forEach((c) => validationRegistry.register(c));
  SYSTEM_CHECKS.forEach((c) => validationRegistry.register(c));
  RACK_CHECKS.forEach((c) => validationRegistry.register(c));
  CABLE_CHECKS.forEach((c) => validationRegistry.register(c));
  registered = true;
}

export function buildValidationContext(input: {
  room: RoomModel | null;
  seats: Seat[];
  tables: TableSpec[];
  equipment: EquipmentInstance[];
  catalog: EquipmentCatalog;
  connections?: SystemConnection[];
  routes?: SystemRoute[];
  racks?: import('../../av/AVRack').AVRack[];
  cableLengthLimitsM?: Partial<Record<import('../../system/SystemTypes').PhysicalMedium, number>>;
}): ProjectValidationContext {
  const display = resolveActiveDisplay(input.equipment, input.catalog);
  const obstacles = projectObstacles(input.room, input.tables);
  const placement = display.kind === 'ok' ? display.placement : null;
  const seatAnalyses = analyzeAllSeatsAgainstDisplay(input.seats, placement, obstacles);
  return {
    room: input.room,
    seats: input.seats,
    tables: input.tables,
    equipment: input.equipment,
    connections: input.connections ?? [],
    routes: input.routes ?? [],
    racks: input.racks ?? [],
    catalog: input.catalog,
    display,
    seatAnalyses,
    obstacles,
    cableLengthLimitsM: input.cableLengthLimitsM ?? {}
  };
}

export function runDesignValidation(input: {
  room: RoomModel | null;
  seats: Seat[];
  tables: TableSpec[];
  equipment: EquipmentInstance[];
  catalog: EquipmentCatalog;
  connections?: SystemConnection[];
  routes?: SystemRoute[];
  racks?: import('../../av/AVRack').AVRack[];
  cableLengthLimitsM?: Partial<Record<import('../../system/SystemTypes').PhysicalMedium, number>>;
}): ValidationReport {
  ensureBuiltinChecksRegistered();
  const signature = designSignature(input);
  const ctx = buildValidationContext(input);
  const findings: ValidationFinding[] = [];
  for (const check of validationRegistry.list()) {
    findings.push(...check.evaluate(ctx));
  }
  return {
    findings,
    summary: summarizeFindings(findings),
    generatedFromSignature: signature
  };
}

export function focusTargetForFinding(
  finding: ValidationFinding,
  seats: Seat[],
  equipment: { instanceId: string; position: { x: number; y: number; z: number } }[] = []
): { x: number; y: number; z: number } | null {
  const seatIds = finding.affectedObjects.filter((o) => o.kind === 'seat').map((o) => o.id);
  const pts = seats.filter((s) => seatIds.includes(s.id));
  if (pts.length > 0) {
    const x = pts.reduce((a, s) => a + s.x, 0) / pts.length;
    const z = pts.reduce((a, s) => a + s.z, 0) / pts.length;
    return { x, y: 1.1, z };
  }
  const eqIds = finding.affectedObjects.filter((o) => o.kind === 'equipment').map((o) => o.id);
  const eqs = equipment.filter((e) => eqIds.includes(e.instanceId));
  if (eqs.length === 0) return null;
  const x = eqs.reduce((a, e) => a + e.position.x, 0) / eqs.length;
  const y = eqs.reduce((a, e) => a + e.position.y, 0) / eqs.length;
  const z = eqs.reduce((a, e) => a + e.position.z, 0) / eqs.length;
  return { x, y, z };
}
