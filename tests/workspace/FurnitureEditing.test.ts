import { describe, it, expect, vi, afterEach } from "vitest";
import * as T from "three";
import { createWorkspace } from "../../src/workspace/createWorkspace";
import { roomLayout } from "../../src/workspace/RoomLayout";
import { analyzeAudio } from "../../src/workspace/AudioEngineering";
import { useFurnitureDrag } from "../../src/workspace/useFurnitureDrag";
import type { CanvasManager } from "../../src/workspace/CanvasManager";

describe("Furniture edits in the active store", () => {
  it("moves generated seats and automatic devices together, preserving manual devices", () => {
    const store = createWorkspace(),
      before = roomLayout(store.api.getState().room);
    const dsp = store.snapshot().find((d) => d.kind === "dsp")!;
    store.api
      .getState()
      .setRoom({ furniture: { "table:0": { x: 1, z: 0.25 } } });
    const after = roomLayout(store.api.getState().room);
    expect(after.tables[0].x).toBe(1);
    expect(after.seats[0].position.x - before.seats[0].position.x).toBeCloseTo(
      1,
    );
    expect(store.get(dsp.id)!.position.x).toBe(1);
    store.move(dsp.id, { x: 0, y: 0.75, z: 0 });
    store.api.getState().setRoom({ furniture: { "table:0": { x: -1 } } });
    expect(store.get(dsp.id)!.position).toEqual({ x: 0, y: 0.75, z: 0 });
  });
  it("uses moved chair coordinates in live audio analysis and keeps the chair independent", () => {
    const store = createWorkspace(),
      seat = roomLayout(store.api.getState().room).seats[0];
    store.api
      .getState()
      .setRoom({
        furniture: {
          [`seat:${seat.id}`]: { x: 2, z: 1 },
          "table:0": { x: -1 },
        },
      });
    expect(roomLayout(store.api.getState().room).seats[0].position).toEqual({
      x: 2,
      y: 1.2,
      z: 1,
    });
    const result = analyzeAudio(store.api.getState(), "microphone");
    expect(result.seats.find((s) => s.id === seat.id)?.position).toEqual({
      x: 2,
      y: 1.2,
      z: 1,
    });
  });
  it("clamps edited furniture to resized room boundaries, retaining authored values", () => {
    const store = createWorkspace();
    store.api
      .getState()
      .setRoom({
        furniture: { "table:0": { x: 10, z: 10, width: 4, depth: 4 } },
      });
    store.api.getState().setRoom({ width: 3, depth: 3 });
    const t = roomLayout(store.api.getState().room).tables[0];
    expect(t.x + t.width / 2).toBeLessThanOrEqual(1.5);
    expect(t.z + t.depth / 2).toBeLessThanOrEqual(1.5);
    expect(store.api.getState().room.furniture?.["table:0"].x).toBe(10);
  });
  it("freezes edits, rejects invalid geometry, and clears edits when topology changes", () => {
    const store = createWorkspace();
    const edit = { x: 1 };
    store.api.getState().setRoom({ furniture: { "table:0": edit } });
    edit.x = 9;
    expect(store.api.getState().room.furniture?.["table:0"].x).toBe(1);
    expect(() =>
      store.api.getState().setRoom({ furniture: { "table:0": { x: NaN } } }),
    ).toThrow();
    expect(() =>
      store.api.getState().setRoom({ furniture: { "table:0": { height: 0 } } }),
    ).toThrow();
    store.api.getState().setRoom({ capacity: 4 });
    expect(store.api.getState().room.furniture).toEqual({});
  });
});

let cleanup = () => {};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function dragSetup() {
  const store = createWorkspace();
  const events = new Map<string, (e: any) => void>(),
    keys = new Map<string, (e: any) => void>();
  const captures = new Set<number>();
  const element = {
    style: { cursor: "grab" },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    setPointerCapture: (id: number) => captures.add(id),
    hasPointerCapture: (id: number) => captures.has(id),
    releasePointerCapture: (id: number) => captures.delete(id),
    addEventListener: (n: string, f: (e: any) => void) => events.set(n, f),
    removeEventListener: (n: string) => events.delete(n),
  };
  vi.stubGlobal("window", {
    addEventListener: (n: string, f: (e: any) => void) => keys.set(n, f),
    removeEventListener: (n: string) => keys.delete(n),
  });
  const camera = new T.OrthographicCamera(-4, 4, 3, -3, 0.1, 100);
  camera.position.set(0, 10, 0);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const canvas = {
    renderer: { domElement: element },
    camera,
    furnitureEditing: true,
    pickFurniture: () => "table:0",
  } as unknown as CanvasManager;
  cleanup = useFurnitureDrag(canvas, store);
  const pointer = (type: string, x: number, z: number, shiftKey = false) => {
    const p = new T.Vector3(x, 0.75, z).project(camera);
    events.get(type)?.({
      clientX: (p.x + 1) * 400,
      clientY: (1 - p.y) * 300,
      isPrimary: true,
      button: 0,
      pointerId: 1,
      shiftKey,
      preventDefault: vi.fn(),
    });
  };
  return { store, keys, pointer, captures, events, canvas };
}
describe("Furniture pointer interaction", () => {
  it("snaps real ray intersections and rolls back on Escape", () => {
    const t = dragSetup();
    t.pointer("pointerdown", 0, 0);
    t.pointer("pointermove", 0.64, 0.4);
    expect(t.store.api.getState().room.furniture?.["table:0"]).toMatchObject({
      x: 0.75,
      z: 0.5,
    });
    t.keys.get("keydown")?.({ key: "Escape", preventDefault: vi.fn() });
    expect(t.store.api.getState().room.furniture).toEqual({});
    expect(t.captures.size).toBe(0);
  });
  it("supports fine snapping, commits release and cleans listeners", () => {
    const t = dragSetup();
    t.pointer("pointerdown", 0, 0);
    t.pointer("pointerup", 0.64, 0.4, true);
    expect(t.store.api.getState().room.furniture?.["table:0"].x).toBeCloseTo(
      0.65,
    );
    expect(t.captures.size).toBe(0);
    cleanup();
    expect(t.events.size).toBe(0);
    expect(t.keys.size).toBe(0);
  });
  it("does not restore stale furniture after a room preset change", () => {
    const t = dragSetup();
    t.pointer("pointerdown", 0, 0);
    t.pointer("pointermove", 1, 0);
    t.store.api.getState().setRoomPreset("huddle");
    t.keys.get("keydown")?.({ key: "Escape", preventDefault: vi.fn() });
    expect(t.store.api.getState().roomPreset).toBe("huddle");
    expect(t.store.api.getState().room.furniture).toBeUndefined();
  });
});
