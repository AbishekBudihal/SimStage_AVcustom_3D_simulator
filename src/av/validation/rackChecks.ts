/**
 * AV rack placement and RU capacity. Uses catalog RU only when present.
 */

import type { ProjectValidationContext } from './ValidationContext';
import type { ValidationCheck, ValidationFinding } from './ValidationTypes';
import { aabbsOverlap, aabbInsideRoom, openingExclusionAabb, tableAabb, chairAabb } from '../../room/FurnitureGeometry';
import { rackFootprint, rackServiceAabb, usedRackUnits } from '../AVRack';

function finding(
  partial: Omit<ValidationFinding, 'affectedObjects' | 'recommendedActions' | 'potentialVariables'> & {
    affectedObjects?: ValidationFinding['affectedObjects'];
    recommendedActions?: string[];
    potentialVariables?: string[];
  }
): ValidationFinding {
  return {
    affectedObjects: [],
    recommendedActions: [],
    potentialVariables: [],
    ...partial
  };
}

export const checkRackPresent: ValidationCheck = {
  code: 'RACK-001',
  category: 'rack',
  title: 'Rack footprint',
  evaluate(ctx: ProjectValidationContext): ValidationFinding[] {
    if (!ctx.room || !ctx.racks.length) return [];
    return ctx.racks.flatMap((rack) => {
      const foot = rackFootprint(rack);
      if (aabbInsideRoom(ctx.room!, foot, 0.02)) {
        return [
          finding({
            id: `RACK-001:${rack.id}`,
            code: 'RACK-001',
            severity: 'pass',
            category: 'rack',
            title: 'Rack within room',
            message: `${rack.id} footprint is inside the room.`,
            explanation: 'Rack cabinet AABB vs room envelope.',
            affectedObjects: [{ kind: 'rack', id: rack.id, label: rack.id }],
            source: 'AVRack footprint vs room.'
          })
        ];
      }
      return [
        finding({
          id: `RACK-001:${rack.id}`,
          code: 'RACK-001',
          severity: 'error',
          category: 'rack',
          title: 'Rack outside room',
          message: `${rack.id} intersects a wall or leaves the room.`,
          explanation: 'The rack cabinet must remain inside the architectural envelope.',
          affectedObjects: [{ kind: 'rack', id: rack.id, label: rack.id }],
          recommendedActions: ['Move the rack', 'Use a wall-mounted rack'],
          source: 'AVRack footprint vs room.'
        })
      ];
    });
  }
};

export const checkRackClearance: ValidationCheck = {
  code: 'RACK-002',
  category: 'rack',
  title: 'Rack service clearance',
  evaluate(ctx: ProjectValidationContext): ValidationFinding[] {
    if (!ctx.room || !ctx.racks.length) return [];
    const out: ValidationFinding[] = [];
    ctx.racks.forEach((rack) => {
      const service = rackServiceAabb(rack);
      const foot = rackFootprint(rack);
      const doorHit = ctx.room!.openings.some((o) => aabbsOverlap(foot, openingExclusionAabb(ctx.room!, o.wall, o.offset, o.width), 0.05));
      const furnHit = ctx.tables.some((t) => aabbsOverlap(service, tableAabb(t), 0.05));
      const chairHit = ctx.seats.some((s) => aabbsOverlap(service, chairAabb(s), 0.02));
      const inside = aabbInsideRoom(ctx.room!, service, 0.0);
      if (!doorHit && !furnHit && !chairHit && inside) {
        out.push(
          finding({
            id: `RACK-002:${rack.id}`,
            code: 'RACK-002',
            severity: 'pass',
            category: 'rack',
            title: 'Front/rear clearance acceptable',
            message: `Service envelope ${rack.frontClearance.toFixed(2)} m front / ${rack.rearClearance.toFixed(2)} m rear is clear.`,
            explanation: 'Rack service AABB vs doors, tables, and chairs.',
            affectedObjects: [{ kind: 'rack', id: rack.id, label: rack.id }],
            source: 'AVRack service AABB.'
          })
        );
        return;
      }
      out.push(
        finding({
          id: `RACK-002:${rack.id}`,
          code: 'RACK-002',
          severity: doorHit ? 'warning' : 'warning',
          category: 'rack',
          title: doorHit ? 'Rack placement conflicts with door clearance' : 'Rack service clearance tight',
          message: doorHit
            ? 'Rack footprint overlaps a door/window exclusion.'
            : 'Front or rear service envelope overlaps furniture or the room boundary.',
          explanation: 'Service clearance is part of a usable rack position.',
          affectedObjects: [{ kind: 'rack', id: rack.id, label: rack.id }],
          recommendedActions: ['Move the rack', 'Reduce nearby furniture'],
          source: 'AVRack service AABB vs openings/furniture.'
        })
      );
    });
    return out;
  }
};

