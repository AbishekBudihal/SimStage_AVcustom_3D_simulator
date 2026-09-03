/**
 * RackSchedule.ts
 * Pure functions that derive rack elevation and power data from project state.
 * No rendering. No mutations. No invented specifications.
 */

import type { AVRack } from './AVRack';
import { usedRackUnits } from './AVRack';
import type { EquipmentInstance, EquipmentCatalog } from '../catalog/EquipmentCatalog';

export interface RackSlot {
  ru: number;
  status: 'free' | 'occupied';
  equipmentId?: string;
  equipmentName?: string;
  /** True if this RU is the first (bottom) unit of a multi-RU device. */
  deviceStart?: boolean;
}

export interface RackElevation {
  rackId: string;
  kind: AVRack['kind'];
  ruTotal: number;
  usedRU: number;
  freeRU: number;
  utilizationPct: number;
  slots: RackSlot[];
  assignments: Array<{
    instanceId: string;
    name: string;
    productId: string;
    startRU: number;
    endRU: number;
    rackUnits: number;
  }>;
  /** True if any assigned device has no RU data. */
  incomplete: boolean;
}

export interface RackPowerLine {
  instanceId: string;
  name: string;
  powerWatts: number | undefined;
}

export interface RackPowerSummary {
  lines: RackPowerLine[];
  totalKnownWatts: number;
  unknownCount: number;
  /** True only when all assigned devices have known power data. */
  complete: boolean;
}

/**
 * Build a rack elevation showing every RU slot and which equipment occupies it.
 */
export function rackElevation(
  rack: AVRack,
  equipment: EquipmentInstance[],
  catalog: EquipmentCatalog
): RackElevation {
  const assigned = equipment.filter((e) => e.rackId === rack.id);
  const used = usedRackUnits(assigned);

  // Build slot map
  const slots: RackSlot[] = [];
  for (let ru = 1; ru <= rack.ruTotal; ru++) {
    slots.push({ ru, status: 'free' });
  }

  const assignments: RackElevation['assignments'] = [];
  for (const inst of assigned) {
    const product = catalog.get(inst.productId);
    const units = inst.rackUnits ?? product?.rackUnits;
    const start = inst.rackPositionRU;
    if (!start || start <= 0 || !units || units <= 0) continue;
    const end = start + units - 1;
    assignments.push({
      instanceId: inst.instanceId,
      name: inst.name,
      productId: inst.productId,
      startRU: start,
      endRU: Math.min(end, rack.ruTotal),
      rackUnits: units
    });
    for (let ru = start; ru <= Math.min(end, rack.ruTotal); ru++) {
      const slot = slots[ru - 1];
      if (slot) {
        slot.status = 'occupied';
        slot.equipmentId = inst.instanceId;
        slot.equipmentName = inst.name;
        slot.deviceStart = ru === start;
      }
    }
  }

  const incomplete = assigned.some(
    (e) => !(e.rackUnits && e.rackUnits > 0) && !catalog.get(e.productId)?.rackUnits
  );

  return {
    rackId: rack.id,
    kind: rack.kind,
    ruTotal: rack.ruTotal,
    usedRU: used,
    freeRU: rack.ruTotal - used,
    utilizationPct: rack.ruTotal > 0 ? Math.round((used / rack.ruTotal) * 100) : 0,
    slots,
    assignments,
    incomplete
  };
}

/**
 * Summarize power consumption for rack-assigned equipment.
 * Uses catalog powerWatts only — never invented.
 */
export function rackPowerSummary(
  rack: AVRack,
  equipment: EquipmentInstance[],
  catalog: EquipmentCatalog
): RackPowerSummary {
  const assigned = equipment.filter((e) => e.rackId === rack.id);
  const lines: RackPowerLine[] = assigned.map((inst) => {
    const product = catalog.get(inst.productId);
    return {
      instanceId: inst.instanceId,
      name: inst.name,
      powerWatts: product?.physical?.powerWatts
    };
  });
  const totalKnownWatts = lines.reduce((sum, l) => sum + (l.powerWatts ?? 0), 0);
  const unknownCount = lines.filter((l) => l.powerWatts == null).length;
  return {
    lines,
    totalKnownWatts,
    unknownCount,
    complete: unknownCount === 0 && lines.length > 0
  };
}
