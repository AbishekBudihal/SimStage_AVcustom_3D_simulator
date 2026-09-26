import { describe, it, expect } from "vitest";
import {
  analyzeAudio,
  microphonePoint,
  speakerPoint,
  directSpl,
  combineLevels,
  unionCoverage,
} from "../../src/workspace/AudioEngineering";
import {
  createDeviceStore,
  type PlacedDevice,
  type RoomSize,
} from "../../src/workspace/DeviceStore";
import { roomLayout } from "../../src/workspace/RoomLayout";
import { parseCatalog, INITIAL_CATALOG } from "../../src/workspace/catalog";
const room: RoomSize = { width: 8, depth: 6, height: 3, capacity: 1 };
const base: PlacedDevice = {
  id: "a",
  catalogId: "test",
  kind: "ceiling_mic",
  surface: "north",
  position: { x: 0, y: 1.2, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  ports: [],
  metadata: {
    label: "A",
    powerWatts: null,
    heatBtuPerHour: null,
    rackUnits: null,
    micModel: "cone",
    micRadiusM: 4,
    micAngleDeg: 90,
  },
};
const at = (x: number, y = 1.2, z = 2) => ({ x, y, z });
const speaker: PlacedDevice = {
  ...base,
  kind: "speaker",
  metadata: {
    ...base.metadata,
    horizontalDispersionDeg: 90,
    verticalDispersionDeg: 60,
    referenceSplDb: 90,
    referenceDistanceM: 1,
  },
};
describe("Microphone preferred pickup geometry", () => {
  it("covers a point directly ahead", () =>
    expect(microphonePoint(base, at(0))).toMatchObject({
      status: "covered",
      distance: 2,
    }));
  it("excludes points behind the microphone", () =>
    expect(microphonePoint(base, at(0, 1.2, -2)).status).toBe("outside"));
  it("defines edge at the outer 10 percent and includes the exact radius", () => {
    expect(microphonePoint(base, at(0, 1.2, 3.6)).status).toBe("edge");
    expect(microphonePoint(base, at(0, 1.2, 4)).status).toBe("edge");
    expect(microphonePoint(base, at(0, 1.2, 4.01)).status).toBe("outside");
  });
  it("rotates a directional model with yaw", () =>
    expect(
      microphonePoint({ ...base, rotation: { x: 0, y: Math.PI, z: 0 } }, at(0))
        .status,
    ).toBe("outside"));
  it("uses downward ceiling orientation and seated voice height", () =>
    expect(
      microphonePoint(
        { ...base, surface: "ceiling", position: { x: 0, y: 3, z: 0 } },
        at(0, 1.2, 0),
      ),
    ).toMatchObject({ status: "covered", distance: 1.8 }));
  it("omni coverage ignores orientation", () =>
    expect(
      microphonePoint(
        {
          ...base,
          metadata: { ...base.metadata, micModel: "omni" },
          rotation: { x: 1, y: 2, z: 3 },
        },
        at(0, 1.2, -2),
      ).status,
    ).toBe("covered"));
  it("does not infer coverage from a pattern string alone", () =>
    expect(
      microphonePoint(
        {
          ...base,
          metadata: {
            ...base.metadata,
            micModel: undefined,
            micPattern: "cardioid",
          },
        },
        at(0),
      ).status,
    ).toBe("unknown"));
  it("keeps missing radius unknown", () =>
    expect(
      microphonePoint(
        { ...base, metadata: { ...base.metadata, micRadiusM: undefined } },
        at(0),
      ).status,
    ).toBe("unknown"));
  it("combines microphones by explicit coverage union", () => {
    expect(unionCoverage(["outside", "covered"])).toBe("covered");
    expect(unionCoverage(["outside", "unknown"])).toBe("unknown");
    expect(unionCoverage(["edge", "unknown"])).toBe("edge");
    expect(unionCoverage([])).toBe("unknown");
  });
});
describe("Speaker geometry and free-field estimates", () => {
  it("clips rectangular dispersion geometry to the room envelope", () => {
    const result = analyzeAudio({ room, devices: { a: speaker } }, "speaker");
    const points = result.devices[0].segments.flat();
    expect(points.length).toBeGreaterThan(0);
    for (const p of points) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(room.width / 2 + 1e-8);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(room.depth / 2 + 1e-8);
      expect(p.y).toBeGreaterThanOrEqual(-1e-8);
      expect(p.y).toBeLessThanOrEqual(room.height + 1e-8);
    }
  });
  it("includes points inside both dispersion angles", () =>
    expect(speakerPoint(speaker, at(0))).toMatchObject({
      status: "covered",
      spl: 90 - 20 * Math.log10(2),
    }));
  it("excludes horizontal and vertical outliers separately", () => {
    expect(speakerPoint(speaker, at(3)).reasons).toContain(
      "Outside horizontal dispersion",
    );
    expect(speakerPoint(speaker, at(0, 4.2)).reasons).toContain(
      "Outside vertical dispersion",
    );
  });
  it("honors yaw and pitch", () => {
    expect(
      speakerPoint({ ...speaker, rotation: { x: 0, y: Math.PI, z: 0 } }, at(0))
        .status,
    ).toBe("outside");
    expect(
      speakerPoint(
        { ...speaker, rotation: { x: Math.PI / 2, y: 0, z: 0 } },
        at(0, -0.8, 0),
      ).status,
    ).toBe("covered");
  });
  it("loses 6.0206 dB per distance doubling on axis", () =>
    expect(
      directSpl([speaker], at(0, 1.2, 2))! -
        directSpl([speaker], at(0, 1.2, 4))!,
    ).toBeCloseTo(6.0206, 4));
  it("honors reference distance and clamps the near field", () => {
    const d = {
      ...speaker,
      metadata: { ...speaker.metadata, referenceDistanceM: 2 },
    };
    expect(directSpl([d], at(0, 1.2, 1))).toBe(90);
    expect(directSpl([d], at(0, 1.2, 4))).toBeCloseTo(83.9794, 4);
  });
  it("uses minus 6 dB at the nominal conical half-angle", () => {
    const d = {
      ...speaker,
      metadata: {
        ...speaker.metadata,
        horizontalDispersionDeg: undefined,
        verticalDispersionDeg: undefined,
        coverageDegrees: 90,
      },
    };
    expect(speakerPoint(d, at(Math.SQRT1_2, 1.2, Math.SQRT1_2))).toMatchObject({
      status: "edge",
    });
    expect(directSpl([d], at(Math.SQRT1_2, 1.2, Math.SQRT1_2))).toBeCloseTo(84);
  });
  it("does not use a maximum rating as an operating level", () =>
    expect(
      speakerPoint(
        {
          ...speaker,
          metadata: {
            ...speaker.metadata,
            referenceSplDb: undefined,
            maxSpl: 120,
          },
        },
        at(0),
      ).spl,
    ).toBeNull());
  it("requires the distance for an explicit reference", () =>
    expect(
      speakerPoint(
        {
          ...speaker,
          metadata: { ...speaker.metadata, referenceDistanceM: undefined },
        },
        at(0),
      ).spl,
    ).toBeNull());
  it("requires both H and V when rectangular dispersion is specified", () =>
    expect(
      speakerPoint(
        {
          ...speaker,
          metadata: {
            ...speaker.metadata,
            verticalDispersionDeg: undefined,
            coverageDegrees: 90,
          },
        },
        at(0),
      ),
    ).toMatchObject({ status: "unknown", spl: null }));
  it("derives source level from sensitivity and explicit drive power", () =>
    expect(
      directSpl(
        [
          {
            ...speaker,
            metadata: {
              ...speaker.metadata,
              referenceSplDb: undefined,
              sensitivityDb: 85,
              speakerWatts: 10,
            },
          },
        ],
        at(0, 1.2, 1),
      ),
    ).toBe(95));
  it("sums equal sources energetically", () => {
    expect(combineLevels([80, 80])).toBeCloseTo(83.0103, 4);
    expect(directSpl([speaker, speaker], at(0, 1.2, 1))).toBeCloseTo(
      93.0103,
      4,
    );
  });
  it("keeps combined SPL unknown with an unquantified contributor", () => {
    const b = {
      ...speaker,
      id: "b",
      metadata: { ...speaker.metadata, referenceSplDb: undefined },
    };
    const r = analyzeAudio({ room, devices: { a: speaker, b } }, "speaker");
    expect(r.range).toBeNull();
    expect(r.field.every((s) => s.spl === null)).toBe(true);
    expect(r.missingSplDevices).toContain("A");
  });
  it("excludes a known muted contributor from level summation", () => {
    const b = {
      ...speaker,
      id: "b",
      metadata: { ...speaker.metadata, speakerWatts: 0 },
    };
    const single = analyzeAudio({ room, devices: { a: speaker } }, "speaker");
    expect(
      analyzeAudio({ room, devices: { a: speaker, b } }, "speaker").range,
    ).toEqual(single.range);
  });
});
describe("Audio store, catalog and sampling integration", () => {
  it("maps supplied directional sector metadata without inventing angle", () => {
    const m = INITIAL_CATALOG.find(
      (p) => p.id === "placeholder-directional-sector",
    )!;
    expect(m.metadata).toMatchObject({
      micModel: "horizontal_sector",
      micAngleDeg: 90,
    });
  });
  it("validates audio metadata before catalog publication", () =>
    expect(() =>
      parseCatalog([
        {
          id: "bad",
          manufacturer: "Test",
          model: "Invalid",
          category: "speaker",
          physical: { width: 0.2, height: 0.2, depth: 0.2 },
          speaker: { referenceSplDb: 181 },
        },
      ]),
    ).toThrow());
  it("changes seats, field extents and voice height with live room geometry", () => {
    const a = analyzeAudio({ room, devices: { a: base } }, "microphone"),
      large = { ...room, width: 10, depth: 8, capacity: 6, eyeHeightM: 1.5 };
    const b = analyzeAudio({ room: large, devices: { a: base } }, "microphone");
    expect(b.field.length).toBeGreaterThan(a.field.length);
    expect(b.seats.length).toBe(6);
    expect(b.seats.every((s) => s.position.y === 1.5)).toBe(true);
  });
  it("reacts to immutable store position, rotation and metadata changes", () => {
    const store = createDeviceStore();
    store.getState().setRoom(room);
    const seat = roomLayout(room).seats[0].position;
    store
      .getState()
      .addDevice({ ...base, position: { ...seat, z: seat.z - 2 } });
    const analyze = () =>
      analyzeAudio(store.getState(), "microphone").seats[0].status;
    expect(analyze()).toBe("covered");
    store.getState().updateDevice("a", { rotation: { y: Math.PI } });
    expect(analyze()).toBe("outside");
    store.getState().updateDevice("a", { metadata: { micModel: "omni" } });
    expect(analyze()).toBe("covered");
    store.getState().updateDevice("a", { position: { z: seat.z - 5 } });
    expect(analyze()).toBe("outside");
  });
});
