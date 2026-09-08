/**
 * VRCompatibility.ts
 * VR Architectural Integration & Production Hardening (§21, §27, §28)
 *
 * Provides a clean stereoscopic / VR compatibility layer for the AV engineering platform:
 * - Deterministic eye-height presets based on AVIXA ergonomic standards:
 *   - Seated participant: 1.15m AFF (Above Finished Floor)
 *   - Standing presenter: 1.65m AFF
 *   - Elevated room overview: 2.40m AFF
 * - Semantic VR waypoints computed directly from the single engineering model
 *   (AppState room, seating, tables, and equipment).
 * - Safe WebXR runtime capability detection with zero native polyfill requirements.
 * - Single Three.js scene architecture: VR consumes the exact same engineering model
 *   without maintaining parallel scene representations.
 */

import * as THREE from 'three';
import type { AppState } from '../app/AppState';

export type VREyeHeightPreset = 'seated' | 'standing' | 'overview';

export const VR_EYE_HEIGHTS: Record<VREyeHeightPreset, number> = {
  seated: 1.15,
  standing: 1.65,
  overview: 2.4
};

export type VRWaypointRole =
  | 'presenter'
  | 'seated_attendee'
  | 'table_head'
  | 'room_entry'
  | 'overview';

export interface VRWaypoint {
  id: string;
  label: string;
  description: string;
  role: VRWaypointRole;
  position: { x: number; y: number; z: number };
  targetLookAt: { x: number; y: number; z: number };
  preferredEyeHeight: VREyeHeightPreset;
}

/**
 * Checks if the current browser environment supports immersive WebXR VR sessions.
 * Never throws — safely returns false in non-XR environments (desktop/Node/Vite tests).
 */
export async function isWebXRSupported(): Promise<boolean> {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as unknown as { xr?: { isSessionSupported?: (mode: string) => Promise<boolean> } };
  if (!nav.xr || typeof nav.xr.isSessionSupported !== 'function') {
    return false;
  }
  try {
    return await nav.xr.isSessionSupported('immersive-vr');
  } catch {
    return false;
  }
}

/**
 * Computes semantic VR teleportation waypoints from the single engineering model in AppState.
 * Adheres to AVIXA ergonomic eye-height standards and spatial room semantics.
 */
