/**
 * roomChecks.ts
 * ────────────────────────────────────────────────────────────
 * Architectural room archetype and semantic zone alignment validation (§15, §16, §18).
 *
 * Rules:
 * - ROOM-001: Archetype Capacity Mismatch — Seat count vs typical template capacity
 * - ROOM-002: Display Wall Alignment — Primary display on or oriented toward presentation wall
 * - ROOM-003: Semantic Zone Placement — Microphones and cameras placed within semantic zones
 * ────────────────────────────────────────────────────────────
 */

import type { ProjectValidationContext } from './ValidationContext';
import type { ValidationCheck, ValidationFinding } from './ValidationTypes';
import { getRoomTemplate } from '../../room/RoomTemplates';
import { getPresentationWall } from '../../room/RoomGeometry';

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

/**
 * ROOM-001: Warns when the design seat count deviates significantly from
 * the selected architectural room archetype's recommended capacity range.
 */
export const checkRoomArchetypeCapacity: ValidationCheck = {
  code: 'ROOM-001',
  category: 'room',
  title: 'Archetype capacity mismatch',
  evaluate(ctx: ProjectValidationContext): ValidationFinding[] {
    if (!ctx.room || !ctx.room.templateId) return [];
    const template = getRoomTemplate(ctx.room.templateId);
    if (!template || ctx.room.templateId === 'custom') return [];

    const [minCap, maxCap] = template.typicalCapacity;
    const seatCount = ctx.seats.length;
    if (seatCount === 0) return [];

    if (seatCount < minCap) {
      return [
        finding({
          id: 'ROOM-001:under_capacity',
          code: 'ROOM-001',
          severity: 'info',
          category: 'room',
          title: 'Room under capacity for archetype',
          message: `${template.label} has ${seatCount} seats, below the typical range of ${minCap}–${maxCap} occupants.`,
          explanation: 'The room footprint and architectural finishes may be oversized for this seating layout.',
          metric: { name: 'Seats', actual: String(seatCount), expected: `${minCap}–${maxCap}` },
          recommendedActions: ['Increase seating count', 'Consider changing archetype to a smaller space (e.g. Huddle or Small Meeting)'],
          potentialVariables: ['Room template', 'Seating capacity'],
          source: 'RoomTemplate.typicalCapacity'
        })
      ];
    }

    if (seatCount > maxCap * 1.25) {
      return [
        finding({
          id: 'ROOM-001:over_capacity',
          code: 'ROOM-001',
          severity: 'warning',
          category: 'room',
          title: 'Room over capacity for archetype',
          message: `${template.label} has ${seatCount} seats, exceeding the typical maximum of ${maxCap} occupants by >25%.`,
          explanation: 'Crowded seating compromises AV viewing angles, acoustics, and egress circulation.',
          metric: { name: 'Seats', actual: String(seatCount), expected: `${minCap}–${maxCap}` },
          recommendedActions: ['Reduce seat count to improve occupant comfort and sightlines', 'Switch to a larger archetype such as Training or Classroom'],
          potentialVariables: ['Room template', 'Seating capacity'],
          source: 'RoomTemplate.typicalCapacity'
        })
      ];
    }

    return [
      finding({
        id: 'ROOM-001:pass',
        code: 'ROOM-001',
        severity: 'pass',
        category: 'room',
        title: 'Room capacity matches archetype',
        message: `${template.label} capacity (${seatCount} seats) is within the recommended range of ${minCap}–${maxCap}.`,
        explanation: 'Space allocation matches architectural archetype standards.',
        metric: { name: 'Seats', actual: String(seatCount), expected: `${minCap}–${maxCap}` },
        source: 'RoomTemplate.typicalCapacity'
      })
    ];
  }
};

/**
 * ROOM-002: Validates that primary displays are positioned on or facing the designated presentation wall.
 */
