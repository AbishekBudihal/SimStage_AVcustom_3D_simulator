/**
 * DesignAnalysis.ts
 * Single source of truth for "what is the active display, and what
 * does every seat's viewing analysis look like right now".
 *
 * Pipeline: Project State → viewing/sightline engines → structured
 * result → visualization/UI. No calculations live in React/DOM panels.
 */

import type { EquipmentInstance, EquipmentCatalog, EquipmentProduct } from '../catalog/EquipmentCatalog';
import type { Seat, TableSpec } from '../room/SeatingGenerator';
import type { RoomModel } from '../room/RoomModel';
import { presentationRotation } from '../room/RoomGeometry';
import {
  analyzeSeat,
  type CheckStatus,
  type DisplayPlacement,
  type SeatDisplayAnalysis
} from './ViewingDistanceEngine';
import { applyObstruction } from './SightlineEngine';
import { obstaclesFromProject } from './ObstacleBuilder';

/** Seated eye height above finished floor — standard AV design assumption, not per-seat measured. */
export const DEFAULT_EYE_HEIGHT_M = 1.1;
export const DEFAULT_CONTENT_TYPE = 'full_motion_video' as const;

export type ActiveDisplayResult =
  | { kind: 'none' }
  | { kind: 'incomplete'; reason: string; product: EquipmentProduct; instance: EquipmentInstance }
  | { kind: 'ok'; placement: DisplayPlacement; product: EquipmentProduct; instance: EquipmentInstance };

export function resolveActiveDisplay(equipment: EquipmentInstance[], catalog: EquipmentCatalog): ActiveDisplayResult {
  const inst = equipment.find((e) => catalog.get(e.productId)?.category === 'display');
  if (!inst) return { kind: 'none' };
  const product = catalog.get(inst.productId);
  if (!product) return { kind: 'none' };
  if (!product.display || !(product.physical.width > 0) || !(product.physical.height > 0)) {
    return {
      kind: 'incomplete',
      reason: 'Display is missing physical width/height or screen-size data required for viewing analysis. No values were invented.',
      product,
      instance: inst
    };
  }
  const rotationY = inst.rotationY !== undefined ? inst.rotationY : (inst.wall ? presentationRotation(inst.wall) : 0);
  return {
    kind: 'ok',
    product,
    instance: inst,
    placement: {
      diagonalInches: product.display.diagonalInches,
      aspectRatio: product.display.aspectRatio,
      widthM: product.physical.width,
      heightM: product.physical.height,
      position: inst.position,
      wall: inst.wall ?? 'front',
      rotationY
    }
  };
}

export function getActiveDisplay(equipment: EquipmentInstance[], catalog: EquipmentCatalog): DisplayPlacement | null {
  const resolved = resolveActiveDisplay(equipment, catalog);
  return resolved.kind === 'ok' ? resolved.placement : null;
}

export function analyzeSeatAgainstDisplay(
  display: DisplayPlacement,
  seat: Seat,
  obstacles: ReturnType<typeof obstaclesFromProject> = []
): SeatDisplayAnalysis {
  const viewer = { seatId: seat.id, x: seat.x, z: seat.z, eyeHeightM: DEFAULT_EYE_HEIGHT_M };
  const base = analyzeSeat(display, viewer, DEFAULT_CONTENT_TYPE);
  return applyObstruction(base, display, viewer, obstacles);
}

export function computeSeatStatuses(
  seats: Seat[],
  display: DisplayPlacement | null,
  obstacles: ReturnType<typeof obstaclesFromProject> = []
): Map<string, CheckStatus> {
  const map = new Map<string, CheckStatus>();
  if (!display) return map;
  seats.forEach((seat) => map.set(seat.id, analyzeSeatAgainstDisplay(display, seat, obstacles).overall));
  return map;
}

export function analyzeAllSeatsAgainstDisplay(
  seats: Seat[],
  display: DisplayPlacement | null,
  obstacles: ReturnType<typeof obstaclesFromProject> = []
): SeatDisplayAnalysis[] {
  if (!display) return [];
  return seats.map((seat) => analyzeSeatAgainstDisplay(display, seat, obstacles));
}

export interface DesignHealthSummary {
  totalSeats: number;
  passCount: number;
  warningCount: number;
  failCount: number;
  worstSeatId: string | null;
}

export function summarizeDesignHealth(
  seats: Seat[],
  display: DisplayPlacement | null,
  obstacles: ReturnType<typeof obstaclesFromProject> = []
): DesignHealthSummary {
  const summary: DesignHealthSummary = { totalSeats: seats.length, passCount: 0, warningCount: 0, failCount: 0, worstSeatId: null };
  if (!display) return summary;
  let worstRank = -1;
  seats.forEach((seat) => {
    const status = analyzeSeatAgainstDisplay(display, seat, obstacles).overall;
    if (status === 'pass') summary.passCount++;
    else if (status === 'warning') summary.warningCount++;
    else summary.failCount++;
    const rank = status === 'fail' ? 2 : status === 'warning' ? 1 : 0;
    if (rank > worstRank) {
      worstRank = rank;
      summary.worstSeatId = seat.id;
    }
  });
  return summary;
}

/**
 * Foundation for a future Design Health panel. Counts only — no invented
 * percentage scores. Status is FAIL if any seat fails, WARNING if any
 * warns, PASS if all pass, unavailable if there is no display or no seats.
 */
export interface ViewingHealth {
  status: CheckStatus | 'unavailable';
  totalSeats: number;
  passCount: number;
  warningCount: number;
  failCount: number;
  method: string;
}

export function viewingHealthFromSummary(summary: DesignHealthSummary, hasDisplay: boolean): ViewingHealth {
  if (!hasDisplay || summary.totalSeats === 0) {
    return {
      status: 'unavailable',
      totalSeats: summary.totalSeats,
      passCount: 0,
      warningCount: 0,
      failCount: 0,
      method: 'No display and seating pair available to evaluate.'
    };
  }
  const status: CheckStatus = summary.failCount ? 'fail' : summary.warningCount ? 'warning' : 'pass';
  return {
    status,
    totalSeats: summary.totalSeats,
    passCount: summary.passCount,
    warningCount: summary.warningCount,
    failCount: summary.failCount,
    method: 'Worst-of seat viewing results (distance heuristic, H/V angle, visibility, obstruction). Engineering estimate — not AVIXA DISCAS compliance.'
  };
}

export function projectObstacles(room: RoomModel | null, tables: TableSpec[], racks: import('./AVRack').AVRack[] = []) {
  return obstaclesFromProject(room, tables, racks);
}
