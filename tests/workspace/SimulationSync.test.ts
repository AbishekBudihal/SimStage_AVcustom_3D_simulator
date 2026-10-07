import { describe, expect, it } from "vitest";
import { createDeviceStore, type PlacedDevice } from "../../src/workspace/DeviceStore";
import { roomLayout } from "../../src/workspace/RoomLayout";
import { freezeEnvironment, type ImportedEnvironment } from "../../src/workspace/EnvironmentImport";
import { simulationBlocker } from "../../src/workspace/SimulationGeometry";
import { cameraCoverage, displayViewing } from "../../src/workspace/OpticalEngineering";
import { analyzeAudio } from "../../src/workspace/AudioEngineering";
import { engineeringAudit } from "../../src/workspace/Engineering";
import { viewingField } from "../../src/workspace/ViewingField";
import { DEFAULT_SCENARIO, runScenarios } from "../../src/workspace/ScenarioSimulation";
const room = { width: 8, depth: 6, height: 3, capacity: 1 };
const seat = roomLayout(room).seats[0].position;
const base: PlacedDevice = {
  id: "camera", catalogId: "test", kind: "ptz_camera", surface: "north",
  position: { x: seat.x, y: seat.y, z: seat.z - 2 }, rotation: { x: 0, y: 0, z: 0 }, ports: [],
  metadata: { label: "Test", powerWatts: 10, heatBtuPerHour: 34, rackUnits: 0,
    horizontalFovDeg: 100, verticalFovDeg: 100, imageHeightM: 1,
    micModel: "radius_only", micRadiusM: 8, coverageDegrees: 120,
    referenceSplDb: 90, referenceDistanceM: 1 },
};
function environment(open = false): ImportedEnvironment {
  const y = seat.z - 1 + 3;
  return freezeEnvironment({ name: "Partition", width: 8, height: 6, metersPerUnit: 1,
    outlines: [{ id: "partition", kind: "wall", elevation: 0, height: 3,
      segment: { start: { x: 0, y }, end: { x: 8, y }, thickness: .2,
        openings: open ? [{ id: "door", kind: "door", offset: seat.x + 4 - .5, width: 1, bottom: 0, height: 2.5 }] : [] },
      points: [{ x: 0, y: y-.1 }, { x: 8, y: y-.1 }, { x: 8, y: y+.1 }, { x: 0, y: y+.1 }] }] });
}
function state() {
  const api = createDeviceStore();
  api.getState().setRoom(room);
  for (const kind of ["ptz_camera", "display", "ceiling_mic", "speaker"] as const)
    api.getState().addDevice({ ...base, id: kind, kind });
  return api;
}
describe("one active simulation geometry", () => {
  it("shares obstruction compilation across immutable snapshots and respects door openings", () => {
    const wall = environment();
    expect(simulationBlocker(wall)).toBe(simulationBlocker(wall));
    expect(simulationBlocker(wall)(base.position, seat)).toBe(true);
    expect(simulationBlocker(environment(true))(base.position, seat)).toBe(false);
  });
  it("updates camera, display, viewing shading, audio and audit when imported walls change", () => {
    const api = state();
    const clear = api.getState();
    expect(cameraCoverage(clear.devices.ptz_camera!, room).seats[0].status).toBe("inside");
    expect(displayViewing(clear.devices.display!, clear).seats[0].status).toBe("inside");
    api.getState().setEnvironment(environment());
    const blocked = api.getState();
    expect(cameraCoverage(blocked.devices.ptz_camera!, room, blocked.environment).seats[0].status).toBe("outside");
    expect(displayViewing(blocked.devices.display!, blocked).seats[0].status).toBe("outside");
    for (const kind of ["microphone", "speaker"] as const) {
      const analysis = analyzeAudio(blocked, kind);
      expect(analysis.seats[0].status).toBe("outside");
      expect(analysis.devices[0].seats[0].reasons).toContain("Direct path blocked by imported architecture");
    }
    expect(engineeringAudit(blocked, room).visual[0].results[0].obstructed).toBe(true);
    expect(viewingField(blocked)).not.toEqual(viewingField(clear));
    api.getState().setEnvironment(environment(true));
    expect(displayViewing(api.getState().devices.display!, api.getState()).seats[0].status).toBe("inside");
    expect(api.getState().devices).toBe(clear.devices);
    expect(api.getState().connections).toBe(clear.connections);
    api.getState().setEnvironment(null);
    expect(analyzeAudio(api.getState(), "microphone").seats[0].status).not.toBe("outside");
  });
  it("keeps an unobstructed speaker contribution and the audit/map values consistent", () => {
    const api = state();
    api.getState().setEnvironment(environment());
    api.getState().addDevice({ ...base, id: "second", kind: "speaker", position: { x: seat.x, y: seat.y, z: seat.z - .5 } });
    const current = api.getState();
    const audio = analyzeAudio(current, "speaker");
    expect(audio.seats[0].spl).not.toBeNull();
    expect(audio.seats[0].status).toBe("covered");
    expect(engineeringAudit(current, room).splMin).toBe(audio.range![0]);
    expect(engineeringAudit(current, room).field.map(p => p.spl)).toEqual(audio.field.map(p => p.spl));
  });
  it("stress tests fail blocked direct microphone paths and recover after removing the wall", () => {
    const api = state();
    const config = { ...DEFAULT_SCENARIO, iterations: 10, rt60Min: .2, rt60Max: .2,
      noiseMin: 20, noiseMax: 20, occupiedNoiseRise: 0, speechDb: 90, linkMbps: 1000 };
    expect(runScenarios(api.getState(), config).acousticPassPercent).toBe(100);
    api.getState().setEnvironment(environment());
    expect(runScenarios(api.getState(), config).acousticPassPercent).toBe(0);
    api.getState().setEnvironment(null);
    expect(runScenarios(api.getState(), config).acousticPassPercent).toBe(100);
  });
});
