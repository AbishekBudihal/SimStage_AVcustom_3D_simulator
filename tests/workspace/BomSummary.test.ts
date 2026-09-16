import { describe, expect, it } from "vitest";
import { DeviceStore } from "../../src/workspace/DeviceStore";
import { summarizeBom } from "../../src/workspace/BomSummary";
describe("BOM aggregation", () => {
  it("groups catalog and kind, preserves unknown loads and follows edits and deletion", () => {
    const store = new DeviceStore();
    const input = {
      catalogId: "display",
      kind: "display" as const,
      surface: "north" as const,
      position: { x: 0, y: 1, z: -3 },
      rotation: { x: 0, y: 0, z: 0 },
      ports: [],
      metadata: {
        label: "Display",
        powerWatts: 120,
        heatBtuPerHour: 400,
        rackUnits: null,
      },
    };
    const first = store.add(input);
    const second = store.add({
      ...input,
      metadata: { ...input.metadata, powerWatts: null },
    });
    let bom = summarizeBom(store.api.getState().devices);
    expect(bom).toMatchObject({
      count: 2,
      power: 120,
      heat: 800,
      incomplete: 1,
    });
    expect(bom.rows).toHaveLength(1);
    expect(bom.rows[0]).toMatchObject({
      quantity: 2,
      unknownPower: 1,
      unknownHeat: 0,
    });
    store.update(second, { metadata: { powerWatts: 100 } });
    expect(summarizeBom(store.api.getState().devices).power).toBe(220);
    store.remove(first);
    store.remove(second);
    expect(summarizeBom(store.api.getState().devices)).toMatchObject({
      count: 0,
      power: 0,
      heat: 0,
      incomplete: 0,
      rows: [],
    });
  });
});