export const checkRackCapacity: ValidationCheck = {
  code: 'RACK-003',
  category: 'rack',
  title: 'Rack RU capacity',
  evaluate(ctx: ProjectValidationContext): ValidationFinding[] {
    if (!ctx.racks.length) return [];
    return ctx.racks.map((rack) => {
      const assigned = ctx.equipment.filter((e) => e.rackId === rack.id);
      const used = usedRackUnits(assigned);
      const available = rack.ruTotal - used;
      const incomplete = assigned.some((e) => !(e.rackUnits && e.rackUnits > 0) && !ctx.catalog.get(e.productId)?.rackUnits);
      if (used > rack.ruTotal) {
        return finding({
          id: `RACK-003:${rack.id}`,
          code: 'RACK-003',
          severity: 'error',
          category: 'rack',
          title: 'Equipment exceeds rack capacity',
          message: `Used ${used} RU of ${rack.ruTotal} RU.`,
          explanation: 'Assigned rackUnits sum cannot exceed ruTotal.',
          metric: { name: 'RU', actual: String(used), expected: String(rack.ruTotal), unit: 'RU' },
          affectedObjects: [{ kind: 'rack', id: rack.id, label: rack.id }],
          recommendedActions: ['Use a taller rack', 'Move equipment to another rack'],
          source: 'Sum of instance/catalog rackUnits vs ruTotal.'
        });
      }
      if (incomplete) {
        return finding({
          id: `RACK-003:${rack.id}`,
          code: 'RACK-003',
          severity: 'warning',
          category: 'rack',
          title: 'DATA INCOMPLETE',
          message: 'Some assigned devices have no catalog or user-defined RU. Capacity is only counted for devices with RU data.',
          explanation: 'RU is never invented from device category.',
          metric: { name: 'Available RU', actual: String(available), expected: String(rack.ruTotal), unit: 'RU' },
          affectedObjects: [{ kind: 'rack', id: rack.id, label: rack.id }],
          source: 'EquipmentInstance.rackUnits / EquipmentProduct.rackUnits.'
        });
      }
      const sev = available <= 4 && used > 0 ? 'warning' : 'pass';
      return finding({
        id: `RACK-003:${rack.id}`,
        code: 'RACK-003',
        severity: sev,
        category: 'rack',
        title: sev === 'warning' ? 'Rack is approaching capacity' : 'Rack capacity available',
        message: `Used ${used} RU. Available ${available} RU of ${rack.ruTotal} RU.`,
        explanation: 'Counted only from known rackUnits.',
        metric: { name: 'Available RU', actual: String(available), expected: String(rack.ruTotal), unit: 'RU' },
        affectedObjects: [{ kind: 'rack', id: rack.id, label: rack.id }],
        source: 'Sum of known rackUnits vs ruTotal.'
      });
    });
  }
};

export function occupiedRuRanges(
  equipment: Array<{ instanceId: string; name: string; rackId?: string; rackPositionRU?: number; rackUnits?: number }>,
  rackId: string
): Array<{ instanceId: string; name: string; startRU: number; endRU: number }> {
  return equipment
    .filter((e) => e.rackId === rackId && e.rackPositionRU && e.rackPositionRU > 0 && e.rackUnits && e.rackUnits > 0)
    .map((e) => ({
      instanceId: e.instanceId,
      name: e.name,
      startRU: e.rackPositionRU!,
      endRU: e.rackPositionRU! + e.rackUnits! - 1
    }));
}

export const checkRackOverlap: ValidationCheck = {
  code: 'RACK-004',
  category: 'rack',
  title: 'RU overlap',
  evaluate(ctx: ProjectValidationContext): ValidationFinding[] {
    const out: ValidationFinding[] = [];
    for (const rack of ctx.racks) {
      const ranges = occupiedRuRanges(ctx.equipment, rack.id);
      for (let i = 0; i < ranges.length; i++) {
        for (let j = i + 1; j < ranges.length; j++) {
          const a = ranges[i];
          const b = ranges[j];
          if (a.startRU <= b.endRU && b.startRU <= a.endRU) {
            out.push(
              finding({
                id: `RACK-004:${rack.id}:${a.instanceId}:${b.instanceId}`,
                code: 'RACK-004',
                severity: 'error',
                category: 'rack',
                title: 'Equipment RU positions overlap',
                message: `${a.name} (U${a.startRU}–U${a.endRU}) overlaps ${b.name} (U${b.startRU}–U${b.endRU}) in ${rack.id}.`,
                explanation: 'Two devices cannot occupy the same rack unit position.',
                affectedObjects: [
                  { kind: 'equipment', id: a.instanceId, label: a.name },
                  { kind: 'equipment', id: b.instanceId, label: b.name },
                  { kind: 'rack', id: rack.id, label: rack.id }
                ],
                recommendedActions: ['Reassign RU positions', 'Move one device to another rack'],
                source: 'EquipmentInstance.rackPositionRU + rackUnits'
              })
            );
          }
        }
      }
    }
    return out;
  }
};

export const RACK_CHECKS: ValidationCheck[] = [checkRackPresent, checkRackClearance, checkRackCapacity, checkRackOverlap];