export function computeVRWaypoints(state: AppState): VRWaypoint[] {
  const waypoints: VRWaypoint[] = [];
  const room = state.room ?? { width: 10, depth: 7, height: 3.2 };

  // 1. Overview perspective (elevated, looking down toward room center)
  waypoints.push({
    id: 'vr-overview',
    label: 'Room Overview',
    description: 'Elevated spatial viewpoint overviewing full room architecture and equipment layout.',
    role: 'overview',
    position: { x: 0, y: VR_EYE_HEIGHTS.overview, z: room.depth * 0.42 },
    targetLookAt: { x: 0, y: 1.2, z: 0 },
    preferredEyeHeight: 'overview'
  });

  // 2. Presenter perspective (front presentation zone facing attendees)
  const presenterZ = -room.depth / 2 + 1.2;
  waypoints.push({
    id: 'vr-presenter',
    label: 'Presenter Viewpoint',
    description: 'Standing presenter perspective facing the audience and conference table.',
    role: 'presenter',
    position: { x: 0, y: VR_EYE_HEIGHTS.standing, z: presenterZ },
    targetLookAt: { x: 0, y: VR_EYE_HEIGHTS.seated, z: 0 },
    preferredEyeHeight: 'standing'
  });

  // 3. Seated Attendee perspective
  if (state.seats.length > 0) {
    const centralSeat = state.seats[Math.floor(state.seats.length / 2)] ?? state.seats[0];
    waypoints.push({
      id: `vr-seat-${centralSeat.id}`,
      label: 'Participant Seat',
      description: 'First-person seated perspective from participant seating facing the presentation wall.',
      role: 'seated_attendee',
      position: { x: centralSeat.x, y: VR_EYE_HEIGHTS.seated, z: centralSeat.z },
      targetLookAt: { x: 0, y: 1.5, z: -room.depth / 2 },
      preferredEyeHeight: 'seated'
    });
  } else {
    waypoints.push({
      id: 'vr-seat-center',
      label: 'Central Seating Area',
      description: 'Seated viewpoint in room center facing primary presentation wall.',
      role: 'seated_attendee',
      position: { x: 0, y: VR_EYE_HEIGHTS.seated, z: 0 },
      targetLookAt: { x: 0, y: 1.5, z: -room.depth / 2 },
      preferredEyeHeight: 'seated'
    });
  }

  // 4. Head of Table perspective (if tables exist)
  if (state.tables.length > 0) {
    const mainTable = state.tables[0];
    const headZ = mainTable.centerZ + mainTable.sizeZ / 2 + 0.5;
    waypoints.push({
      id: 'vr-table-head',
      label: 'Executive Table Head',
      description: 'Head of table perspective with panoramic sightlines to both participants and display.',
      role: 'table_head',
      position: { x: mainTable.centerX, y: VR_EYE_HEIGHTS.seated, z: Math.min(room.depth / 2 - 0.6, headZ) },
      targetLookAt: { x: 0, y: 1.5, z: -room.depth / 2 },
      preferredEyeHeight: 'seated'
    });
  }

  // 5. Room Entry viewpoint
  const entryZ = room.depth / 2 - 0.8;
  waypoints.push({
    id: 'vr-entry',
    label: 'Room Entrance',
    description: 'First-impression perspective from entrance doorway looking into the space.',
    role: 'room_entry',
    position: { x: 0, y: VR_EYE_HEIGHTS.standing, z: entryZ },
    targetLookAt: { x: 0, y: 1.4, z: -room.depth / 4 },
    preferredEyeHeight: 'standing'
  });

  return waypoints;
}

/**
 * Lightweight VR Camera Rig for Three.js.
 * Encapsulates the user's eye-height translation and orientation
 * while maintaining compatibility with desktop PerspectiveCamera orbit controls.
 */
export class VRSceneRig {
  readonly rootGroup: THREE.Group;
  private camera: THREE.PerspectiveCamera;
  private currentEyeHeightM: number = VR_EYE_HEIGHTS.seated;
  private activeWaypoint: VRWaypoint | null = null;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.rootGroup = new THREE.Group();
    this.rootGroup.name = 'VR_Rig_Group';
    this.rootGroup.add(this.camera);
  }

  get eyeHeightM(): number {
    return this.currentEyeHeightM;
  }

  get currentWaypoint(): VRWaypoint | null {
    return this.activeWaypoint;
  }

  /** Set the camera eye-height offset relative to finished floor. */
  setEyeHeight(presetOrMeters: VREyeHeightPreset | number): void {
    const height = typeof presetOrMeters === 'number'
      ? presetOrMeters
      : VR_EYE_HEIGHTS[presetOrMeters] ?? VR_EYE_HEIGHTS.seated;
    this.currentEyeHeightM = height;
    this.camera.position.y = height;
  }

  /** Teleport the rig to a semantic VR waypoint. */
  teleportTo(waypoint: VRWaypoint, heightOverride?: number): void {
    this.activeWaypoint = waypoint;
    const height = heightOverride ?? VR_EYE_HEIGHTS[waypoint.preferredEyeHeight] ?? this.currentEyeHeightM;
    this.setEyeHeight(height);

    // Position rig on floor plane at waypoint X/Z
    this.rootGroup.position.set(waypoint.position.x, 0, waypoint.position.z);

    // Orient camera toward waypoint look-at target
    const lookTarget = new THREE.Vector3(
      waypoint.targetLookAt.x,
      waypoint.targetLookAt.y,
      waypoint.targetLookAt.z
    );
    this.camera.lookAt(lookTarget);
  }
}
