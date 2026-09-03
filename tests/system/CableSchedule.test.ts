import { describe, it, expect } from 'vitest';
import { AppState } from '../../src/app/AppState';
import { loadDefaultCatalog } from '../../src/catalog/loadCatalog';
import { cableSchedule } from '../../src/system/CableSchedule';
import { cableRouteContext } from '../../src/system/cableContext';
import { createDefaultRoom } from '../../src/room/RoomModel';

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

describe('Cable schedule', () => {
  it('returns empty schedule when no connections exist', () => {
    const state = new AppState();
    state.setRoom(createDefaultRoom('conference'));
    const ctx = cableRouteContext(state, catalog);
    const result = cableSchedule(state.connections, state.equipment, ctx);
    expect(result.rows.length).toBe(0);
    expect(result.summary.totalConnections).toBe(0);
  });

  it('generates rows matching number of connections', () => {
    const state = new AppState();
    state.setRoom(createDefaultRoom('conference'));
    place(state, 'user-laptop-source', 'src', -2, 0);
    place(state, 'lg-86uh5j', 'disp', 2, -3);
    state.addConnection('src', 'hdmi-out', 'disp', 'hdmi-in-1');

    const ctx = cableRouteContext(state, catalog);
    const result = cableSchedule(state.connections, state.equipment, ctx);
    expect(result.rows.length).toBe(1);
    expect(result.summary.totalConnections).toBe(1);
  });

  it('populates row fields from connection data', () => {
    const state = new AppState();
    state.setRoom(createDefaultRoom('conference'));
    place(state, 'user-laptop-source', 'src', -2, 0);
    place(state, 'lg-86uh5j', 'disp', 2, -3);
    state.addConnection('src', 'hdmi-out', 'disp', 'hdmi-in-1');

    const ctx = cableRouteContext(state, catalog);
    const result = cableSchedule(state.connections, state.equipment, ctx);
    const row = result.rows[0];
    expect(row.fromInstanceId).toBe('src');
    expect(row.toInstanceId).toBe('disp');
    expect(row.signalType).toBe('VIDEO');
    expect(row.cableType).toBe('HDMI');
    expect(row.estimatedLengthM).toBeGreaterThan(0);
  });

  it('groups cable summary by type', () => {
    const state = new AppState();
    state.setRoom(createDefaultRoom('conference'));
    place(state, 'user-laptop-source', 'src', -2, 0);
    place(state, 'user-hdmi-switcher-2x1', 'sw', 0, 0);
    place(state, 'lg-86uh5j', 'disp', 2, -3);
    state.addConnection('src', 'hdmi-out', 'sw', 'hdmi-in-1');
    state.addConnection('sw', 'hdmi-out', 'disp', 'hdmi-in-1');

    const ctx = cableRouteContext(state, catalog);
    const result = cableSchedule(state.connections, state.equipment, ctx);
    expect(result.rows.length).toBe(2);
    // Both are HDMI, so one type group
    expect(result.summary.byType.length).toBe(1);
    expect(result.summary.byType[0].cableType).toBe('HDMI');
    expect(result.summary.byType[0].count).toBe(2);
  });

  it('includes total estimated length across all cables', () => {
    const state = new AppState();
    state.setRoom(createDefaultRoom('conference'));
    place(state, 'user-laptop-source', 'src', -3, 0);
    place(state, 'lg-86uh5j', 'disp', 3, -4);
    state.addConnection('src', 'hdmi-out', 'disp', 'hdmi-in-1');

    const ctx = cableRouteContext(state, catalog);
    const result = cableSchedule(state.connections, state.equipment, ctx);
    expect(result.summary.totalEstimatedLengthM).toBeGreaterThan(0);
    expect(result.summary.totalEstimatedLengthM).toBe(result.rows[0].estimatedLengthM);
  });

  it('reflects route status (clear, obstacle, no-room)', () => {
    const state = new AppState();
    state.setRoom(createDefaultRoom('conference'));
    place(state, 'user-laptop-source', 'src', -1, 0);
    place(state, 'lg-86uh5j', 'disp', 1, 0);
    state.addConnection('src', 'hdmi-out', 'disp', 'hdmi-in-1');

    const ctx = cableRouteContext(state, catalog);
    const result = cableSchedule(state.connections, state.equipment, ctx);
    expect(['clear', 'intersects-obstacle', 'no-room']).toContain(result.rows[0].routeStatus);
  });
});
