import { describe, expect, it } from "vitest";
import { INITIAL_CATALOG, parseCatalog, exportCatalog, deviceFromProfile } from "../../src/workspace/catalog";
import { createDeviceStore } from "../../src/workspace/DeviceStore";
import { parseEvidence, specStatus, simulationAccuracy } from "../../src/workspace/SpecificationEvidence";
const source = "https://example.com/datasheet";
const evidence = { value: 88, basis: "manufacturer" as const, source, checkedOn: "2026-10-07", conditions: "1W / 1m" };
const profile = INITIAL_CATALOG.find(p => p.id === "qsc-adc6t")!;
describe("specification provenance", () => {
  it("uses corrected manufacturer values and preserves evidence through database export/import", () => {
    expect(profile.metadata.sensitivityDb).toBe(88);
    expect(profile.metadata.coverageDegrees).toBe(135);
    expect(profile.metadata.maxSpl).toBe(106);
    expect(profile.metadata.maxSpeakerWatts).toBe(60);
    expect(profile.dimensions).toEqual({ x: .28, y: .237, z: .28 });
    expect(profile.metadata.specificationEvidence?.sensitivityDb?.source).toContain("qsys.com");
    expect(parseCatalog(exportCatalog([profile]))[0].metadata.specificationEvidence).toEqual(profile.metadata.specificationEvidence);
  });
  it("invalidates provenance when a placed value changes without altering the catalog or prior snapshot", () => {
    const api = createDeviceStore();
    const id = api.getState().addDevice(deviceFromProfile(profile, 0, api.getState().room));
    const before = api.getState().devices[id]!;
    expect(specStatus(before, "sensitivityDb").basis).toBe("manufacturer");
    api.getState().updateDevice(id, { metadata: { sensitivityDb: 90 } });
    expect(specStatus(api.getState().devices[id]!, "sensitivityDb").basis).toBe("unverified");
    expect(specStatus(before, "sensitivityDb").basis).toBe("manufacturer");
    expect(profile.metadata.sensitivityDb).toBe(88);
  });
  it("rejects malformed evidence atomically and freezes nested entries", () => {
    expect(Object.isFrozen(parseEvidence({ sensitivityDb: evidence }).sensitivityDb)).toBe(true);
    for (const update of [{ value: NaN }, { basis: "certified" }, { source: "" }, { checkedOn: "2026-02-30" }])
      expect(() => parseEvidence({ sensitivityDb: { ...evidence, ...update } })).toThrow();
    expect(() => parseEvidence({ unexpected: evidence })).toThrow();
  });
  it("keeps manufacturer-backed simulations parametric and marks absent inputs explicitly", () => {
    const api = createDeviceStore(), id = api.getState().addDevice(deviceFromProfile(profile, 0, api.getState().room));
    const d = api.getState().devices[id]!;
    const report = simulationAccuracy([d], "pressure");
    expect(report.label).toBe("Parametric estimate");
    expect(report.supported).toBe(2);
    expect(report.unverified.some(s => s.includes("speakerWatts"))).toBe(true);
    expect(report.limitation).toContain("no measured polar-file engine");
    expect(simulationAccuracy([{ ...d, kind: "ptz_camera" }], "camera").missing).toHaveLength(2);
    expect(simulationAccuracy([], "display").label).toBe("Incomplete inputs");
  });
});
