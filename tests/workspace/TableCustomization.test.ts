import { describe, it, expect } from "vitest";
import { createWorkspace } from "../../src/workspace/createWorkspace";
import { roomLayout } from "../../src/workspace/RoomLayout";
import type { TableSettings } from "../../src/workspace/DeviceStore";
const table: TableSettings = {
  width: 2,
  depth: 4,
  height: 0.9,
  finish: "walnut",
  shape: "rectangular",
};
describe("Custom parametric tables", () => {
  it("updates geometry, seating and automatic table mounting together", () => {
    const store = createWorkspace();
    store.api.getState().setRoom({ table });
    const layout = roomLayout(store.api.getState().room);
    expect(layout.tables[0]).toMatchObject({ width: 2, depth: 4, height: 0.9 });
    expect(layout.seats[0].position.x).toBe(-1.55);
    expect(store.snapshot().find((d) => d.kind === "dsp")!.position.y).toBe(
      0.9,
    );
    expect(Object.isFrozen(store.api.getState().room.table)).toBe(true);
  });
  it("preserves manually moved devices and restores default sizing", () => {
    const store = createWorkspace(),
      d = store.snapshot().find((d) => d.kind === "dsp")!;
    store.move(d.id, { x: 0, y: 0.75, z: 0.5 });
    store.api.getState().setRoom({ table });
    expect(store.get(d.id)!.position).toEqual({ x: 0, y: 0.75, z: 0.5 });
    store.api.getState().setRoom({ table: undefined });
    expect(roomLayout(store.api.getState().room).tableHeight).toBe(0.75);
  });
  it("clamps oversized tables to room clearance", () => {
    const store = createWorkspace();
    store.api
      .getState()
      .setRoom({
        width: 3,
        depth: 3,
        table: { ...table, width: 20, depth: 20 },
      });
    const layout = roomLayout(store.api.getState().room);
    expect(layout.tableWidth).toBeCloseTo(0.8);
    expect(layout.tableDepth).toBeCloseTo(1.2);
    for (const seat of layout.seats) {
      expect(Math.abs(seat.position.x)).toBeLessThan(1.5);
      expect(Math.abs(seat.position.z)).toBeLessThan(1.5);
    }
  });
  it("generates training desk bays from custom dimensions and capacity", () => {
    const store = createWorkspace();
    store.api
      .getState()
      .setRoom({
        roomType: "Training Room",
        capacity: 12,
        table: { ...table, width: 2.4, depth: 0.8 },
      });
    const layout = roomLayout(store.api.getState().room);
    expect(layout.seats.length).toBe(12);
    expect(layout.tables).toHaveLength(6);
    expect(
      layout.tables.every((t) => t.depth === 0.8 && t.height === 0.9),
    ).toBe(true);
  });
  it("rejects invalid dimensions without changing state", () => {
    const store = createWorkspace(),
      before = store.api.getState();
    expect(() =>
      store.api.getState().setRoom({ table: { ...table, height: NaN } }),
    ).toThrow();
    expect(store.api.getState()).toBe(before);
  });
});
