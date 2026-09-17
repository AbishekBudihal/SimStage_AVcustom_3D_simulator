import { describe, it, expect } from "vitest";
import {
  INITIAL_CATALOG,
  parseCatalog,
  deviceFromProfile,
} from "../../src/workspace/catalog";
import { DeviceStore } from "../../src/workspace/DeviceStore";
import { createWorkspace } from "../../src/workspace/createWorkspace";
import { roomLayout } from "../../src/workspace/RoomLayout";
import {
  engineeringAudit,
  visualRegionBoundary,
} from "../../src/workspace/Engineering";
import { summarizeBom } from "../../src/workspace/BomSummary";
import displays from "../../data/displays.json";
import systems from "../../data/system-devices.json";
const supplied = {
  id: "uploaded-display",
  manufacturer: "Test manufacturer",
  model: "Exact revision",
  category: "display",
  physical: { width: 1.8, height: 1, depth: 0.04 },
  powerWatts: 123.4,
  heatBtuPerHour: 350.2,
  display: { imageHeightM: 0.92 },
  ports: [
    {
      id: "a",
      label: "Video input",
      direction: "input",
      connector: "hdmi",
      transport: "hdmi",
      signalTypes: ["VIDEO"],
      required: true,
    },
  ],
  provenance: "user_defined",
};
describe("uploaded simulator catalog", () => {
  it("ingests all 83 records and preserves raw provenance and exact physical values", () => {
    expect(INITIAL_CATALOG).toHaveLength(83);
    expect(new Set(INITIAL_CATALOG.map((p) => p.id)).size).toBe(83);
    const original = displays.find((p) => p.id === "samsung-qm75b")!;
    const p = INITIAL_CATALOG.find((p) => p.id === original.id)!;
    expect(p.raw).toEqual(original);
    expect(p.dimensions).toEqual({
      x: original.physical.width,
      y: original.physical.height,
      z: original.physical.depth,
    });
    expect(p.provenance).toBe(original.provenance);
    expect(p.metadata.powerWatts).toBeNull();
    expect(p.metadata.heatBtuPerHour).toBeNull();
    expect(Object.isFrozen(p.raw.physical)).toBe(true);
  });
  it("keeps explicit port identifiers, directions, transports and channel metadata", () => {
    const original = systems.find((d) => d.id === "biamp-tesiraforte-vt4")!;
    const product = INITIAL_CATALOG.find((d) => d.id === original.id)!;
    expect(product.ports.length).toBe(original.ports!.length);
    original.ports!.forEach((port, i) =>
      expect(product.ports[i]).toMatchObject(port),
    );
    expect(INITIAL_CATALOG.find((d) => d.id === "shure-mxa920")!.ports).toEqual(
      [],
    );
    expect(
      INITIAL_CATALOG.find((d) => d.id === "samsung-qm75b")!.ports.filter(
        (p) => p.signal === "hdmi",
      ),
    ).toHaveLength(3);
  });
  it("preserves supplied electrical loads without deriving or inventing a heat value", () => {
    const product = parseCatalog([supplied])[0];
    expect(product.metadata.powerWatts).toBe(123.4);
    expect(product.metadata.heatBtuPerHour).toBe(350.2);
    const store = new DeviceStore();
    store.api.getState().importCatalog([supplied], "customer.json");
    const profile = store.api
      .getState()
      .catalog.find((p) => p.id === supplied.id)!;
    store.add(deviceFromProfile(profile, 0, store.api.getState().room));
    expect(summarizeBom(store.api.getState().devices).power).toBe(123.4);
    expect(store.snapshot()[0].ports[0].id).toBe("a");
    expect(profile.sourceFile).toBe("customer.json");
  });
  it("rejects malformed and duplicate imports atomically", () => {
    const store = new DeviceStore(),
      initial = store.api.getState().catalog;
    for (const input of [
      [
        supplied,
        {
          ...supplied,
          id: "bad",
          physical: { width: -1, height: 1, depth: 1 },
        },
      ],
      [supplied, supplied],
      [
        {
          ...supplied,
          ports: [{ ...supplied.ports[0], direction: "sideways" }],
        },
      ],
    ]) {
      expect(() => store.api.getState().importCatalog(input)).toThrow();
      expect(store.api.getState().catalog).toBe(initial);
    }
    store.api.getState().importCatalog([supplied]);
    expect(() => store.api.getState().importCatalog([supplied])).toThrow();
    expect(store.api.getState().catalog).toHaveLength(84);
  });
  it("boots using simulator room defaults and only source-catalog device identities", () => {
    const store = createWorkspace();
    expect(store.api.getState().room).toMatchObject({
      width: 10,
      depth: 7,
      height: 3.2,
    });
    expect(
      store
        .snapshot()
        .every((d) => INITIAL_CATALOG.some((p) => p.id === d.catalogId)),
    ).toBe(true);
    expect(store.snapshot().every((d) => d.metadata.powerWatts === null)).toBe(
      true,
    );
  });
});
describe("reactive parametric room", () => {
  it("publishes dimensions and anchored devices atomically without breaking wires", () => {
    const store = createWorkspace(),
      old = store.api.getState();
    let notifications = 0;
    const unsubscribe = store.api.subscribe((state) => {
      notifications++;
      expect(
        Object.values(state.devices).find((d) => d?.kind === "display")!
          .position.z,
      ).toBe(-state.room.depth / 2);
    });
    old.setRoom({ width: 12.4, depth: 9.6, height: 4.1 });
    expect(notifications).toBe(1);
    expect(store.api.getState().connections).toBe(old.connections);
    expect(
      store
        .snapshot()
        .filter((d) => d.surface === "ceiling")
        .every((d) => d.position.y === 4.1),
    ).toBe(true);
    expect(old.room.height).toBe(3.2);
    unsubscribe();
  });
  it("grows seating mathematically and keeps all chair centres and desks inside bounds", () => {
    const store = new DeviceStore();
    store.api.getState().setRoom({ width: 8, depth: 6, layout: "training" });
    const small = roomLayout(store.api.getState().room);
    store.api.getState().setRoom({ width: 14, depth: 8 });
    expect(roomLayout(store.api.getState().room).seats.length).toBeGreaterThan(
      small.seats.length,
    );
    for (const width of [3, 4.1, 8, 14, 30])
      for (const depth of [3, 5.5, 8, 30])
        for (const layout of ["training", "huddle", "conference"] as const) {
          const room = { width, depth, height: 3, layout },
            generated = roomLayout(room);
          for (const seat of generated.seats) {
            expect(Math.abs(seat.position.x) + 0.24).toBeLessThanOrEqual(
              width / 2,
            );
            expect(Math.abs(seat.position.z) + 0.24).toBeLessThanOrEqual(
              depth / 2,
            );
          }
          for (const table of generated.tables) {
            expect(Math.abs(table.x) + table.width / 2).toBeLessThanOrEqual(
              width / 2,
            );
            expect(Math.abs(table.z) + table.depth / 2).toBeLessThanOrEqual(
              depth / 2,
            );
          }
        }
  });
  it("rejects invalid rooms without changing state or allocating unbounded heatmaps", () => {
    const store = createWorkspace(),
      before = store.api.getState();
    for (const update of [
      { width: 0 },
      { depth: Infinity },
      { height: 9 },
      { width: 31 },
    ])
      expect(() => before.setRoom(update)).toThrow();
    expect(store.api.getState()).toBe(before);
  });
  it("recalculates SPL and visual region from live room and device coordinates", () => {
    const store = createWorkspace(),
      state = store.api.getState();
    const display = store.snapshot().find((d) => d.kind === "display")!;
    const before = visualRegionBoundary(display, state.engineering, state.room);
    expect(before.length).toBeGreaterThan(0);
    expect(before.every(Number.isFinite)).toBe(true);
    store.update(display.id, { rotation: { y: Math.PI } });
    expect(
      visualRegionBoundary(
        store.get(display.id)!,
        state.engineering,
        state.room,
      ),
    ).toEqual([]);
    const oldAudit = engineeringAudit(state, state.room);
    state.setRoom({ width: 12, depth: 9, height: 4 });
    const next = store.api.getState(),
      audit = engineeringAudit(next, next.room);
    expect(audit.field.length).not.toBe(oldAudit.field.length);
    expect(audit.splMin).not.toBe(oldAudit.splMin);
  });
});
