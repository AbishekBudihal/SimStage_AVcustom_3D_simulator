import { describe, it, expect } from 'vitest';
import { AppState } from '../../src/app/AppState';
import { loadDefaultCatalog } from '../../src/catalog/loadCatalog';
import { EquipmentCatalog, type EquipmentProduct, type EquipmentInstance } from '../../src/catalog/EquipmentCatalog';
import { defaultFloorRack, defaultWallRack, usedRackUnits } from '../../src/av/AVRack';
import { rackElevation, rackPowerSummary } from '../../src/av/RackSchedule';
import { occupiedRuRanges } from '../../src/av/validation/rackChecks';
import { runDesignValidation } from '../../src/av/validation/DesignValidationEngine';
import { createDefaultRoom } from '../../src/room/RoomModel';

const catalog = loadDefaultCatalog();

function inst(partial: Partial<EquipmentInstance> & Pick<EquipmentInstance, 'instanceId'>): EquipmentInstance {
  return {
    productId: 'none',
    name: partial.name ?? partial.instanceId,
    position: { x: 0, y: 0, z: 0 },
    rotationY: 0,
    ...partial
  };
}

describe('Rack engineering', () => {
  describe('RU overlap detection', () => {
    it('detects overlapping devices at same RU position', () => {
      const rack = defaultFloorRack();
      const equipment = [
        inst({ instanceId: 'a', name: 'Device A', rackId: rack.id, rackPositionRU: 1, rackUnits: 2 }),
        inst({ instanceId: 'b', name: 'Device B', rackId: rack.id, rackPositionRU: 2, rackUnits: 1 })
      ];
      const ranges = occupiedRuRanges(equipment, rack.id);
      expect(ranges.length).toBe(2);
      // A occupies 1-2, B occupies 2 — overlap at U2
      expect(ranges[0].startRU).toBe(1);
      expect(ranges[0].endRU).toBe(2);
      expect(ranges[1].startRU).toBe(2);
      expect(ranges[1].endRU).toBe(2);
    });

    it('RACK-004 fires for overlapping RU positions', () => {
      const rack = defaultFloorRack();
      const report = runDesignValidation({
        room: { ...createDefaultRoom('conference'), openings: [], columns: [] },
        seats: [],
        tables: [],
        racks: [rack],
        equipment: [
          inst({ instanceId: 'x', name: 'DSP', rackId: rack.id, rackPositionRU: 5, rackUnits: 2 }),
          inst({ instanceId: 'y', name: 'Switch', rackId: rack.id, rackPositionRU: 6, rackUnits: 1 })
        ],
        catalog: new EquipmentCatalog()
      });
      expect(report.findings.some((f) => f.code === 'RACK-004' && f.severity === 'error')).toBe(true);
    });

    it('RACK-004 does not fire for non-overlapping devices', () => {
      const rack = defaultFloorRack();
      const report = runDesignValidation({
        room: { ...createDefaultRoom('conference'), openings: [], columns: [] },
        seats: [],
        tables: [],
        racks: [rack],
        equipment: [
          inst({ instanceId: 'x', name: 'DSP', rackId: rack.id, rackPositionRU: 1, rackUnits: 2 }),
          inst({ instanceId: 'y', name: 'Switch', rackId: rack.id, rackPositionRU: 3, rackUnits: 1 })
        ],
        catalog: new EquipmentCatalog()
      });
      expect(report.findings.filter((f) => f.code === 'RACK-004').length).toBe(0);
    });
  });

  describe('RU position assignment', () => {
    it('assigns non-overlapping positions automatically', () => {
      const state = new AppState();
      state.setRoom(createDefaultRoom('conference'));
      const rack = defaultFloorRack();
      state.setRacks([rack]);

      state.addEquipment(inst({ instanceId: 'a', productId: 'none', name: 'A' }));
      state.assignEquipmentToRack('a', rack.id, 2);
      expect(state.equipment[0].rackPositionRU).toBe(1);
      expect(state.equipment[0].rackUnits).toBe(2);

      state.addEquipment(inst({ instanceId: 'b', productId: 'none', name: 'B' }));
      state.assignEquipmentToRack('b', rack.id, 1);
      // Should be placed at RU 3 (after A which occupies 1-2)
      expect(state.equipment[1].rackPositionRU).toBe(3);
    });
  });

  describe('Rack elevation', () => {
    it('generates correct slot map', () => {
      const rack = defaultFloorRack();
      const equipment = [
        inst({ instanceId: 'dsp', name: 'DSP-01', rackId: rack.id, rackPositionRU: 1, rackUnits: 2 })
      ];
      const elev = rackElevation(rack, equipment, new EquipmentCatalog());
      expect(elev.ruTotal).toBe(42);
      expect(elev.usedRU).toBe(2);
      expect(elev.freeRU).toBe(40);
      expect(elev.utilizationPct).toBe(Math.round((2 / 42) * 100));
      expect(elev.slots.length).toBe(42);
      expect(elev.slots[0].status).toBe('occupied');
      expect(elev.slots[0].equipmentName).toBe('DSP-01');
      expect(elev.slots[0].deviceStart).toBe(true);
      expect(elev.slots[1].status).toBe('occupied');
      expect(elev.slots[1].deviceStart).toBe(false);
      expect(elev.slots[2].status).toBe('free');
    });

    it('marks incomplete when device has no RU data', () => {
      const rack = defaultFloorRack();
      const equipment = [
        inst({ instanceId: 'mystery', rackId: rack.id })
      ];
      const elev = rackElevation(rack, equipment, new EquipmentCatalog());
      expect(elev.incomplete).toBe(true);
      expect(elev.assignments.length).toBe(0);
    });

    it('returns assignments sorted by RU position', () => {
      const rack = defaultFloorRack();
      const equipment = [
        inst({ instanceId: 'a', name: 'A', rackId: rack.id, rackPositionRU: 5, rackUnits: 1 }),
        inst({ instanceId: 'b', name: 'B', rackId: rack.id, rackPositionRU: 1, rackUnits: 2 })
      ];
      const elev = rackElevation(rack, equipment, new EquipmentCatalog());
      expect(elev.assignments.length).toBe(2);
    });
  });

  describe('Rack power summary', () => {
    it('sums known power and flags unknowns', () => {
      const testCatalog = new EquipmentCatalog();
      const dspProduct: EquipmentProduct = {
        id: 'test-dsp',
        manufacturer: 'Test',
        model: 'DSP',
        category: 'dsp',
        type: 'DSP',
        physical: { width: 0.48, height: 0.044, depth: 0.3, powerWatts: 35 },
        provenance: 'verified',
        rackUnits: 1
      };
      const unknownProduct: EquipmentProduct = {
        id: 'test-unknown',
        manufacturer: 'Test',
        model: 'Unknown',
        category: 'control',
        type: 'controller',
        physical: { width: 0.48, height: 0.044, depth: 0.3 },
        provenance: 'estimated',
        rackUnits: 1
      };
      testCatalog.register([dspProduct, unknownProduct]);

      const rack = defaultFloorRack();
      const equipment: EquipmentInstance[] = [
        inst({ instanceId: 'dsp1', productId: 'test-dsp', name: 'DSP', rackId: rack.id, rackPositionRU: 1, rackUnits: 1 }),
        inst({ instanceId: 'ctrl', productId: 'test-unknown', name: 'Controller', rackId: rack.id, rackPositionRU: 2, rackUnits: 1 })
      ];
      const power = rackPowerSummary(rack, equipment, testCatalog);
      expect(power.totalKnownWatts).toBe(35);
      expect(power.unknownCount).toBe(1);
      expect(power.complete).toBe(false);
      expect(power.lines.length).toBe(2);
    });

    it('reports complete when all devices have power data', () => {
      const testCatalog = new EquipmentCatalog();
      testCatalog.register([{
        id: 'test-switch',
        manufacturer: 'Test',
        model: 'Switch',
        category: 'network',
        type: 'switch',
        physical: { width: 0.48, height: 0.044, depth: 0.3, powerWatts: 75 },
        provenance: 'verified',
        rackUnits: 1
      }]);
      const rack = defaultFloorRack();
      const equipment: EquipmentInstance[] = [
        inst({ instanceId: 'sw1', productId: 'test-switch', name: 'Switch', rackId: rack.id, rackPositionRU: 1, rackUnits: 1 })
      ];
      const power = rackPowerSummary(rack, equipment, testCatalog);
      expect(power.totalKnownWatts).toBe(75);
      expect(power.unknownCount).toBe(0);
      expect(power.complete).toBe(true);
    });

    it('returns empty summary for rack with no equipment', () => {
      const rack = defaultFloorRack();
      const power = rackPowerSummary(rack, [], new EquipmentCatalog());
      expect(power.totalKnownWatts).toBe(0);
      expect(power.lines.length).toBe(0);
      expect(power.complete).toBe(false);
    });
  });
});
