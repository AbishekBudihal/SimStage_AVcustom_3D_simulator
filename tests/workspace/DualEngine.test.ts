import { describe, it, expect } from "vitest";
import { DeviceStore, snapToSurface } from "../../src/workspace/DeviceStore";
import { catalogDevice, ROOM } from "../../src/workspace/Catalog";
import { createWorkspace } from "../../src/workspace/createWorkspace";
import {
  directSpl,
  intelligibilityProxy,
  visualCheck,
  engineeringAudit,
} from "../../src/workspace/Engineering";
import {
  connectionDistance,
  wirePath,
} from "../../src/workspace/SchematicModel";
import { roomLayout } from "../../src/workspace/RoomLayout";

describe("signal graph synchronization", () => {
  it("validates compatibility, direction, occupancy and endpoint existence", () => {
    const store = new DeviceStore(),
      source = store.add(catalogDevice("source", 0)),
      display = store.add(catalogDevice("display", 0)),
      speaker = store.add(catalogDevice("speaker", 0));
    const from = { deviceId: source, portId: "HDMI out" },
      to = { deviceId: display, portId: "HDMI in" };
    expect(() => store.api.getState().connect(to, from)).toThrow();
    expect(() =>
      store.api
        .getState()
        .connect(from, { deviceId: speaker, portId: "Dante in" }),
    ).toThrow();
    expect(() =>
      store.api
        .getState()
        .connect(from, { deviceId: "missing", portId: "HDMI in" }),
    ).toThrow();
    store.api.getState().connect(from, to);
    expect(() => store.api.getState().connect(from, to)).toThrow();
    expect(store.api.getState().connections).toHaveLength(1);
  });
  it("preserves connection identity during movement and removes stale ports and nodes atomically", () => {
    const store = createWorkspace(),
      connection = store.api.getState().connections[0];
    const before = connectionDistance(connection, store.api.getState());
    store.move(connection.from.deviceId, { x: 3, y: 0.75, z: 2 });
    expect(store.api.getState().connections[0]).toBe(connection);
    expect(connectionDistance(connection, store.api.getState())).not.toBe(
      before,
    );
    store.update(connection.from.deviceId, { ports: [] });
    expect(
      store.api.getState().connections.some((c) => c.id === connection.id),
    ).toBe(false);
    const next = connection;
    store.api.getState().moveNode(next.to.deviceId, { x: 10, y: 20 });
    store.remove(next.to.deviceId);
    expect(
      store.api.getState().nodePositions[next.to.deviceId],
    ).toBeUndefined();
    expect(
      store.api
        .getState()
        .connections.some(
          (c) =>
            c.to.deviceId === next.to.deviceId ||
            c.from.deviceId === next.to.deviceId,
        ),
    ).toBe(false);
  });
  it("routes forward and backward wires with cubic elbows and exact endpoints", () => {
    for (const end of [
      { x: 400, y: 200 },
      { x: -100, y: 200 },
      { x: 100, y: 0 },
    ]) {
      const path = wirePath({ x: 100, y: 0 }, end);
      expect(path.startsWith("M 100 0")).toBe(true);
      expect(path.endsWith(`L ${end.x} ${end.y}`)).toBe(true);
      expect(path).not.toContain("NaN");
    }
    expect(wirePath({ x: 0, y: 0 }, { x: 100, y: 100 })).toContain(" C ");
  });
});
describe("engineering planning estimates", () => {
  it("applies inverse-distance SPL and incoherent energy summation", () => {
    const store = new DeviceStore(),
      id = store.add(catalogDevice("speaker", 0, { x: 0, y: 1, z: -3 }));
    expect(directSpl(store.snapshot(), { x: 0, y: 1, z: -2 })).toBeNull();
    store.update(id, { metadata: { splAt1m: 80 } });
    expect(directSpl(store.snapshot(), { x: 0, y: 1, z: -2 })).toBeCloseTo(80);
    expect(directSpl(store.snapshot(), { x: 0, y: 1, z: -1 })).toBeCloseTo(
      73.9794,
    );
    expect(
      directSpl([store.get(id)!, store.get(id)!], { x: 0, y: 1, z: -2 }),
    ).toBeCloseTo(83.0103);
  });
  it("does not invent intelligibility and degrades with noise and reverberation", () => {
    expect(intelligibilityProxy(70, null, 0.5)).toBeNull();
    expect(intelligibilityProxy(null, 40, 0.5)).toBeNull();
    const baseline = intelligibilityProxy(70, 30, 0.3)!;
    expect(baseline).toBeGreaterThan(intelligibilityProxy(70, 60, 0.3)!);
    expect(baseline).toBeGreaterThan(intelligibilityProxy(70, 30, 2)!);
    expect(baseline).toBeGreaterThanOrEqual(0);
    expect(baseline).toBeLessThanOrEqual(1);
  });
  it("uses orientation, image height and content size for visual checks", () => {
    const store = new DeviceStore(),
      id = store.add(catalogDevice("display", 0, { x: 0, y: 1.2, z: -3 }));
    const settings = store.api.getState().engineering;
    const result = visualCheck(
      store.get(id)!,
      { x: 0, y: 1.2, z: 1 },
      settings,
    );
    expect(result.distance).toBeCloseTo(4);
    expect(result.bdmMax).toBeCloseTo(4.8);
    expect(result.pass).toBe(true);
    store.update(id, { rotation: { y: Math.PI } });
    expect(
      visualCheck(store.get(id)!, { x: 0, y: 1.2, z: 1 }, settings).pass,
    ).toBe(false);
    store.update(id, { rotation: { y: 0 }, metadata: { imageHeightM: 1.2 } });
    expect(
      visualCheck(store.get(id)!, { x: 0, y: 1.2, z: 1 }, settings).bdmMax,
    ).toBeCloseTo(7.2);
  });
  it("exposes back-row warnings, unknown inputs and load budget violations", () => {
    const store = createWorkspace();
    store.api.getState().setEngineering({ viewingRatio: 4 });
    let result = engineeringAudit(store.api.getState(), ROOM);
    expect(result.warnings.some((w) => w.startsWith("Back row"))).toBe(true);
    expect(
      result.field.every((p) => p.spl !== null && p.intelligibility === null),
    ).toBe(true);
    const first = store.snapshot()[0];
    store.update(first.id, {
      metadata: { powerWatts: 2000, heatBtuPerHour: 7000 },
    });
    result = engineeringAudit(store.api.getState(), ROOM);
    expect(result.warnings.some((w) => w.startsWith("Power:"))).toBe(true);
    expect(result.warnings.some((w) => w.startsWith("Thermal:"))).toBe(true);
    expect(result.score).toBeLessThan(100);
  });
  it("rejects invalid engineering and device specifications", () => {
    const store = new DeviceStore(),
      id = store.add(catalogDevice("speaker", 0));
    expect(() => store.api.getState().setEngineering({ rt60: -1 })).toThrow();
    expect(() =>
      store.api.getState().setEngineering({ noiseDb: NaN }),
    ).toThrow();
    expect(() =>
      store.update(id, { metadata: { splAt1m: Infinity } }),
    ).toThrow();
    expect(() => store.update(id, { metadata: { imageHeightM: 0 } })).toThrow();
  });
  it("keeps table anchors on-grid and within the generated tabletop", () => {
    const table = roomLayout(ROOM),
      point = snapToSurface({ x: 100, y: 100, z: 100 }, "table", ROOM);
    expect(point.y).toBe(table.tableHeight);
    expect(point.x).toBeLessThanOrEqual(table.tableWidth / 2);
    expect(point.z).toBeLessThanOrEqual(table.tableDepth / 2);
    expect(point.x % 0.5).toBe(0);
    expect(table.seats).toHaveLength(7);
  });
});
