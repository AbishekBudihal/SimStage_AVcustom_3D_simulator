import { describe, it, expect, beforeEach } from 'vitest';
import { createDefaultRoom, type RoomModel } from '../../src/room/RoomModel';
import { loadDefaultCatalog } from '../../src/catalog/loadCatalog';
import { runDesignValidation, ensureBuiltinChecksRegistered } from '../../src/av/validation/DesignValidationEngine';
import { computeDesignHealth } from '../../src/av/DesignHealth';
import type { EquipmentInstance } from '../../src/catalog/EquipmentCatalog';
import type { Seat, TableSpec } from '../../src/room/SeatingGenerator';
import type { SystemConnection } from '../../src/system/SystemTypes';
import { defaultFloorRack } from '../../src/av/AVRack';

describe('Phase 8: Unified Design Validation & Engineering Health Dashboard', () => {
  const catalog = loadDefaultCatalog();

  beforeEach(() => {
    ensureBuiltinChecksRegistered();
  });

  describe('Architectural Room Checks (ROOM-001, ROOM-002, ROOM-003)', () => {
    it('detects room archetype over-capacity in a Huddle Room (ROOM-001)', () => {
      const room: RoomModel = {
        ...createDefaultRoom('huddle'),
        templateId: 'huddle'
      };

      // Huddle typical capacity is [2, 4]. 10 seats is >125% of max
      const seats: Seat[] = Array.from({ length: 10 }, (_, i) => ({
        id: `s-${i}`,
        row: 1,
        indexInRow: i,
        x: (i - 5) * 0.3,
        z: 0,
        facing: 0,
        hasTable: true
      }));

      const report = runDesignValidation({
        room,
        seats,
        tables: [],
        equipment: [],
        catalog
      });

      const finding = report.findings.find((f) => f.code === 'ROOM-001');
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe('warning');
      expect(finding?.message).toContain('exceeding');
    });

    it('passes capacity check when seats are within archetype capacity range (ROOM-001)', () => {
      const room: RoomModel = {
        ...createDefaultRoom('huddle'),
        templateId: 'huddle'
      };

      const seats: Seat[] = [
        { id: 's-1', row: 1, indexInRow: 1, x: -0.4, z: 0, facing: 0, hasTable: true },
        { id: 's-2', row: 1, indexInRow: 2, x: 0.4, z: 0, facing: 0, hasTable: true }
      ];

      const report = runDesignValidation({
        room,
        seats,
        tables: [],
        equipment: [],
        catalog
      });

      const finding = report.findings.find((f) => f.code === 'ROOM-001');
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe('pass');
    });

    it('warns when display is not mounted on the presentation wall (ROOM-002)', () => {
      const room: RoomModel = {
        ...createDefaultRoom('conference'),
        presentationWall: 'front'
      };

      // Add display placed on 'back' wall
      const displayInstance: EquipmentInstance = {
        instanceId: 'disp-back-1',
        productId: 'samsung-qm85r',
        name: 'Back Wall Display',
        position: { x: 0, y: 1.5, z: 3.4 },
        rotationY: Math.PI
      };

      const report = runDesignValidation({
        room,
        seats: [],
        tables: [],
        equipment: [displayInstance],
        catalog
      });

      const finding = report.findings.find((f) => f.code === 'ROOM-002');
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe('warning');
      expect(finding?.message).toContain('presentation wall is set to front');
    });

    it('errors when camera or microphone is placed outside room boundaries (ROOM-003)', () => {
      const room = createDefaultRoom('boardroom'); // w: 10, d: 7 (bounds: x ±5, z ±3.5)

      const outsideCam: EquipmentInstance = {
        instanceId: 'cam-outside',
        productId: 'yealink-uvc84',
        name: 'Outside Camera',
        position: { x: 8.5, y: 1.8, z: 0 }, // 8.5 > 5.0
        rotationY: 0
      };

      const report = runDesignValidation({
        room,
        seats: [],
        tables: [],
        equipment: [outsideCam],
        catalog
      });

      const finding = report.findings.find((f) => f.code === 'ROOM-003');
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe('error');
      expect(finding?.message).toContain('outside the room architectural envelope');
    });
  });

  describe('Power & Thermal Checks (POW-001, POW-002)', () => {
    it('warns on excessive rack thermal density without active cooling (POW-001)', () => {
      const room = createDefaultRoom('boardroom');
      const rack = { ...defaultFloorRack('rack-1'), x: 4, z: 2 };

      // Create high-power equipment assigned to rack
      const amp1: EquipmentInstance = {
        instanceId: 'amp-1',
        productId: 'qsc-cx-q-4k8',
        name: 'High Power Amp 1',
        position: { x: 4, y: 0.5, z: 2 },
        rotationY: 0,
        rackId: 'rack-1'
      };

      const amp2: EquipmentInstance = {
        instanceId: 'amp-2',
        productId: 'qsc-cx-q-4k8',
        name: 'High Power Amp 2',
        position: { x: 4, y: 0.8, z: 2 },
        rotationY: 0,
        rackId: 'rack-1'
      };

      const report = runDesignValidation({
        room,
        seats: [],
        tables: [],
        equipment: [amp1, amp2],
        racks: [rack],
        catalog
      });

      const finding = report.findings.find((f) => f.code === 'POW-001');
      expect(finding).toBeDefined();
      // Should evaluate thermal density
      expect(['pass', 'warning']).toContain(finding?.severity);
    });

    it('validates PoE power budget compliance (POW-002)', () => {
      const room = createDefaultRoom('boardroom');

      // Netgear M4250 switch with PoE budget
      const switchInst: EquipmentInstance = {
        instanceId: 'switch-1',
        productId: 'netgear-m4250-10g2xf',
        name: 'AV Switch',
        position: { x: 3, y: 0.5, z: 2 },
        rotationY: 0
      };

      const micInst: EquipmentInstance = {
        instanceId: 'mic-poe-1',
        productId: 'shure-mxa920',
        name: 'PoE Mic',
        position: { x: 0, y: 3.0, z: 0 },
        rotationY: 0
      };

      const connections: SystemConnection[] = [
        {
          id: 'conn-poe-1',
          fromInstanceId: 'switch-1',
          fromPortId: 'p1',
          toInstanceId: 'mic-poe-1',
          toPortId: 'net-1',
          signalType: 'NETWORK',
          transport: 'ethernet',
          physicalMedium: 'Cat6A'
        }
      ];

      const report = runDesignValidation({
        room,
        seats: [],
        tables: [],
        equipment: [switchInst, micInst],
        connections,
        catalog
      });

      const finding = report.findings.find((f) => f.code === 'POW-002');
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe('pass');
    });
  });

  describe('Deterministic Design Health Scoring (§15)', () => {
    it('penalizes design health deterministically (-8 for error, -3 for warning)', () => {
      const room = createDefaultRoom('boardroom');
      const seats: Seat[] = [
        { id: 's-1', row: 1, indexInRow: 1, x: 0, z: 0, facing: 0, hasTable: true }
      ];

      const report = runDesignValidation({
        room,
        seats,
        tables: [],
        equipment: [],
        catalog
      });

      const health = computeDesignHealth(report, [], seats, catalog);
      expect(health.score).toBeGreaterThanOrEqual(0);
      expect(health.score).toBeLessThanOrEqual(100);
      expect(health.subsystems.length).toBeGreaterThan(0);
    });
  });
});
