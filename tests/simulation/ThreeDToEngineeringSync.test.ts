import { describe, it, expect, beforeEach } from 'vitest';
import { AppState } from '../../src/app/AppState';
import { loadDefaultCatalog } from '../../src/catalog/loadCatalog';
import { equipmentWorldPosition } from '../../src/av/RackTransform';
import { cableSchedule } from '../../src/system/CableSchedule';
import { cableRouteContext } from '../../src/system/cableContext';
import { runDesignValidation } from '../../src/av/validation/DesignValidationEngine';
import { createDefaultRoom } from '../../src/room/RoomModel';
import type { EquipmentInstance } from '../../src/catalog/EquipmentCatalog';

describe('Phase 11: 3D → Engineering Model Synchronization (§1, §2, §24, §28)', () => {
  let state: AppState;
  const catalog = loadDefaultCatalog();

  beforeEach(() => {
    state = new AppState();
    const baseRoom = createDefaultRoom('boardroom');
    state.setRoom({
      ...baseRoom,
      width: 8,
      depth: 6,
      height: 3,
      openings: [],
      columns: []
    });
  });

  describe('3D Equipment Movement → Cable Route & Length Synchronization (§24)', () => {
    it('automatically recalculates obstacle-aware cable length when equipment moves in 3D', () => {
      // Add display on front wall
      const displayInst: EquipmentInstance = {
        instanceId: 'disp-01',
        productId: 'generic-75-pro',
        name: 'Main Display',
        position: { x: 0, y: 1.6, z: 0.05 },
        rotationY: 0,
        wall: 'front',
        placementMode: 'manual'
      };
      state.addEquipment(displayInst);

      // Add a switcher / transmitter at table center
      const txInst: EquipmentInstance = {
        instanceId: 'tx-01',
        productId: 'generic-av-switcher-4x2',
        name: 'Table Switcher',
        position: { x: 0, y: 0.75, z: 3.0 },
        rotationY: 0,
        placementMode: 'manual'
      };
      state.addEquipment(txInst);

      // Connect tx to display (hdmi-out-1 -> hdmi-in-1)
      const connected = state.addConnection('tx-01', 'hdmi-out-1', 'disp-01', 'hdmi-in-1');
      expect(connected).toBe(true);

      const conn = state.connections.find((c) => c.fromInstanceId === 'tx-01' && c.toInstanceId === 'disp-01')!;
      expect(conn).toBeDefined();
      const initialLength = conn.estimatedLengthM!;
      expect(initialLength).toBeGreaterThan(0);

      // Move display 3 meters along the wall (to the right: x = 3.0)
      state.updateEquipment('disp-01', {
        position: { x: 3.0, y: 1.6, z: 0.05 }
      });

      const updatedConn = state.connections.find((c) => c.id === conn.id)!;
      // Moving further away must recalculate and increase cable route length
      expect(updatedConn.estimatedLengthM).toBeGreaterThan(initialLength);

      // Verify cable schedule is synchronized
      const ctx = cableRouteContext(state, catalog);
      const schedule = cableSchedule(state.connections, state.equipment, ctx);
      expect(schedule.rows[0].estimatedLengthM).toBe(updatedConn.estimatedLengthM);
      expect(schedule.summary.totalEstimatedLengthM).toBe(updatedConn.estimatedLengthM);
    });
  });

  describe('Rack 3D Movement → Mounted Equipment & World Position Synchronization (§1, §24)', () => {
    it('synchronizes mounted equipment coordinates when assigned to a rack', () => {
      const rack = state.addDefaultRack('floor');
      expect(rack).toBeDefined();

      const dspInst: EquipmentInstance = {
        instanceId: 'dsp-01',
        productId: 'generic-dsp-8x8',
        name: 'Core DSP',
        position: { x: 0, y: 0, z: 0 },
        rotationY: 0,
        placementMode: 'manual'
      };
      state.addEquipment(dspInst);

      // Assign to rack at slot 1
      state.assignEquipmentToRack('dsp-01', rack.id, 2);

      const mounted = state.equipment.find((e) => e.instanceId === 'dsp-01')!;
      expect(mounted.rackId).toBe(rack.id);
      expect(mounted.rackPositionRU).toBe(1);
      expect(mounted.mountingKind).toBe('rack');

      const prod = catalog.get('generic-dsp-8x8')!;
      // The equipment position must match equipmentWorldPosition
      const expectedWorld = equipmentWorldPosition(rack, 1, 2, prod.physical.depth);
      expect(mounted.position.x).toBeCloseTo(expectedWorld.x, 2);
      expect(mounted.position.z).toBeCloseTo(expectedWorld.z, 2);
      expect(mounted.rotationY).toBeCloseTo(expectedWorld.rotationY, 2);
    });

    it('moves all rack-mounted devices and updates cable routes when the rack moves in 3D', () => {
      const rack = state.addDefaultRack('floor');
      const dspInst: EquipmentInstance = {
        instanceId: 'dsp-01',
        productId: 'generic-dsp-8x8',
        name: 'Core DSP',
        position: { x: 0, y: 0, z: 0 },
        rotationY: 0,
        placementMode: 'manual'
      };
      state.addEquipment(dspInst);
      state.assignEquipmentToRack('dsp-01', rack.id, 2);

      // Add a microphone on the ceiling
      const micInst: EquipmentInstance = {
        instanceId: 'mic-01',
        productId: 'shure-mxa710w',
        name: 'Ceiling Mic',
        position: { x: 0, y: 2.8, z: 3.0 },
        rotationY: 0,
        placementMode: 'manual'
      };
      state.addEquipment(micInst);

      // Connect mic to DSP
      const connected = state.addConnection('mic-01', 'net-1', 'dsp-01', 'net-1');
      expect(connected).toBe(true);
      const conn = state.connections[0];
      const initialCableLen = conn.estimatedLengthM!;
      expect(initialCableLen).toBeGreaterThan(0);

      // Move rack to the opposite side of the room in 3D
      const newRackX = -3.2;
      const newRackZ = -2.0;
      const newRotY = Math.PI / 2;
      state.updateRack(rack.id, {
        x: newRackX,
        z: newRackZ,
        rotationY: newRotY
      });

      // Mounted DSP position must have moved along with the rack
      const updatedDSP = state.equipment.find((e) => e.instanceId === 'dsp-01')!;
      const prod = catalog.get('generic-dsp-8x8')!;
      const expectedWorld = equipmentWorldPosition(
        { ...rack, x: newRackX, z: newRackZ, rotationY: newRotY },
        1,
        2,
        prod.physical.depth
      );
      expect(updatedDSP.position.x).toBeCloseTo(expectedWorld.x, 2);
      expect(updatedDSP.position.z).toBeCloseTo(expectedWorld.z, 2);
      expect(updatedDSP.rotationY).toBeCloseTo(newRotY, 2);

      // Cable route to DSP must have recalculated with the new rack position
      const updatedConn = state.connections[0];
      expect(updatedConn.estimatedLengthM).not.toBe(initialCableLen);
    });
  });

  describe('Rack Detachment / Room Reassignment (§1, §2)', () => {
    it('cleanly detaches rack equipment when dragged far outside the rack footprint in 3D', () => {
      const rack = state.addDefaultRack('floor');
      const ampInst: EquipmentInstance = {
        instanceId: 'amp-01',
        productId: 'generic-amplifier-4ch',
        name: 'Power Amp',
        position: { x: rack.x, y: rack.y, z: rack.z },
        rotationY: 0,
        placementMode: 'manual'
      };
      state.addEquipment(ampInst);
      state.assignEquipmentToRack('amp-01', rack.id, 2);

      expect(state.equipment.find((e) => e.instanceId === 'amp-01')!.rackId).toBe(rack.id);

      // Move amp in 3D to center of the room (far from rack)
      state.updateEquipment('amp-01', {
        position: { x: 0, y: 0.8, z: 2.5 }
      });

      const detached = state.equipment.find((e) => e.instanceId === 'amp-01')!;
      expect(detached.rackId).toBeUndefined();
      expect(detached.rackPositionRU).toBeUndefined();
      expect(detached.rackUnits).toBeUndefined();
      expect(detached.mountingKind).not.toBe('rack');
      expect(state.lastSnapNote).toContain('Detached');
    });
  });

  describe('2D Schematic Diagram Topology Preservation (§1, §28)', () => {
    it('preserves 2D schematic diagram coordinates when equipment moves in 3D space', () => {
      const displayInst: EquipmentInstance = {
        instanceId: 'disp-01',
        productId: 'generic-75-pro',
        name: 'Main Display',
        position: { x: 0, y: 1.6, z: 0.05 },
        rotationY: 0,
        wall: 'front',
        placementMode: 'manual'
      };
      state.addEquipment(displayInst);

      // Set explicit 2D schematic diagram position
      state.setSystemNodePos('disp-01', 340, 180);
      expect(state.systemLayout['disp-01']).toEqual({ x: 340, y: 180 });

      // Move display physically in 3D
      state.updateEquipment('disp-01', {
        position: { x: 2.5, y: 1.8, z: 0.05 },
        rotationY: 0.1
      });

      // 2D schematic diagram position MUST NOT be altered by 3D movement
      expect(state.systemLayout['disp-01']).toEqual({ x: 340, y: 180 });
      // But 3D physical position IS updated
      expect(state.equipment.find((e) => e.instanceId === 'disp-01')!.position.x).toBe(2.5);
    });
  });

  describe('Dynamic Design Validation & Engineering Health Reactivity (§1, §22)', () => {
    it('reacts dynamically to 3D movement: viewing distance warnings update on position change', () => {
      // Add seating at z = 3.0 (distance ~ 2.95m, within recommended 1.4 - 3.74m range)
      state.setSeats(
        [{ id: 's1', x: 0, z: 3.0, facing: Math.PI, row: 0, indexInRow: 0, hasTable: false }],
        [],
        'boardroom'
      );

      // Place a 75" display at front wall (z = 0.05)
      const displayInst: EquipmentInstance = {
        instanceId: 'disp-01',
        productId: 'generic-75-pro',
        name: 'Main Display',
        position: { x: 0, y: 1.6, z: 0.05 },
        rotationY: 0,
        wall: 'front',
        placementMode: 'manual'
      };
      state.addEquipment(displayInst);

      const findingsInitial = runDesignValidation({
        room: state.room,
        seats: state.seats,
        tables: state.tables,
        equipment: state.equipment,
        catalog,
        connections: state.connections,
        routes: state.routes,
        racks: state.racks
      });
      const viewFindingInitial = findingsInitial.findings.find((f) => f.code === 'VIEW-001')!;
      expect(viewFindingInitial.severity).toBe('pass');

      // Move seats extremely far (z = 22m) in a deep room
      const deepRoom = createDefaultRoom('conference');
      state.setRoom({
        ...deepRoom,
        width: 10,
        depth: 25,
        height: 3,
        openings: [],
        columns: []
      });
      state.updateSeat('s1', { z: 22.0 });

      // Now farthest viewer is 22m away from a 75" display -> triggers VIEW-001 error
      const findingsTooFar = runDesignValidation({
        room: state.room,
        seats: state.seats,
        tables: state.tables,
        equipment: state.equipment,
        catalog,
        connections: state.connections,
        routes: state.routes,
        racks: state.racks
      });
      const viewFindingFar = findingsTooFar.findings.find((f) => f.code === 'VIEW-001')!;
      expect(viewFindingFar.severity).toBe('error');

      // Move display closer in 3D (to z = 19.0m, distance is now ~3.0m)
      state.updateEquipment('disp-01', {
        position: { x: 0, y: 1.6, z: 19.0 }
      });

      // Issue resolves dynamically because distance is back within 1.4 - 3.74m
      const findingsCloser = runDesignValidation({
        room: state.room,
        seats: state.seats,
        tables: state.tables,
        equipment: state.equipment,
        catalog,
        connections: state.connections,
        routes: state.routes,
        racks: state.racks
      });
      const viewFindingCloser = findingsCloser.findings.find((f) => f.code === 'VIEW-001')!;
      expect(viewFindingCloser.severity).toBe('pass');
    });
  });
});
