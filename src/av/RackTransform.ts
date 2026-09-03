/**
 * RackTransform.ts
 * Pure functions computing equipment world position from rack + RU position.
 * Independent of Three.js — testable with vitest.
 */

import type { AVRack } from './AVRack';
import { RU_HEIGHT_M } from './AVRack';

export interface RackWorldPosition {
  x: number;
  y: number;
  z: number;
  rotationY: number;
}

/**
 * Compute the world-space position of rack-mounted equipment.
 *
 * @param rack       The rack containing the equipment
 * @param positionRU Bottom RU index (1-based)
 * @param equipRU    Number of rack units the equipment occupies
 * @param equipDepth Physical depth of the equipment (meters)
 * @returns World position and rotation matching the rack's transform
 */
export function equipmentWorldPosition(
  rack: AVRack,
  positionRU: number,
  equipRU: number,
  equipDepth: number
): RackWorldPosition {
  // Rack y is at its center. Bottom of rack interior is y - height/2 + small clearance.
  const rackBottom = rack.y - rack.height / 2 + 0.04; // 4 cm bottom rail clearance
  const equipCenterHeight = (positionRU - 1) * RU_HEIGHT_M + (equipRU * RU_HEIGHT_M) / 2;
  const localY = rackBottom + equipCenterHeight;

  // Equipment sits at the front of the rack (positive Z in local rack space)
  const localZ = rack.depth / 2 - equipDepth / 2 - 0.02; // 2 cm inset from front face

  // Apply rack rotation to local offset
  const cos = Math.cos(rack.rotationY);
  const sin = Math.sin(rack.rotationY);

  return {
    x: rack.x + localZ * sin,
    y: localY,
    z: rack.z + localZ * cos,
    rotationY: rack.rotationY
  };
}

/**
 * Check if equipment should be rendered inside a rack (not in open room).
 * Equipment is rack-rendered when it has a rackId and a valid RU position.
 */
export function isRackRendered(
  instance: { rackId?: string; rackPositionRU?: number }
): boolean {
  return instance.rackId != null && instance.rackPositionRU != null && instance.rackPositionRU > 0;
}
