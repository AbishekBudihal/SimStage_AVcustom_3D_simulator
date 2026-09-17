import { describe, it, expect } from "vitest";
import { createWorkspace } from "../../src/workspace/createWorkspace";
import { roomLayout, ROOM_TYPES } from "../../src/workspace/RoomLayout";
import { importSchematic } from "../../src/workspace/SchematicImport";
import { engineeringAudit } from "../../src/workspace/Engineering";
import { SpatialAssets } from "../../src/workspace/SpatialAssets";
describe("capacity driven dynamic design", () => {
  it("creates twelve seats in a 9 x 12 boardroom and adapts to capacity and dimensions", () => {
    const store = createWorkspace();
    store.api
      .getState()
      .setRoom({
        roomType: "Boardroom",
        width: 9,
        depth: 12,
        height: 3.5,
        capacity: 12,
      });
    expect(roomLayout(store.api.getState().room).seats).toHaveLength(12);
    store.api.getState().setRoom({ capacity: 6 });
    expect(roomLayout(store.api.getState().room).seats).toHaveLength(6);
    store.api.getState().setRoom({ width: 3, depth: 3, capacity: 80 });
    const state = store.api.getState(),
      layout = roomLayout(state.room);
    expect(layout.seats.length).toBeLessThan(80);
    expect(
      engineeringAudit(state, state.room).warnings.some((w) =>
        w.startsWith("Layout:"),
      ),
    ).toBe(true);
    for (const seat of layout.seats)
      expect(Math.abs(seat.position.z) + 0.24).toBeLessThanOrEqual(1.5);
  });
  it("supports all semantic types and zero capacity without leftover chairs", () => {
    const store = createWorkspace();
    for (const roomType of ROOM_TYPES) {
      store.api.getState().setRoom({ roomType, capacity: 0 });
      expect(roomLayout(store.api.getState().room).seats).toHaveLength(0);
    }
  });
  it("repositions automatic devices, preserves manual transforms and keeps graph identity", () => {
    const store = createWorkspace(),
      first = store.api.getState(),
      display = store.snapshot().find((d) => d.kind === "display")!,
      camera = store.snapshot().find((d) => d.kind === "ptz_camera")!;
    store.api.getState().setRoom({ width: 9, depth: 12, height: 3.5 });
    expect(store.get(display.id)!.position.z).toBe(-6);
    expect(store.get(camera.id)!.position.y).toBeGreaterThan(
      store.get(display.id)!.position.y,
    );
    store.move(display.id, { x: 2, y: 1.5, z: -6 });
    store.update(display.id, { rotation: { y: 0.25 } });
    const manual = store.get(display.id)!;
    store.api.getState().setRoom({ depth: 6 });
    expect(store.get(display.id)!.position).toEqual(manual.position);
    expect(store.get(display.id)!.rotation).toEqual(manual.rotation);
    expect(store.api.getState().connections).toBe(first.connections);
    expect(
      engineeringAudit(
        store.api.getState(),
        store.api.getState().room,
      ).warnings.some((w) => w.startsWith("Placement:")),
    ).toBe(true);
    store.update(display.id, {
      placement: { mode: "auto", intent: "mainDisplayWall" },
    });
    expect(store.get(display.id)!.position.z).toBe(-3);
  });
  it("imports exact catalog ports into the same store in one atomic publication", () => {
    const store = createWorkspace(),
      before = store.snapshot().length;
    let notifications = 0;
    const off = store.api.subscribe(() => notifications++);
    importSchematic(store, {
      nodes: [
        { id: "screen", catalogId: "samsung-qm75b" },
        { id: "camera", catalogId: "yealink-uvc86" },
      ],
      connections: [
        {
          from: { deviceId: "camera", portId: "hdmi-out" },
          to: { deviceId: "screen", portId: "hdmi-1" },
        },
      ],
    });
    expect(notifications).toBe(1);
    expect(store.snapshot()).toHaveLength(before + 2);
    expect(
      store
        .snapshot()
        .slice(-2)
        .every((d) => d.placement?.mode === "auto"),
    ).toBe(true);
    const state = store.api.getState();
    expect(() =>
      importSchematic(store, {
        nodes: [{ id: "a", catalogId: "samsung-qm75b" }],
        connections: [
          {
            from: { deviceId: "a", portId: "missing" },
            to: { deviceId: "b", portId: "missing" },
          },
        ],
      }),
    ).toThrow();
    expect(store.api.getState()).toBe(state);
    off();
  });
  it("preserves explicit engineer coordinates and reconstructs procedural ceiling/furniture", () => {
    const store = createWorkspace();
    importSchematic(store, {
      nodes: [
        {
          id: "a",
          catalogId: "samsung-qm75b",
          position: { x: 1, y: 1.6, z: -3 },
        },
      ],
      connections: [],
    });
    const device = store.snapshot()[store.snapshot().length - 1]!;
    store.api
      .getState()
      .setRoom({ capacity: 12, width: 9, depth: 12, roomType: "Boardroom" });
    expect(store.get(device.id)!.position).toEqual({ x: 1, y: 1.6, z: -3 });
    const assets = new SpatialAssets(),
      room = assets.room(store.api.getState().room);
    expect(room.getObjectByName("Ceiling")).toBeDefined();
    expect(room.getObjectByName("Furniture")).toBeDefined();
    expect(
      room.children.filter((x) => x.name === "Office light").length,
    ).toBeGreaterThan(1);
    assets.dispose();
  });
});
