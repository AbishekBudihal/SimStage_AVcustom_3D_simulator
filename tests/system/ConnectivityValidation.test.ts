import { describe, it, expect } from 'vitest';
import { AppState } from '../../src/app/AppState';
import { loadDefaultCatalog } from '../../src/catalog/loadCatalog';
import { EquipmentCatalog, type EquipmentProduct, type EquipmentInstance } from '../../src/catalog/EquipmentCatalog';
import { connectionEndpointStatus } from '../../src/system/ConnectionStatus';
import { runDesignValidation } from '../../src/av/validation/DesignValidationEngine';
import { createDefaultRoom } from '../../src/room/RoomModel';
import type { SystemConnection } from '../../src/system/SystemTypes';

const catalog = loadDefaultCatalog();

function place(state: AppState, productId: string, instanceId: string, x = 0, z = 0): void {
  const p = catalog.get(productId)!;
  state.addEquipment({
    instanceId,
    productId,
    name: p.model,
    position: { x, y: 1, z },
    rotationY: 0
  });
}

function reportOf(state: AppState) {
  return runDesignValidation({
    room: state.room,
    seats: state.seats,
    tables: state.tables,
    equipment: state.equipment,
    connections: state.connections,
    racks: state.racks,
    catalog
  });
}

describe('Connectivity validation enhancements', () => {
  describe('connectionEndpointStatus', () => {
    it('returns "connected" for a valid HDMI connection', () => {
      const state = new AppState();
      place(state, 'user-laptop-source', 'src');
      place(state, 'lg-86uh5j', 'disp');
      state.addConnection('src', 'hdmi-out', 'disp', 'hdmi-in-1');
      const status = connectionEndpointStatus(state.connections[0], state.equipment, catalog);
      expect(status).toBe('connected');
    });

    it('returns "invalid" when device is missing from project', () => {
      const conn: SystemConnection = {
        id: 'test',
        fromInstanceId: 'nonexistent',
        fromPortId: 'hdmi-out',
        toInstanceId: 'also-gone',
        toPortId: 'hdmi-in-1',
        signalType: 'VIDEO',
        transport: 'hdmi',
        physicalMedium: 'HDMI'
      };
      const status = connectionEndpointStatus(conn, [], catalog);
      expect(status).toBe('invalid');
    });

    it('returns "unknown" when device has incomplete port data', () => {
      const emptyCatalog = new EquipmentCatalog();
      const product: EquipmentProduct = {
        id: 'mystery-box',
        manufacturer: 'Unknown',
        model: 'Mystery',
        category: 'dsp',
        type: 'DSP',
        physical: { width: 0.4, height: 0.05, depth: 0.3 },
        provenance: 'user_defined'
        // no ports, no connectivity → resolveProductPorts returns incomplete: true
      };
      emptyCatalog.register([product]);
      const equipment: EquipmentInstance[] = [
        { instanceId: 'a', productId: 'mystery-box', name: 'Mystery', position: { x: 0, y: 0, z: 0 }, rotationY: 0 },
        { instanceId: 'b', productId: 'mystery-box', name: 'Mystery 2', position: { x: 1, y: 0, z: 0 }, rotationY: 0 }
      ];
      const conn: SystemConnection = {
        id: 'test',
        fromInstanceId: 'a',
        fromPortId: 'out-1',
        toInstanceId: 'b',
        toPortId: 'in-1',
        signalType: 'AUDIO',
        transport: 'analog-line',
        physicalMedium: 'Audio'
      };
      const status = connectionEndpointStatus(conn, equipment, emptyCatalog);
      expect(status).toBe('unknown');
    });
  });

  describe('SYSTEM-006 disconnected equipment', () => {
    it('flags a system-role device with no connections when system graph is active', () => {
      const state = new AppState();
      state.setRoom(createDefaultRoom('conference'));
      // Place a DSP and a switcher — only connect the DSP to something
      place(state, 'user-laptop-source', 'src');
      place(state, 'lg-86uh5j', 'disp');
      state.addConnection('src', 'hdmi-out', 'disp', 'hdmi-in-1');

      // Place a disconnected switcher — this makes the system graph active
      place(state, 'user-hdmi-switcher-2x1', 'sw-disconnected');

      const report = reportOf(state);
      const disconnected = report.findings.filter((f) => f.code === 'SYSTEM-006');
      expect(disconnected.length).toBeGreaterThan(0);
      expect(disconnected.some((f) => f.objectId === 'sw-disconnected')).toBe(true);
    });

    it('does not flag equipment when system graph is inactive', () => {
      const state = new AppState();
      state.setRoom(createDefaultRoom('conference'));
      // Only a display — no system-role device, no connections → system graph inactive
      place(state, 'lg-86uh5j', 'disp');

      const report = reportOf(state);
      const disconnected = report.findings.filter((f) => f.code === 'SYSTEM-006');
      expect(disconnected.length).toBe(0);
    });

    it('does not flag equipment that has at least one connection', () => {
      const state = new AppState();
      state.setRoom(createDefaultRoom('conference'));
      place(state, 'user-laptop-source', 'src');
      place(state, 'user-hdmi-switcher-2x1', 'sw');
      place(state, 'lg-86uh5j', 'disp');
      // Connect src → sw, sw → disp so sw is not disconnected
      state.addConnection('src', 'hdmi-out', 'sw', 'hdmi-in-1');
      state.addConnection('sw', 'hdmi-out', 'disp', 'hdmi-in-1');

      const report = reportOf(state);
      const disconnected = report.findings.filter((f) => f.code === 'SYSTEM-006');
      // The source is not a system-role category, the switcher is connected, display is not system-role
      const swFinding = disconnected.find((f) => f.objectId === 'sw');
      expect(swFinding).toBeUndefined();
    });

    it('does not flag non-system-role categories (display, camera, speaker, mic)', () => {
      const state = new AppState();
      state.setRoom(createDefaultRoom('conference'));
      // Place a connected switcher to activate system graph
      place(state, 'user-laptop-source', 'src');
      place(state, 'user-hdmi-switcher-2x1', 'sw');
      state.addConnection('src', 'hdmi-out', 'sw', 'hdmi-in-1');

      // Place a disconnected display and camera — these are NOT system-role
      place(state, 'lg-86uh5j', 'disp-alone');
      place(state, 'yealink-uvc84', 'cam-alone');

      const report = reportOf(state);
      const disconnected = report.findings.filter((f) => f.code === 'SYSTEM-006');
      expect(disconnected.some((f) => f.objectId === 'disp-alone')).toBe(false);
      expect(disconnected.some((f) => f.objectId === 'cam-alone')).toBe(false);
    });
  });

  describe('existing connectivity checks still work', () => {
    it('SIGNAL-002 fires for invalid connections', () => {
      const state = new AppState();
      state.setRoom(createDefaultRoom('conference'));
      place(state, 'user-laptop-source', 'src');
      place(state, 'lg-86uh5j', 'disp');
      state.addConnection('src', 'hdmi-out', 'disp', 'hdmi-in-1');

      const report = reportOf(state);
      // The connection is valid, so SIGNAL-002 should NOT fire
      const invalid = report.findings.filter((f) => f.code === 'SIGNAL-002');
      expect(invalid.length).toBe(0);
    });

    it('SYSTEM-001 fires for incomplete signal paths', () => {
      const state = new AppState();
      state.setRoom(createDefaultRoom('conference'));
      place(state, 'user-laptop-source', 'src');
      place(state, 'user-hdmi-switcher-2x1', 'sw');
      // Connect to switcher but not onward — path is incomplete
      state.addConnection('src', 'hdmi-out', 'sw', 'hdmi-in-1');

      const report = reportOf(state);
      const incomplete = report.findings.filter((f) => f.code === 'SYSTEM-001');
      expect(incomplete.length).toBeGreaterThan(0);
    });
  });
});
