/**
 * First-class AV rack. Not furniture. RU accounting never invents catalog data.
 */

import type { WallKey } from '../room/RoomGeometry';

export const RU_HEIGHT_M = 0.04445;

export type RackKind = 'floor' | 'wall';

export interface AVRack {
  id: string;
  kind: RackKind;
  /** Total rack units. Typical floor rack 42. */
  ruTotal: number;
  totalRU?: number;
  width: number;
  depth: number;
  /** Overall cabinet height (m). */
  height: number;
  x: number;
  y: number;
  z: number;
  rotationY: number;
  wall?: WallKey;
  frontClearance: number;
  rearClearance: number;
  ventilation: 'standard' | 'high' | 'unknown';
  powerRequirement?: string;
  networkRequirement?: string;
}

export function defaultFloorRack(id = 'av-rack-1'): AVRack {
  const ruTotal = 42;
  const height = ruTotal * RU_HEIGHT_M + 0.12;
  return {
    id,
    kind: 'floor',
    ruTotal,
    width: 0.6,
    depth: 0.9,
    height,
    x: 0,
    y: height / 2,
    z: 0,
    rotationY: 0,
    frontClearance: 1.0,
    rearClearance: 0.8,
    ventilation: 'unknown'
  };
}

export function defaultWallRack(id = 'av-rack-wall-1'): AVRack {
  const ruTotal = 12;
  const height = ruTotal * RU_HEIGHT_M + 0.08;
  return {
    id,
    kind: 'wall',
    ruTotal,
    width: 0.6,
    depth: 0.45,
    height,
    x: 0,
    y: 1.2,
    z: 0,
    rotationY: 0,
    frontClearance: 0.9,
    rearClearance: 0.05,
    ventilation: 'unknown'
  };
}

export function rackFootprint(rack: AVRack): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const hx = rack.width / 2;
  const hz = rack.depth / 2;
  const c = Math.cos(rack.rotationY);
  const s = Math.sin(rack.rotationY);
  const corners = [
    { x: -hx, z: -hz },
    { x: hx, z: -hz },
    { x: hx, z: hz },
    { x: -hx, z: hz }
  ].map((p) => ({ x: rack.x + p.x * c - p.z * s, z: rack.z + p.x * s + p.z * c }));
  return {
    minX: Math.min(...corners.map((p) => p.x)),
    maxX: Math.max(...corners.map((p) => p.x)),
    minZ: Math.min(...corners.map((p) => p.z)),
    maxZ: Math.max(...corners.map((p) => p.z))
  };
}

/** Footprint plus front/rear service clearances along local ±Z of the rack. */
export function rackServiceAabb(rack: AVRack): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const hx = rack.width / 2 + 0.05;
  const front = rack.depth / 2 + rack.frontClearance;
  const rear = rack.depth / 2 + rack.rearClearance;
  const c = Math.cos(rack.rotationY);
  const s = Math.sin(rack.rotationY);
  const local = [
    { x: -hx, z: -front },
    { x: hx, z: -front },
    { x: hx, z: rear },
    { x: -hx, z: rear }
  ].map((p) => ({ x: rack.x + p.x * c - p.z * s, z: rack.z + p.x * s + p.z * c }));
  return {
    minX: Math.min(...local.map((p) => p.x)),
    maxX: Math.max(...local.map((p) => p.x)),
    minZ: Math.min(...local.map((p) => p.z)),
    maxZ: Math.max(...local.map((p) => p.z))
  };
}

export function usedRackUnits(assignments: Array<{ rackUnits?: number | null }>): number {
  return assignments.reduce((sum, a) => sum + (a.rackUnits && a.rackUnits > 0 ? a.rackUnits : 0), 0);
}
