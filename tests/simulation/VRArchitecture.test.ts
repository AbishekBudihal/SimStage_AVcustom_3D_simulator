/**
 * VRArchitecture.test.ts
 * Tests for Phase 16: VR Architectural Integration & Production Hardening (§21, §27, §28)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { AppState } from '../../src/app/AppState';
import { createDefaultRoom } from '../../src/room/RoomModel';
import {
  computeVRWaypoints,
  isWebXRSupported,
  VRSceneRig,
  VR_EYE_HEIGHTS,
  type VRWaypoint
} from '../../src/engine/VRCompatibility';

describe('VR Architectural Integration (§21, §27, §28)', () => {
  let state: AppState;

  beforeEach(() => {
    state = new AppState();
    state.room = createDefaultRoom();
  });

  describe('AVIXA Eye-Height Ergonomic Standards', () => {
    it('defines standard eye-height presets', () => {
      expect(VR_EYE_HEIGHTS.seated).toBe(1.15); // Standard AVIXA seated eye height AFF
      expect(VR_EYE_HEIGHTS.standing).toBe(1.65); // Standard standing presenter eye height AFF
      expect(VR_EYE_HEIGHTS.overview).toBe(2.4); // Elevated spatial overview AFF
    });
  });

  describe('computeVRWaypoints', () => {
    it('generates semantic room waypoints for a default room', () => {
      const waypoints = computeVRWaypoints(state);
      expect(waypoints.length).toBeGreaterThanOrEqual(4);

      const roles = waypoints.map((w) => w.role);
      expect(roles).toContain('overview');
      expect(roles).toContain('presenter');
      expect(roles).toContain('seated_attendee');
      expect(roles).toContain('room_entry');
    });

    it('positions presenter waypoint at the front presentation zone facing the room', () => {
      const waypoints = computeVRWaypoints(state);
      const presenter = waypoints.find((w) => w.role === 'presenter');
      expect(presenter).toBeDefined();
      expect(presenter!.preferredEyeHeight).toBe('standing');
      expect(presenter!.position.y).toBe(1.65);
      // Front wall is negative Z in standard coordinates
      expect(presenter!.position.z).toBeLessThan(0);
      // Look target is toward center of room
      expect(presenter!.targetLookAt.z).toBe(0);
    });

    it('adapts seated waypoint to actual seat coordinates when seats exist', () => {
      state.seats = [
        { id: 'seat-1', row: 1, indexInRow: 0, x: -1.2, z: 1.0, facing: 0, hasTable: true },
        { id: 'seat-2', row: 1, indexInRow: 1, x: 0.0, z: 1.0, facing: 0, hasTable: true },
        { id: 'seat-3', row: 1, indexInRow: 2, x: 1.2, z: 1.0, facing: 0, hasTable: true }
      ];
      const waypoints = computeVRWaypoints(state);
      const seatedWp = waypoints.find((w) => w.role === 'seated_attendee');
      expect(seatedWp).toBeDefined();
      expect(seatedWp!.id).toBe('vr-seat-seat-2');
      expect(seatedWp!.position.x).toBe(0.0);
      expect(seatedWp!.position.y).toBe(1.15);
      expect(seatedWp!.position.z).toBe(1.0);
    });

    it('creates table head waypoint when conference table exists', () => {
      state.tables = [
        {
          id: 'table-1',
          centerX: 0,
          centerZ: 0,
          sizeX: 1.5,
          sizeZ: 3.6,
          height: 0.74,
          shape: 'rect',
          hasCableWell: true
        }
      ];
      const waypoints = computeVRWaypoints(state);
      const tableHead = waypoints.find((w) => w.role === 'table_head');
      expect(tableHead).toBeDefined();
      expect(tableHead!.preferredEyeHeight).toBe('seated');
      expect(tableHead!.position.y).toBe(1.15);
      expect(tableHead!.position.z).toBeGreaterThan(0);
    });

    it('constrains waypoints strictly inside room boundaries', () => {
      const room = state.room!;
      const waypoints = computeVRWaypoints(state);
      const halfW = room.width / 2;
      const halfD = room.depth / 2;

      for (const wp of waypoints) {
        expect(Math.abs(wp.position.x)).toBeLessThanOrEqual(halfW);
        expect(Math.abs(wp.position.z)).toBeLessThanOrEqual(halfD);
      }
    });
  });

  describe('isWebXRSupported', () => {
    it('safely returns false in headless Node test environment without crashing', async () => {
      const supported = await isWebXRSupported();
      expect(supported).toBe(false);
    });
  });

  describe('VRSceneRig', () => {
    it('initializes Three.js camera rig with user eye-height translation', () => {
      const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 100);
      const rig = new VRSceneRig(camera);

      expect(rig.rootGroup).toBeDefined();
      expect(rig.rootGroup.children).toContain(camera);
      expect(rig.eyeHeightM).toBe(1.15);
    });

    it('updates camera eye height for standing vs seated presets', () => {
      const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 100);
      const rig = new VRSceneRig(camera);

      rig.setEyeHeight('standing');
      expect(rig.eyeHeightM).toBe(1.65);
      expect(camera.position.y).toBe(1.65);

      rig.setEyeHeight('seated');
      expect(rig.eyeHeightM).toBe(1.15);
      expect(camera.position.y).toBe(1.15);
    });

    it('teleports rig to a semantic waypoint and points camera at target', () => {
      const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 100);
      const rig = new VRSceneRig(camera);

      const waypoint: VRWaypoint = {
        id: 'wp-test',
        label: 'Test Waypoint',
        description: 'Testing teleport',
        role: 'presenter',
        position: { x: 2.0, y: 1.65, z: -3.0 },
        targetLookAt: { x: 0, y: 1.15, z: 0 },
        preferredEyeHeight: 'standing'
      };

      rig.teleportTo(waypoint);
      expect(rig.currentWaypoint).toBe(waypoint);
      expect(rig.rootGroup.position.x).toBe(2.0);
      expect(rig.rootGroup.position.z).toBe(-3.0);
      expect(rig.eyeHeightM).toBe(1.65);
    });
  });

  describe('AppState VR Walkthrough Integration', () => {
    it('enters VR walkthrough and automatically engages presentation mode', () => {
      expect(state.presentationMode).toBe(false);
      expect(state.vrMode).toBe(false);

      state.enterVRWalkthrough();

      expect(state.presentationMode).toBe(true);
      expect(state.vrMode).toBe(true);
      expect(state.vrCurrentWaypointId).toBe('vr-overview');
    });

    it('allows toggling eye-height between seated and standing', () => {
      state.enterVRWalkthrough();
      expect(state.vrEyeHeight).toBe('overview');

      state.setVREyeHeight('seated');
      expect(state.vrEyeHeight).toBe('seated');

      state.setVREyeHeight('standing');
      expect(state.vrEyeHeight).toBe('standing');
    });

    it('teleports to specified semantic waypoint and updates eye height', () => {
      state.enterVRWalkthrough();
      state.teleportToVRWaypoint('vr-presenter');

      expect(state.vrCurrentWaypointId).toBe('vr-presenter');
      expect(state.vrEyeHeight).toBe('standing');
    });

    it('exits VR walkthrough while preserving presentation mode', () => {
      state.enterVRWalkthrough();
      expect(state.vrMode).toBe(true);

      state.exitVRWalkthrough();
      expect(state.vrMode).toBe(false);
      expect(state.presentationMode).toBe(true);
    });

    it('exits both presentation and VR modes on exitPresentationMode', () => {
      state.enterVRWalkthrough();
      expect(state.presentationMode).toBe(true);
      expect(state.vrMode).toBe(true);

      state.exitPresentationMode();
      expect(state.presentationMode).toBe(false);
      expect(state.vrMode).toBe(false);
    });
  });
});