export const checkDisplayWallAlignment: ValidationCheck = {
  code: 'ROOM-002',
  category: 'room',
  title: 'Display presentation wall alignment',
  evaluate(ctx: ProjectValidationContext): ValidationFinding[] {
    if (!ctx.room) return [];
    if (ctx.display.kind !== 'ok') return [];

    const presWall = getPresentationWall(ctx.room);
    const disp = ctx.display.placement;
    const inst = ctx.display.instance;

    // Detect which wall the display is mounted on
    let dispWall: 'front' | 'back' | 'left' | 'right' = inst.wall ?? disp.wall;
    if (!inst.wall) {
      const hw = ctx.room.width / 2;
      const hd = ctx.room.depth / 2;
      const dFront = Math.abs(inst.position.z - (-hd));
      const dBack = Math.abs(inst.position.z - hd);
      const dLeft = Math.abs(inst.position.x - (-hw));
      const dRight = Math.abs(inst.position.x - hw);
      const minD = Math.min(dFront, dBack, dLeft, dRight);
      if (minD === dFront) dispWall = 'front';
      else if (minD === dBack) dispWall = 'back';
      else if (minD === dLeft) dispWall = 'left';
      else dispWall = 'right';
    }

    if (dispWall !== presWall) {
      return [
        finding({
          id: 'ROOM-002:wall_mismatch',
          code: 'ROOM-002',
          severity: 'warning',
          category: 'room',
          title: 'Display not on presentation wall',
          message: `Primary display is mounted on the ${dispWall} wall, but the room presentation wall is set to ${presWall}.`,
          explanation: 'Seating orientations and auto-placement heuristics align to the presentation wall.',
          objectId: ctx.display.instance.instanceId,
          affectedObjects: [{ kind: 'equipment', id: ctx.display.instance.instanceId, label: ctx.display.product.model }],
          recommendedActions: [`Move display to the ${presWall} wall`, `Update Room presentation wall to ${dispWall}`],
          source: 'RoomModel.presentationWall vs DisplayPlacement.wall'
        })
      ];
    }

    return [
      finding({
        id: 'ROOM-002:pass',
        code: 'ROOM-002',
        severity: 'pass',
        category: 'room',
        title: 'Display aligned with presentation wall',
        message: `Primary display is properly aligned with the ${presWall} presentation wall.`,
        explanation: 'Display coordinates match room orientation.',
        objectId: ctx.display.instance.instanceId,
        source: 'RoomGeometry.getPresentationWall'
      })
    ];
  }
};

/**
 * ROOM-003: Validates that microphones and cameras are placed within sensible room envelopes.
 */
export const checkSemanticZonePlacement: ValidationCheck = {
  code: 'ROOM-003',
  category: 'room',
  title: 'Sensor zone placement',
  evaluate(ctx: ProjectValidationContext): ValidationFinding[] {
    if (!ctx.room) return [];
    const room = ctx.room;
    const hw = room.width / 2;
    const hd = room.depth / 2;

    const findings: ValidationFinding[] = [];
    const sensors = ctx.equipment.filter((e) => {
      const p = ctx.catalog.get(e.productId);
      return p && (p.category === 'camera' || p.category === 'microphone');
    });

    for (const sensor of sensors) {
      const p = ctx.catalog.get(sensor.productId)!;
      const { x, z } = sensor.position;

      // Check if sensor is outside room bounds
      if (Math.abs(x) > hw + 0.05 || Math.abs(z) > hd + 0.05) {
        findings.push(
          finding({
            id: `ROOM-003:outside:${sensor.instanceId}`,
            code: 'ROOM-003',
            severity: 'error',
            category: 'room',
            title: 'Sensor outside room boundaries',
            message: `${p.manufacturer} ${p.model} is placed outside the room architectural envelope.`,
            explanation: 'AV sensors must be mounted within the physical room boundaries.',
            objectId: sensor.instanceId,
            affectedObjects: [{ kind: 'equipment', id: sensor.instanceId, label: sensor.name }],
            recommendedActions: ['Move device inside the room perimeter'],
            source: 'Room boundaries vs EquipmentInstance.position'
          })
        );
      }
    }

    if (findings.length > 0) return findings;

    if (sensors.length > 0) {
      return [
        finding({
          id: 'ROOM-003:pass',
          code: 'ROOM-003',
          severity: 'pass',
          category: 'room',
          title: 'Sensors positioned within room envelope',
          message: 'All cameras and microphones are placed within the room boundaries.',
          explanation: 'Sensors conform to architectural space limits.',
          source: 'Room boundaries vs EquipmentInstance.position'
        })
      ];
    }

    return [];
  }
};

export const ROOM_CHECKS: ValidationCheck[] = [
  checkRoomArchetypeCapacity,
  checkDisplayWallAlignment,
  checkSemanticZonePlacement
];
