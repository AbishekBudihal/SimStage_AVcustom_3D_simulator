import { describe, it, expect, beforeEach } from 'vitest';
import { AppState } from '../../src/app/AppState';
import { loadDefaultCatalog } from '../../src/catalog/loadCatalog';
import type { EquipmentInstance } from '../../src/catalog/EquipmentCatalog';
import {
  computeDesignHealth,
  generateClickToFix,
  ERROR_PENALTY,
  WARNING_PENALTY
} from '../../src/av/DesignHealth';
import type { ValidationReport, ValidationFinding } from '../../src/av/validation/ValidationTypes';

function mockFinding(p: Partial<ValidationFinding> & Pick<ValidationFinding, 'id' | 'code' | 'severity' | 'category' | 'title' | 'message'>): ValidationFinding {
  return {
    affectedObjects: [],
    recommendedActions: [],
    potentialVariables: [],
    explanation: p.message,
    source: 'test',
    ...p
  };
}

describe('Phase 13: Deterministic Design Health HUD & Click-to-Fix', () => {
  const catalog = loadDefaultCatalog();
  let state: AppState;

  beforeEach(() => {
    state = new AppState();
  });

  describe('Deterministic Scoring Arithmetic', () => {
    it('calculates score with base 100 and precise penalties (-8 error, -3 warning)', () => {
      const mockReport: ValidationReport = {
        summary: {
          designStatus: 'attention',
          checksPerformed: 5,
          passCount: 2,
          infoCount: 0,
          warningCount: 2,
          errorCount: 1
        },
        generatedFromSignature: '',
        findings: [
          mockFinding({
            id: 'f1',
            code: 'RACK-001',
            severity: 'error',
            category: 'rack',
            title: 'Unmounted rack gear',
            message: 'Gear needs a rack',
            affectedObjects: [{ kind: 'equipment', id: 'eq1', label: 'DSP-1' }]
          }),
          mockFinding({
            id: 'f2',
            code: 'DISP-001',
            severity: 'warning',
            category: 'display',
            title: 'Display slightly small',
            message: 'Viewing distance is marginal',
            affectedObjects: [{ kind: 'equipment', id: 'eq2', label: 'Display 55' }]
          }),
          mockFinding({
            id: 'f3',
            code: 'AUDIO-001',
            severity: 'warning',
            category: 'audio',
            title: 'SPL boundary',
            message: 'Marginal speaker coverage',
            affectedObjects: []
          }),
          mockFinding({
            id: 'f4',
            code: 'CAM-001',
            severity: 'pass',
            category: 'camera',
            title: 'Camera coverage good',
            message: 'Passes check',
            affectedObjects: []
          })
        ]
      };

      const health = computeDesignHealth(mockReport, [], [], catalog);

      // 100 - (1 * 8) - (2 * 3) = 100 - 8 - 6 = 86
      expect(health.score).toBe(86);
      expect(health.deductions.length).toBe(3);
      expect(health.totalErrors).toBe(1);
      expect(health.totalWarnings).toBe(2);
      expect(health.totalPasses).toBe(2);

      const errDed = health.deductions.find((d) => d.code === 'RACK-001');
      expect(errDed?.penalty).toBe(ERROR_PENALTY);

      const warnDed = health.deductions.find((d) => d.code === 'DISP-001');
      expect(warnDed?.penalty).toBe(WARNING_PENALTY);
    });

    it('clamps health score between 0 and 100', () => {
      const manyErrors: ValidationFinding[] = Array.from({ length: 20 }, (_, i) => mockFinding({
        id: `err-${i}`,
        code: `ERR-${i}`,
        severity: 'error' as const,
        category: 'system' as const,
        title: `Fatal ${i}`,
        message: 'System critical error',
        affectedObjects: []
      }));

      const mockReport: ValidationReport = {
        summary: {
          designStatus: 'attention',
          checksPerformed: 20,
          passCount: 0,
          infoCount: 0,
          warningCount: 0,
          errorCount: 20
        },
        generatedFromSignature: '',
        findings: manyErrors
      };

      const health = computeDesignHealth(mockReport, [], [], catalog);
      // 100 - (20 * 8) = -60 -> clamped to 0
      expect(health.score).toBe(0);
    });
  });

  describe('Deterministic Click-to-Fix Generation', () => {
    it('generates add_rack fix when rack-mountable gear is unmounted and no rack exists', () => {
      const finding = mockFinding({
        id: 'rack-find-1',
        code: 'RACK-NO-RACK',
        severity: 'error',
        category: 'rack',
        title: 'Rack mountable gear outside rack',
        message: 'DSP requires rack enclosure',
        affectedObjects: [{ kind: 'equipment', id: 'dsp-1', label: 'Biamp Tesira' }]
      });

      const fix = generateClickToFix(finding, catalog);
      expect(fix).toBeDefined();
      expect(fix?.kind).toBe('add_rack');
      expect(fix?.targetEntityId).toBe('dsp-1');
      expect(fix?.label).toContain('Add Rack');
    });

    it('generates resize_display fix for small display finding', () => {
      const finding = mockFinding({
        id: 'disp-find-1',
        code: 'DISP-UNDERSIZED',
        severity: 'warning',
        category: 'display',
        title: 'Display undersized for room length',
        message: 'Display diagonal is too small for farthest seating distance',
        affectedObjects: [{ kind: 'equipment', id: 'disp-1', label: 'Small Display' }]
      });

      const fix = generateClickToFix(finding, catalog);
      expect(fix).toBeDefined();
      expect(fix?.kind).toBe('resize_display');
      expect(fix?.targetEntityId).toBe('disp-1');
    });
  });

  describe('AppState Click-to-Fix Execution & Reactivity', () => {
    it('applies add_rack fix to spawn rack and assign equipment', () => {
      const dspInstance: EquipmentInstance = {
        instanceId: 'dsp-1',
        productId: 'user-hdmi-switcher-2x1',
        name: 'HDMI Switcher',
        position: { x: 0, y: 1, z: 0 },
        rotationY: 0,
        mountingKind: 'rack',
        rackUnits: 1
      };

      state.addEquipment(dspInstance);
      expect(state.equipment.length).toBe(1);
      expect(state.racks.length).toBe(0);
      expect(state.equipment[0].rackId).toBeUndefined();

      // Perform Click-to-Fix: add_rack
      const success = state.applyClickToFix({
        id: 'fix-add-rack-1',
        findingId: 'f-rack-1',
        actionKind: 'add_rack',
        kind: 'add_rack',
        label: 'Add Floor Rack',
        description: 'Auto add rack and mount',
        targetEntityId: dspInstance.instanceId,
        params: { rackKind: 'floor', totalRU: 24 }
      });

      expect(success).toBe(true);
      expect(state.racks.length).toBe(1);
      const rack = state.racks[0];
      expect(rack.totalRU).toBe(24);

      // Verify the DSP is now assigned to the newly created rack
      const updatedDsp = state.equipment.find((e) => e.instanceId === dspInstance.instanceId);
      expect(updatedDsp?.rackId).toBe(rack.id);
      expect(updatedDsp?.rackPositionRU).toBeDefined();
    });

    it('applies assign_rack fix when rack already exists', () => {
      const rack = state.addDefaultRack('floor', 24);
      expect(state.racks.length).toBe(1);

      const dspInstance: EquipmentInstance = {
        instanceId: 'dsp-2',
        productId: 'user-hdmi-switcher-2x1',
        name: 'HDMI Switcher',
        position: { x: 0, y: 1, z: 0 },
        rotationY: 0,
        mountingKind: 'rack',
        rackUnits: 1
      };
      state.addEquipment(dspInstance);
      expect(state.equipment[0].rackId).toBeUndefined();

      const success = state.applyClickToFix({
        id: 'fix-assign-1',
        findingId: 'f-assign-1',
        actionKind: 'assign_rack',
        kind: 'assign_rack',
        label: 'Assign to Rack',
        description: 'Mount into rack',
        targetEntityId: dspInstance.instanceId,
        params: { rackId: rack.id }
      });

      expect(success).toBe(true);
      const updatedDsp = state.equipment.find((e) => e.instanceId === dspInstance.instanceId);
      expect(updatedDsp?.rackId).toBe(rack.id);
      expect(updatedDsp?.rackPositionRU).toBe(1);
    });

    it('supports undo and redo for Click-to-Fix operations', () => {
      const dspInstance: EquipmentInstance = {
        instanceId: 'dsp-3',
        productId: 'user-hdmi-switcher-2x1',
        name: 'HDMI Switcher',
        position: { x: 0, y: 1, z: 0 },
        rotationY: 0,
        mountingKind: 'rack',
        rackUnits: 1
      };
      state.addEquipment(dspInstance);

      state.applyClickToFix({
        id: 'fix-undo-test',
        findingId: 'f-undo',
        actionKind: 'add_rack',
        kind: 'add_rack',
        label: 'Add Rack',
        description: 'Add and mount',
        targetEntityId: dspInstance.instanceId
      });

      expect(state.racks.length).toBe(1);
      expect(state.equipment[0].rackId).toBe(state.racks[0].id);

      // Undo
      state.undo();
      expect(state.racks.length).toBe(0);
      expect(state.equipment[0].rackId).toBeUndefined();

      // Redo
      state.redo();
      expect(state.racks.length).toBe(1);
      expect(state.equipment[0].rackId).toBe(state.racks[0].id);
    });

    it('toggles HUD open state', () => {
      expect(state.healthHudOpen).toBe(false);
      state.toggleHealthHud();
      expect(state.healthHudOpen).toBe(true);
      state.setHealthHudOpen(false);
      expect(state.healthHudOpen).toBe(false);
    });
  });
});
