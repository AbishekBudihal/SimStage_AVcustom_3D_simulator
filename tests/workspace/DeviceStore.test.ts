import { describe, expect, it } from 'vitest';
import { DeviceStore, snapToSurface, type MountSurface, type PlacedDevice } from '../../src/workspace/DeviceStore';

const input: PlacedDevice = {
  id: 'rack-1', catalogId: 'rack', kind: 'rack', surface: 'floor', position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 }, ports: [{ id: 'power', label: 'Power', signal: 'AC', direction: 'input' }],
  metadata: { label: 'Rack', powerWatts: null, heatBtuPerHour: null, rackUnits: null },
};
describe('workspace state', () => {
  it('owns immutable data and emits only effective moves', () => {
    const store = new DeviceStore();
    const original = { ...input, position: { ...input.position } };
    store.add(original);
    original.position.x = 100;
    expect(store.get(input.id)?.position.x).toBe(0);
    let changes = 0;
    const unsubscribe = store.subscribe(() => changes++);
    store.move(input.id, { x: 0.5, y: 0, z: 0 });
    store.move(input.id, { x: 0.5, y: 0, z: 0 });
    expect(changes).toBe(1);
    expect(store.get(input.id)?.ports).toEqual(input.ports);
    expect(Object.isFrozen(store.get(input.id)?.position)).toBe(true);
    unsubscribe();
    store.remove(input.id);
    expect(changes).toBe(1);
    expect(store.snapshot()).toEqual([]);
  });
  it('rejects duplicate IDs and invalid data without changing records', () => {
    const store = new DeviceStore();
    store.add(input);
    expect(() => store.add(input)).toThrow();
    expect(() => store.move(input.id, { x: NaN, y: 0, z: 0 })).toThrow();
    expect(() => store.add({ ...input, id: 'bad', rotation: { x: 0, y: 0, z: 0 }, ports: [input.ports[0], input.ports[0]] })).toThrow();
    expect(store.snapshot()).toHaveLength(1);
  });
  it.each<MountSurface>(['floor', 'ceiling', 'north', 'south', 'east', 'west'])('constrains %s to its room plane', surface => {
    const room = { width: 6.3, depth: 4.3, height: 2.7 };
    const position = snapToSurface({ x: 100, y: 100, z: -100 }, surface, room);
    expect(position.x).toBeGreaterThanOrEqual(-3.15);
    expect(position.x).toBeLessThanOrEqual(3.15);
    expect(position.y).toBeGreaterThanOrEqual(0);
    expect(position.y).toBeLessThanOrEqual(2.7);
    expect(position.z).toBeGreaterThanOrEqual(-2.15);
    expect(position.z).toBeLessThanOrEqual(2.15);
    if (surface === 'floor') expect(position.y).toBe(0);
    if (surface === 'ceiling') expect(position.y).toBe(2.7);
    if (surface === 'north') expect(position.z).toBe(-2.15);
    if (surface === 'south') expect(position.z).toBe(2.15);
    if (surface === 'east') expect(position.x).toBe(3.15);
    if (surface === 'west') expect(position.x).toBe(-3.15);
  });
  it('snaps in half-metre increments and validates grid size', () => {
    expect(snapToSurface({ x: 0.74, y: 1, z: -0.76 }, 'floor', { width: 6, depth: 4, height: 3 }))
      .toEqual({ x: 0.5, y: 0, z: -1 });
    expect(() => snapToSurface(input.position, 'floor', { width: 6, depth: 4, height: 3 }, 0)).toThrow();
  });
});


 describe('Zustand actions', () => {
  it('merges transforms and metadata without mutating earlier snapshots or other devices', () => {
    const store = new DeviceStore();
    store.add(input);
    store.add({ ...input, id: 'other' });
    const before = store.api.getState();
    const patch = { position: { x: 2 }, rotation: { y: Math.PI / 2 }, metadata: { rackUnits: 4, powerWatts: 120 } };
    before.updateDevice(input.id, patch);
    patch.position.x = 999;
    const after = store.api.getState();
    expect(after.devices[input.id]?.position).toEqual({ x: 2, y: 0, z: 0 });
    expect(after.devices[input.id]?.rotation.y).toBe(Math.PI / 2);
    expect(after.devices[input.id]?.metadata).toEqual({ ...input.metadata, rackUnits: 4, powerWatts: 120 });
    expect(before.devices[input.id]).toEqual(input);
    expect(after.devices.other).toBe(before.devices.other);
  });
  it('clears selection atomically on deletion and rejects missing selections', () => {
    const store = new DeviceStore();
    store.add(input);
    store.api.getState().selectDevice(input.id);
    let notifications = 0;
    store.api.subscribe(state => {
      notifications++;
      expect(state.selectedId).toBeNull();
      expect(state.devices[input.id]).toBeUndefined();
    });
    store.remove(input.id);
    expect(notifications).toBe(1);
    expect(() => store.api.getState().selectDevice('missing')).toThrow();
  });
  it('validates rotation and engineering metadata before publishing updates', () => {
    const store = new DeviceStore();
    store.add(input);
    const before = store.api.getState();
    expect(() => store.update(input.id, { rotation: { z: Infinity } })).toThrow();
    expect(() => store.update(input.id, { metadata: { rackUnits: -1 } })).toThrow();
    expect(() => store.update(input.id, { metadata: { heatBtuPerHour: NaN } })).toThrow();
    expect(store.api.getState()).toBe(before);
  });
  it('supports all device kinds and prototype-like IDs', () => {
    const store = new DeviceStore();
    for (const kind of ['display', 'ptz_camera', 'ceiling_mic', 'speaker', 'rack'] as const) {
      store.add({ ...input, id: kind, kind });
    }
    expect(store.snapshot()).toHaveLength(5);
    expect(store.get('constructor')).toBeUndefined();
    store.add({ ...input, id: '__proto__' });
    store.api.getState().selectDevice('__proto__');
    store.remove('__proto__');
    expect(store.api.getState().selectedId).toBeNull();
  });
});
