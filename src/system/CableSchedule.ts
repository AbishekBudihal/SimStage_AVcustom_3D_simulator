/**
 * CableSchedule.ts
 * Derives a structured cable schedule from existing connections and cable routes.
 * Uses CableBoq and CableRouter — does not duplicate routing logic.
 */

import type { EquipmentInstance, EquipmentCatalog } from '../catalog/EquipmentCatalog';
import type { SystemConnection, PhysicalMedium } from './SystemTypes';
import type { CableRouteContext } from './CableRouter';
import { cachedCableRoute } from './CableRouter';
import { cableTypeOf } from './CableBoq';

export interface CableScheduleRow {
  /** Sequential cable ID (C-001, C-002, ...) for BOM/schematic reference. */
  cableId: string;
  connectionId: string;
  fromInstanceId: string;
  fromName: string;
  fromPort: string;
  toInstanceId: string;
  toName: string;
  toPort: string;
  signalType: string;
  cableType: PhysicalMedium;
  estimatedLengthM: number;
  routeStatus: 'clear' | 'intersects-obstacle' | 'no-room';
  pathType: string;
}

export interface CableScheduleSummary {
  totalConnections: number;
  totalEstimatedLengthM: number;
  byType: Array<{ cableType: PhysicalMedium; count: number; totalLengthM: number }>;
}

export interface CableScheduleResult {
  rows: CableScheduleRow[];
  summary: CableScheduleSummary;
}

/**
 * Generate a cable schedule from the current project connections.
 * All data is derived from existing connection + cable route computations.
 */
export function cableSchedule(
  connections: SystemConnection[],
  equipment: EquipmentInstance[],
  ctx: CableRouteContext
): CableScheduleResult {
  const rows: CableScheduleRow[] = connections.map((c, idx) => {
    const fromEq = equipment.find((e) => e.instanceId === c.fromInstanceId);
    const toEq = equipment.find((e) => e.instanceId === c.toInstanceId);
    const route = cachedCableRoute(c, ctx);
    return {
      cableId: `C-${String(idx + 1).padStart(3, '0')}`,
      connectionId: c.id,
      fromInstanceId: c.fromInstanceId,
      fromName: fromEq?.name ?? c.fromInstanceId,
      fromPort: c.fromPortId,
      toInstanceId: c.toInstanceId,
      toName: toEq?.name ?? c.toInstanceId,
      toPort: c.toPortId,
      signalType: c.signalType,
      cableType: cableTypeOf(c),
      estimatedLengthM: route.totalLength,
      routeStatus: route.status,
      pathType: route.pathType
    };
  });

  const byTypeMap = new Map<PhysicalMedium, { count: number; totalLengthM: number }>();
  for (const row of rows) {
    const entry = byTypeMap.get(row.cableType) ?? { count: 0, totalLengthM: 0 };
    entry.count += 1;
    entry.totalLengthM = Number((entry.totalLengthM + row.estimatedLengthM).toFixed(3));
    byTypeMap.set(row.cableType, entry);
  }

  return {
    rows,
    summary: {
      totalConnections: rows.length,
      totalEstimatedLengthM: Number(rows.reduce((s, r) => s + r.estimatedLengthM, 0).toFixed(3)),
      byType: Array.from(byTypeMap.entries()).map(([cableType, v]) => ({
        cableType,
        count: v.count,
        totalLengthM: v.totalLengthM
      }))
    }
  };
}

/**
 * Export cable schedule to CSV format.
 */
export function cableScheduleToCsv(result: CableScheduleResult): string {
  const esc = (s: string) => '"' + s.replace(/"/g, '""') + '"';
  const header = 'Cable ID,From,From Port,To,To Port,Signal,Cable Type,Length (m),Route Status';
  const lines = result.rows.map((r) =>
    [r.cableId, esc(r.fromName), r.fromPort, esc(r.toName), r.toPort,
     r.signalType, r.cableType, r.estimatedLengthM.toFixed(2), r.routeStatus].join(',')
  );
  return [header, ...lines].join('\n');
}
