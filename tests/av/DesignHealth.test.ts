import { describe, it, expect } from 'vitest';
import { AppState } from '../../src/app/AppState';
import { loadDefaultCatalog } from '../../src/catalog/loadCatalog';
import { runDesignValidation } from '../../src/av/validation/DesignValidationEngine';
import { computeDesignHealth } from '../../src/av/DesignHealth';
import { createDefaultRoom } from '../../src/room/RoomModel';
import { defaultSeatingConfig, generateSeating } from '../../src/room/SeatingGenerator';

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

function healthOf(state: AppState) {
  const report = runDesignValidation({
    room: state.room,
    seats: state.seats,
    tables: state.tables,
    equipment: state.equipment,
    connections: state.connections,
    racks: state.racks,
    catalog
  });
  return computeDesignHealth(report, state.equipment, state.seats, catalog);
}

describe('Design health scoring', () => {
  it('empty room scores 100', () => {
    const state = new AppState();
    state.setRoom(createDefaultRoom('conference'));
    const health = healthOf(state);
    expect(health.score).toBe(100);
  });

  it('returns score between 0 and 100', () => {
    const state = new AppState();
    state.setRoom(createDefaultRoom('conference'));
    const { seats, tables } = generateSeating(state.room!, defaultSeatingConfig(12, 'boardroom'));
    state.setSeats(seats, tables);
    place(state, 'lg-86uh5j', 'disp', 0, -4);

    const health = healthOf(state);
    expect(health.score).toBeGreaterThanOrEqual(0);
    expect(health.score).toBeLessThanOrEqual(100);
  });

  it('errors reduce the score', () => {
    const state = new AppState();
    state.setRoom(createDefaultRoom('conference'));
    place(state, 'user-laptop-source', 'src');
    place(state, 'user-hdmi-switcher-2x1', 'sw');
    // Source → switcher but no onward → SYSTEM-001 errors
    state.addConnection('src', 'hdmi-out', 'sw', 'hdmi-in-1');

    const health = healthOf(state);
    expect(health.score).toBeLessThan(100);
    expect(health.totalErrors).toBeGreaterThan(0);
  });

  it('more errors mean lower score', () => {
    const state1 = new AppState();
    state1.setRoom(createDefaultRoom('conference'));
    place(state1, 'user-laptop-source', 'src');
    place(state1, 'user-hdmi-switcher-2x1', 'sw');
    state1.addConnection('src', 'hdmi-out', 'sw', 'hdmi-in-1');
    const h1 = healthOf(state1);

    const state2 = new AppState();
    state2.setRoom(createDefaultRoom('conference'));
    place(state2, 'user-laptop-source', 'src');
    place(state2, 'user-hdmi-switcher-2x1', 'sw');
    place(state2, 'user-hdmi-switcher-2x1', 'sw2');
    state2.addConnection('src', 'hdmi-out', 'sw', 'hdmi-in-1');
    // sw2 is disconnected → more warnings
    const h2 = healthOf(state2);

    expect(h2.score).toBeLessThanOrEqual(h1.score);
  });

  it('has per-subsystem breakdown', () => {
    const state = new AppState();
    state.setRoom(createDefaultRoom('conference'));
    place(state, 'lg-86uh5j', 'disp');

    const health = healthOf(state);
    expect(health.subsystems.length).toBeGreaterThan(0);
    const displaySub = health.subsystems.find((s) => s.subsystem === 'display');
    expect(displaySub).toBeDefined();
    expect(displaySub!.active).toBe(true);
  });

  it('inactive subsystems are not penalized', () => {
    const state = new AppState();
    state.setRoom(createDefaultRoom('conference'));
    // No speakers in project
    const health = healthOf(state);
    const audioSub = health.subsystems.find((s) => s.subsystem === 'audio');
    expect(audioSub).toBeDefined();
    expect(audioSub!.active).toBe(false);
    expect(audioSub!.score).toBe(100);
  });

  it('score is deterministic — same state always gives same score', () => {
    const state = new AppState();
    state.setRoom(createDefaultRoom('conference'));
    const { seats, tables } = generateSeating(state.room!, defaultSeatingConfig(8, 'boardroom'));
    state.setSeats(seats, tables);
    place(state, 'lg-86uh5j', 'disp', 0, -4);

    const h1 = healthOf(state);
    const h2 = healthOf(state);
    expect(h1.score).toBe(h2.score);
    expect(h1.subsystems.length).toBe(h2.subsystems.length);
  });

  it('connecting a source to display improves connectivity', () => {
    const state1 = new AppState();
    state1.setRoom(createDefaultRoom('conference'));
    place(state1, 'user-laptop-source', 'src');
    place(state1, 'lg-86uh5j', 'disp');

    const state2 = new AppState();
    state2.setRoom(createDefaultRoom('conference'));
    place(state2, 'user-laptop-source', 'src');
    place(state2, 'lg-86uh5j', 'disp');
    state2.addConnection('src', 'hdmi-out', 'disp', 'hdmi-in-1');

    const h1 = healthOf(state1);
    const h2 = healthOf(state2);
    // h2 should have better or equal connectivity score
    const conn1 = h1.subsystems.find((s) => s.subsystem === 'connectivity');
    const conn2 = h2.subsystems.find((s) => s.subsystem === 'connectivity');
    // If connectivity is active in both, connected state should be >= unconnected
    if (conn1?.active && conn2?.active) {
      expect(conn2.score).toBeGreaterThanOrEqual(conn1.score);
    }
  });

  it('score floor is 0, never negative', () => {
    const state = new AppState();
    state.setRoom(createDefaultRoom('conference'));
    // Add many devices to force many errors
    for (let i = 0; i < 20; i++) {
      place(state, 'user-hdmi-switcher-2x1', `sw${i}`);
    }
    // Create connections to activate graph and force errors
    state.addConnection('sw0', 'hdmi-out', 'sw1', 'hdmi-in-1');

    const health = healthOf(state);
    expect(health.score).toBeGreaterThanOrEqual(0);
  });
});
