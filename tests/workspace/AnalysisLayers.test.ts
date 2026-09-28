import { describe, it, expect } from "vitest";
import { createWorkspace } from "../../src/workspace/createWorkspace";
import { viewingField } from "../../src/workspace/ViewingField";
import {
  parseCatalog,
  exportCatalog,
  deviceFromProfile,
  INITIAL_CATALOG,
} from "../../src/workspace/catalog";
import { summarizeBom } from "../../src/workspace/BomSummary";

describe("Live viewing floor layer", () => {
  it("uses live display orientation and room bounds", () => {
    const store = createWorkspace(),
      before = viewingField(store.api.getState());
    const display = store.snapshot().find((d) => d.kind === "display")!;
    store.update(display.id, { rotation: { y: Math.PI } });
    const after = viewingField(store.api.getState());
    expect(after).not.toEqual(before);
    store.api.getState().setRoom({ width: 4, depth: 3 });
    expect(viewingField(store.api.getState())).toHaveLength(48);
  });
  it("marks missing displays unknown, not failed or passed", () => {
    const store = createWorkspace();
    store
      .snapshot()
      .filter((d) => d.kind === "display")
      .forEach((d) => store.remove(d.id));
    expect(
      viewingField(store.api.getState()).every((p) => p.spl === null),
    ).toBe(true);
  });
});
const raw = {
  id: "profile-v2",
  manufacturer: "Test",
  model: "Fixture",
  revision: "2",
  category: "display",
  physical: { width: 1.7, height: 1, depth: 0.08, weightKg: 25 },
  electrical: { powerWatts: 100 },
  thermal: { heatBtuPerHour: 300 },
  ports: [
    {
      id: "hdmi-1",
      label: "HDMI in",
      direction: "input",
      connector: "HDMI Type A",
      transport: "hdmi",
      required: true,
    },
  ],
  provenance: "user_defined",
  source: "test specification",
};
describe("Versioned manufacturer catalog", () => {
  it("round-trips parametric fields without losing raw provenance", () => {
    const parts = parseCatalog([raw]);
    const roundTrip = parseCatalog(exportCatalog(parts));
    expect(roundTrip[0].revision).toBe("2");
    expect(roundTrip[0].raw).toEqual(raw);
    expect(roundTrip[0].metadata.weightKg).toBe(25);
    expect(roundTrip[0].ports[0].connector).toBe("HDMI Type A");
  });
  it("propagates imported weight, dimensions, loads and ports to placed devices and BOM", () => {
    const store = createWorkspace();
    store.api.getState().importCatalog({ schemaVersion: 2, parts: [raw] });
    const profile = store.api.getState().catalog.find((p) => p.id === raw.id)!;
    const id = store.add(
      deviceFromProfile(profile, 0, store.api.getState().room),
    );
    expect(store.get(id)?.dimensions?.x).toBe(1.7);
    expect(store.get(id)?.ports[0].required).toBe(true);
    const row = summarizeBom(store.api.getState().devices).rows.find(
      (r) => r.catalogId === raw.id,
    )!;
    expect(row).toMatchObject({
      weight: 25,
      power: 100,
      heat: 300,
      unknownWeight: 0,
    });
  });
  it("ingests original uploaded weights and does not invent missing loads", () => {
    const p = INITIAL_CATALOG.find((p) => p.id === "lg-86uh5j")!;
    expect(p.metadata.weightKg).toBe(52.6);
    expect(p.metadata.powerWatts).toBeNull();
  });
  it("rejects wrong units, unknown schema, negative weight and duplicate IDs", () => {
    expect(() => parseCatalog({ schemaVersion: 3, parts: [raw] })).toThrow();
    expect(() =>
      parseCatalog({
        schemaVersion: 2,
        units: { dimensions: "mm" },
        parts: [raw],
      }),
    ).toThrow();
    expect(() =>
      parseCatalog([{ ...raw, physical: { ...raw.physical, weightKg: -1 } }]),
    ).toThrow();
    expect(() => parseCatalog([raw, raw])).toThrow();
  });
});
