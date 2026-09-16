import { describe, it, expect } from "vitest";
import * as T from "three";
import { DeviceStore, snapToSurface } from "../../src/workspace/DeviceStore";
import {
  HARDWARE_CATALOG,
  hardwareDevice,
} from "../../src/workspace/HardwareCatalog";
import { ROOM_PRESETS } from "../../src/workspace/RoomPresets";
import { roomLayout } from "../../src/workspace/RoomLayout";
import { SpatialAssets } from "../../src/workspace/SpatialAssets";
import {
  directSpl,
  engineeringAudit,
  visualCheck,
} from "../../src/workspace/Engineering";
import { createWorkspace } from "../../src/workspace/createWorkspace";
const room = ROOM_PRESETS.boardroom.room;

describe("manufacturer profiles and room presets", () => {
  it("keeps published envelopes in the procedural models, including details", () => {
    const assets = new SpatialAssets(),
      store = new DeviceStore();
    for (const p of HARDWARE_CATALOG) {
      expect(p.sources.every((s) => s.startsWith("https://"))).toBe(true);
      const id = store.add(hardwareDevice(p.id, 0, room));
      const model = assets.device(store.get(id)!);
      const size = new T.Box3().setFromObject(model).getSize(new T.Vector3());
      expect(size.x).toBeCloseTo(p.dimensions.x, 5);
      expect(size.y).toBeCloseTo(p.dimensions.y, 5);
      expect(size.z).toBeCloseTo(p.dimensions.z, 5);
      expect(new Set(p.ports.map((port) => port.id)).size).toBe(p.ports.length);
    }
    assets.dispose();
  });
  it("uses one physical Shure jack and separates passive drive from mains", () => {
    expect(hardwareDevice("shure-mxa920-s", 0, room).ports).toHaveLength(1);
    const speaker = hardwareDevice("qsc-ad-s6t", 0, room);
    expect(speaker.metadata.powerWatts).toBe(0);
    expect(speaker.metadata.speakerWatts).toBe(1);
    expect(hardwareDevice("samsung-qm85c", 0, room).metadata.powerWatts).toBe(
      330,
    );
  });
  it("atomically remaps devices while preserving selection, wiring and node positions", () => {
    const store = createWorkspace(),
      old = store.api.getState();
    const selected = store.snapshot()[0].id;
    old.selectDevice(selected);
    let events = 0;
    const unsub = store.api.subscribe(() => events++);
    old.setRoomPreset("training");
    const next = store.api.getState();
    expect(events).toBe(1);
    expect(next.connections).toBe(old.connections);
    expect(next.nodePositions).toBe(old.nodePositions);
    expect(next.selectedId).toBe(selected);
    expect(roomLayout(next.room).seats).toHaveLength(24);
    expect(roomLayout(next.room).tables).toHaveLength(12);
    expect(store.get(selected)?.position.z).toBe(-4);
    for (const d of store.snapshot())
      expect(snapToSurface(d.position, d.surface, next.room)).toEqual(
        d.position,
      );
    next.setRoomPreset("huddle");
    expect(roomLayout(store.api.getState().room).seats).toHaveLength(4);
    expect(old.room.width).toBe(8);
    unsub();
  });
  it("snaps to the nearest training table without leaving its bounds", () => {
    const training = ROOM_PRESETS.training.room;
    for (const t of roomLayout(training).tables) {
      const p = snapToSurface({ x: t.x, y: 0, z: t.z }, "table", training);
      expect(Math.abs(p.x - t.x)).toBeLessThanOrEqual(t.width / 2);
      expect(Math.abs(p.z - t.z)).toBeLessThanOrEqual(t.depth / 2);
      expect(p.y).toBe(0.75);
      expect(p.x / 0.5).toBe(Math.round(p.x / 0.5));
    }
  });
  it("rejects physical patch fanout even when endpoint direction is reversed", () => {
    const store = new DeviceStore();
    const ids = Array.from({ length: 3 }, () =>
      store.add(hardwareDevice("shure-mxa920-s", 0, room)),
    );
    const endpoint = (i: number) => ({
      deviceId: ids[i],
      portId: "Dante / PoE",
    });
    store.api.getState().connect(endpoint(0), endpoint(1));
    expect(() =>
      store.api.getState().connect(endpoint(1), endpoint(2)),
    ).toThrow();
    expect(() =>
      store.api.getState().connect(endpoint(2), endpoint(0)),
    ).toThrow();
  });
});

describe("live planning simulation", () => {
  it("changes SPL by 10 dB for tenfold power, attenuates off-axis and supports mute", () => {
    const store = new DeviceStore(),
      id = store.add(
        hardwareDevice("qsc-ad-s6t", 0, room, { x: 0, y: 1, z: -3 }),
      );
    const point = { x: 0, y: 1, z: -2 };
    expect(directSpl(store.snapshot(), point)).toBeCloseTo(89);
    store.update(id, { metadata: { speakerWatts: 10 } });
    expect(directSpl(store.snapshot(), point)).toBeCloseTo(99);
    store.update(id, { rotation: { y: Math.PI / 2 } });
    expect(directSpl(store.snapshot(), point)!).toBeLessThan(90);
    store.update(id, { metadata: { speakerWatts: 0 } });
    expect(directSpl(store.snapshot(), point)).toBeNull();
    expect(engineeringAudit(store.api.getState(), room).splMin).toBeNull();
    expect(() =>
      store.update(id, { metadata: { speakerWatts: 151 } }),
    ).toThrow();
  });
  it("updates visual colors with display size and orientation", () => {
    const store = new DeviceStore(),
      id = store.add(
        hardwareDevice("samsung-qm75c", 0, room, { x: 0, y: 1.5, z: -3 }),
      );
    const settings = store.api.getState().engineering;
    expect(
      visualCheck(store.get(id)!, { x: 0, y: 1.2, z: 0 }, settings).status,
    ).toBe("green");
    expect(
      visualCheck(store.get(id)!, { x: 0, y: 1.2, z: 2.3 }, settings).status,
    ).toBe("yellow");
    expect(
      visualCheck(store.get(id)!, { x: 0, y: 1.2, z: 3 }, settings).status,
    ).toBe("red");
    store.update(id, { metadata: { imageHeightM: 1.1 } });
    expect(
      visualCheck(store.get(id)!, { x: 0, y: 1.2, z: 2.3 }, settings).status,
    ).toBe("green");
    store.update(id, { rotation: { y: Math.PI } });
    expect(
      visualCheck(store.get(id)!, { x: 0, y: 1.2, z: 0 }, settings).status,
    ).toBe("red");
  });
});
