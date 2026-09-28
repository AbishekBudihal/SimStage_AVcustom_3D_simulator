import { describe, it, expect } from "vitest";
import {
  DeviceStore,
  type PlacedDevice,
} from "../../src/workspace/DeviceStore";
import {
  DEFAULT_SCENARIO,
  runScenarios,
  trafficMbps,
  signalAudit,
  validateScenario,
} from "../../src/workspace/ScenarioSimulation";
const mic: PlacedDevice = {
  id: "mic",
  catalogId: "test",
  kind: "ceiling_mic",
  surface: "ceiling",
  position: { x: 0, y: 3, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  ports: [{ id: "out", label: "Dante", signal: "Dante", direction: "output" }],
  metadata: {
    label: "Test mic",
    powerWatts: 10,
    heatBtuPerHour: 20,
    rackUnits: 0,
    micRadiusM: 20,
    micModel: "omni",
  },
};
function setup() {
  const store = new DeviceStore();
  store.add(mic);
  return store;
}
const config = {
  ...DEFAULT_SCENARIO,
  iterations: 100,
  noiseMin: 20,
  noiseMax: 20,
  occupiedNoiseRise: 0,
  rt60Min: 0.1,
  rt60Max: 0.1,
  linkMbps: 1000,
  extraFlowsMin: 0,
  extraFlowsMax: 0,
};
describe("Seeded scenario simulation", () => {
  it("is repeatable and passes a fully specified simple modeled policy", () => {
    const s = setup().api.getState(),
      a = runScenarios(s, config),
      b = runScenarios(s, config);
    expect(a).toEqual(b);
    expect(a.status).toBe("pass");
    expect(a.passPercent).toBe(100);
  });
  it("never passes missing room acoustic or link parameters", () => {
    const r = runScenarios(setup().api.getState(), DEFAULT_SCENARIO);
    expect(r.status).toBe("unverified");
    expect(r.unknownTrials).toBe(DEFAULT_SCENARIO.iterations);
  });
  it("fails high noise and improves with low noise using identical seat samples", () => {
    const s = setup().api.getState();
    expect(
      runScenarios(s, { ...config, noiseMin: 90, noiseMax: 90 })
        .acousticPassPercent,
    ).toBe(0);
    expect(runScenarios(s, config).acousticPassPercent).toBe(100);
  });
  it("fails a known geometric miss without inventing STI", () => {
    const store = setup();
    store.update("mic", { metadata: { micRadiusM: 0.1 } });
    const r = runScenarios(store.api.getState(), {
      ...config,
      rt60Min: null,
      rt60Max: null,
    });
    expect(r.status).toBe("fail");
    expect(r.minProxy).toBeNull();
  });
  it("detects saturated links and budgets extra flows", () => {
    const r = runScenarios(setup().api.getState(), {
      ...config,
      extraFlowsMin: 20,
      extraFlowsMax: 20,
      linkMbps: 100,
    });
    expect(r.p95Mbps).toBe(120);
    expect(r.networkPassPercent).toBe(0);
    expect(r.status).toBe("fail");
  });
  it("uses changed seating coordinates and makes empty rooms unverified", () => {
    const store = setup();
    store.update("mic", { metadata: { micRadiusM: 2.5 } });
    const before = runScenarios(store.api.getState(), {
      ...config,
      occupancyMin: 100,
      occupancyMax: 100,
    });
    store.api.getState().setRoom({ capacity: 0 });
    const empty = runScenarios(store.api.getState(), config);
    expect(before.acousticPassPercent).toBeLessThan(100);
    expect(empty.status).toBe("unverified");
  });
  it("validates trial limits and ordered ranges at the store boundary", () => {
    const store = setup();
    expect(() =>
      store.api.getState().setScenario({ iterations: 5001 }),
    ).toThrow();
    expect(() =>
      validateScenario({ ...config, noiseMin: 80, noiseMax: 20 }),
    ).toThrow();
    expect(() => validateScenario({ ...config, linkMbps: NaN })).toThrow();
  });
  it("makes incomplete device port definitions unverified even when trials pass", () => {
    const store = setup();
    store.update("mic", { ports: [] });
    const r = runScenarios(store.api.getState(), config);
    expect(r.passPercent).toBe(100);
    expect(r.status).toBe("unverified");
  });
});
describe("Dante declarations and signal audit", () => {
  it("rounds channel groups and counts unicast receivers", () => {
    expect(trafficMbps({ channels: 1, sampleRate: 48000, receivers: 1 })).toBe(
      6,
    );
    expect(trafficMbps({ channels: 5, sampleRate: 48000, receivers: 2 })).toBe(
      24,
    );
    expect(trafficMbps({ channels: 4, sampleRate: 96000, receivers: 1 })).toBe(
      12,
    );
  });
  it("follows live schematic wiring, distinguishes undeclared traffic and removes deleted links", () => {
    const store = setup();
    store.add({
      ...mic,
      id: "sink",
      kind: "dsp",
      ports: [
        {
          id: "in",
          label: "Dante",
          signal: "Dante",
          direction: "input",
          required: true,
        },
      ],
    });
    expect(signalAudit(store.api.getState()).missingRequired).toHaveLength(1);
    const id = store.api
      .getState()
      .connect(
        { deviceId: "mic", portId: "out" },
        { deviceId: "sink", portId: "in" },
      );
    expect(signalAudit(store.api.getState()).unknownTraffic).toBe(1);
    expect(runScenarios(store.api.getState(), config).status).toBe(
      "unverified",
    );
    store.api
      .getState()
      .setConnectionTraffic(id, {
        channels: 8,
        sampleRate: 48000,
        receivers: 1,
      });
    expect(signalAudit(store.api.getState()).knownMbps).toBe(12);
    expect(runScenarios(store.api.getState(), config).status).toBe("pass");
    store.api.getState().disconnect(id);
    expect(signalAudit(store.api.getState()).knownMbps).toBe(0);
    expect(runScenarios(store.api.getState(), config).status).toBe("fail");
  });
  it("recognizes imported Dante labels on physical Ethernet ports without inventing traffic", () => {
    const store = setup();
    store.update("mic", {
      ports: [
        {
          id: "out",
          label: "DANTE / NETWORK",
          signal: "ethernet",
          direction: "output",
        },
      ],
    });
    store.add({
      ...mic,
      id: "sink",
      ports: [
        {
          id: "in",
          label: "DANTE / NETWORK",
          signal: "ethernet",
          direction: "input",
        },
      ],
    });
    const id = store.api
      .getState()
      .connect(
        { deviceId: "mic", portId: "out" },
        { deviceId: "sink", portId: "in" },
      );
    expect(signalAudit(store.api.getState()).unknownTraffic).toBe(1);
    store.api
      .getState()
      .setConnectionTraffic(id, {
        channels: 4,
        sampleRate: 48000,
        receivers: 1,
      });
    expect(signalAudit(store.api.getState()).knownMbps).toBe(6);
  });
  it("rejects invalid subscription data", () => {
    expect(() =>
      trafficMbps({ channels: 0, sampleRate: 48000, receivers: 1 }),
    ).toThrow();
    expect(() =>
      trafficMbps({ channels: 4, sampleRate: 48000, receivers: 1.5 }),
    ).toThrow();
    expect(() =>
      setup()
        .api.getState()
        .setConnectionTraffic("missing", {
          channels: 4,
          sampleRate: 48000,
          receivers: 1,
        }),
    ).toThrow();
  });
});
