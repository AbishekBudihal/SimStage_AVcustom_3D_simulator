import { describe, it, expect } from "vitest";
import * as T from "three";
import {
  DeviceStore,
  type PlacedDevice,
} from "../../src/workspace/DeviceStore";
import {
  DEFAULT_PRESSURE,
  pressureMap,
  signalBands,
  responseAt,
  soundPaths,
  segmentBlocked,
  parseBandText,
  type PressureSettings,
} from "../../src/workspace/PressureModel";
import {
  PressureOverlay,
  encodePressure,
} from "../../src/workspace/PressureOverlay";
const speaker: PlacedDevice = {
  id: "speaker",
  catalogId: "test",
  kind: "speaker",
  surface: "floor",
  position: { x: 0, y: 1, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  ports: [],
  metadata: {
    label: "Test source",
    powerWatts: null,
    heatBtuPerHour: null,
    rackUnits: null,
    sensitivityDb: 90,
    speakerWatts: 1,
    horizontalDispersionDeg: 360,
    verticalDispersionDeg: 360,
  },
};
const settings: PressureSettings = {
  ...DEFAULT_PRESSURE,
  signal: "sine",
  audienceHeight: 1,
  spacing: 1,
  obstruction: false,
};
function setup() {
  const store = new DeviceStore();
  store.api.getState().setRoom({ width: 4, depth: 4, height: 3, capacity: 0 });
  store.add(speaker);
  return store;
}
function value(store: DeviceStore, x: number, z: number, config = settings) {
  const result = pressureMap(store.api.getState(), config),
    p = result.surfaces[0];
  return p.levels[
    Math.round(((z + 2) * (p.rows - 1)) / 4) * p.columns +
      Math.round(((x + 2) * (p.columns - 1)) / 4)
  ]!;
}
describe("Parametric frequency-dependent pressure model", () => {
  it("matches reference sensitivity and inverse distance loss", () => {
    const store = setup();
    expect(value(store, 0, 1)).toBeCloseTo(90);
    expect(value(store, 0, 2)).toBeCloseTo(90 - 20 * Math.log10(2));
  });
  it("scales drive power logarithmically", () => {
    const store = setup();
    store.update("speaker", { metadata: { speakerWatts: 10 } });
    expect(value(store, 0, 1)).toBeCloseTo(100);
  });
  it("normalizes pink and speech energy over 1/12 octave integration bins", () => {
    for (const signal of ["pink", "speech"] as const) {
      const cfg = { ...settings, signal };
      const bands = signalBands(cfg);
      expect(bands.length).toBeGreaterThan(60);
      expect(bands.reduce((n, b) => n + b.weight, 0)).toBeCloseTo(1);
      expect(value(setup(), 0, 1, cfg)).toBeCloseTo(90);
    }
  });
  it("adds noise sources incoherently and sine sources coherently with phase/delay", () => {
    const store = setup();
    store.add({ ...speaker, id: "two" });
    expect(value(store, 0, 1, { ...settings, signal: "pink" })).toBeCloseTo(
      90 + 10 * Math.log10(2),
    );
    expect(value(store, 0, 1)).toBeCloseTo(90 + 20 * Math.log10(2));
    store.update("two", { metadata: { acousticPhaseDeg: 180 } });
    expect(value(store, 0, 1)).toBe(-120);
    store.update("two", {
      metadata: { acousticPhaseDeg: 0, acousticDelayMs: 0.5 },
    });
    expect(value(store, 0, 1)).toBe(-120);
  });
  it("uses full device rotation and -6 dB half-angle directivity", () => {
    const store = setup();
    store.update("speaker", {
      metadata: { horizontalDispersionDeg: 90, verticalDispersionDeg: 90 },
    });
    expect(value(store, 1, 1)).toBeCloseTo(
      90 - 6 - 20 * Math.log10(Math.sqrt(2)),
    );
    store.update("speaker", { rotation: { y: Math.PI / 2 } });
    expect(value(store, 1, 0)).toBeCloseTo(90);
    expect(value(store, 0, 1)).toBeCloseTo(66);
  });
  it("interpolates authored frequency response on a logarithmic axis and rejects extrapolation", () => {
    const store = setup();
    const bands = parseBandText("500, 80, 120, 100\n2000, 100, 60, 40")!;
    store.update("speaker", { metadata: { acousticBands: bands } });
    expect(responseAt(store.get("speaker")!, 1000)).toMatchObject({
      sensitivityDb: 90,
      horizontalDeg: 90,
      verticalDeg: 70,
    });
    expect(responseAt(store.get("speaker")!, 250)).toBeNull();
    expect(
      pressureMap(store.api.getState(), { ...settings, signal: "pink" })
        .unknown,
    ).toBeGreaterThan(0);
  });
  it("distinguishes unknown from muted/silent sources", () => {
    const store = setup();
    store.update("speaker", { metadata: { sensitivityDb: undefined } });
    expect(value(store, 0, 1)).toBeNull();
    store.update("speaker", { metadata: { speakerWatts: 0 } });
    expect(value(store, 0, 1)).toBe(-120);
    store.remove("speaker");
    expect(value(store, 0, 1)).toBeNull();
  });
  it("rejects invalid frequency/phase/settings inputs and freezes response rows", () => {
    const store = setup();
    expect(() => parseBandText("500,,90,90")).toThrow();
    expect(() => parseBandText("2000,90,90,90\n500,90,90,90")).toThrow();
    expect(() => store.api.getState().setPressure({ lowHz: 9000 })).toThrow();
    expect(() =>
      store.update("speaker", { metadata: { acousticDelayMs: -1 } }),
    ).toThrow();
    const bands = [
      { hz: 125, sensitivityDb: 90, horizontalDeg: 90, verticalDeg: 90 },
      { hz: 8000, sensitivityDb: 80, horizontalDeg: 60, verticalDeg: 60 },
    ];
    store.update("speaker", { metadata: { acousticBands: bands } });
    bands[0].sensitivityDb = 1;
    expect(store.get("speaker")!.metadata.acousticBands![0].sensitivityDb).toBe(
      90,
    );
  });
});
describe("Geometrical paths and audience surfaces", () => {
  it("clips segments against obstacle boxes without blocking endpoint surface contact", () => {
    const box = { min: { x: -1, y: 0, z: -1 }, max: { x: 1, y: 0.75, z: 1 } };
    expect(
      segmentBlocked({ x: 0, y: 2, z: 0 }, { x: 0, y: 0, z: 0 }, [box]),
    ).toBe(true);
    expect(
      segmentBlocked({ x: 0, y: 2, z: 0 }, { x: 0, y: 0.75, z: 0 }, [box]),
    ).toBe(false);
    expect(
      segmentBlocked({ x: 2, y: 2, z: 0 }, { x: 2, y: 0, z: 0 }, [box]),
    ).toBe(false);
  });
  it("finds first-order image-source paths within the room", () => {
    const paths = soundPaths(
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 1, z: 2 },
      { width: 6, depth: 6, height: 3 },
      [],
      true,
    );
    expect(paths).toHaveLength(7);
    expect(paths[0].distance).toBe(2);
    expect(
      paths.some(
        (p) => p.reflected && Math.abs(p.distance - Math.sqrt(8)) < 1e-6,
      ),
    ).toBe(true);
  });
  it("absorbing boundaries remove reflected energy", () => {
    const store = setup();
    const cfg = {
      ...settings,
      signal: "pink" as const,
      reflections: true,
      absorption: 1,
    };
    expect(value(store, 0, 1, cfg)).toBeCloseTo(
      value(store, 0, 1, { ...cfg, reflections: false }),
    );
    expect(value(store, 0, 1, { ...cfg, absorption: 0.3 })).toBeGreaterThan(
      value(store, 0, 1, cfg),
    );
  });
  it("samples real tabletop and floor elevations with table obstruction", () => {
    const store = setup();
    store.api.getState().setRoom({ capacity: 4 });
    store.update("speaker", { position: { y: 2 } });
    const result = pressureMap(store.api.getState(), {
      ...settings,
      surface: "surfaces",
      obstruction: true,
    });
    expect(result.surfaces.map((p) => p.id)).toEqual(["floor", "table:0"]);
    expect(result.surfaces[1].height).toBe(0.75);
    expect(result.blocked).toBeGreaterThan(0);
  });
  it("supports raked audience planes and rejects a plane above the ceiling", () => {
    const store = setup();
    const result = pressureMap(store.api.getState(), {
      ...settings,
      audienceRise: 0.5,
    });
    expect(result.surfaces[0].rise).toBe(0.5);
    expect(() =>
      pressureMap(store.api.getState(), { ...settings, audienceRise: 3 }),
    ).toThrow();
  });
});
describe("GPU pressure field packing and lifecycle", () => {
  it("preserves dB precision and unknown mask", () => {
    const packed = encodePressure([83.123, null, -120]);
    expect(((packed[0] * 256 + packed[1]) / 65535) * 300 - 120).toBeCloseTo(
      83.123,
      2,
    );
    expect(packed[2]).toBe(255);
    expect(packed[6]).toBe(0);
    expect(packed[10]).toBe(255);
  });
  it("reuses textures/meshes for live values and disposes disabled/replaced resources", () => {
    const scene = new T.Scene(),
      layer = new PressureOverlay(scene),
      store = setup(),
      result = pressureMap(store.api.getState(), settings);
    layer.update(result, settings);
    const mesh = layer.group.children[0] as T.Mesh<
        T.BufferGeometry,
        T.ShaderMaterial
      >,
      texture = mesh.material.uniforms.field.value as T.Texture;
    layer.update(result, { ...settings, minimumDb: 30 });
    expect(layer.group.children[0]).toBe(mesh);
    expect(mesh.material.uniforms.field.value).toBe(texture);
    expect(mesh.material.uniforms.low.value).toBe(30);
    layer.update(null, settings);
    expect(layer.group.visible).toBe(false);
    layer.dispose();
    expect(scene.children).toHaveLength(0);
  });
});
