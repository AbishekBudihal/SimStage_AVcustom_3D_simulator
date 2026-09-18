import { describe, it, expect } from "vitest";
import {
  cameraCoverage,
  displayViewing,
} from "../../src/workspace/OpticalEngineering";
import {
  roomLayout,
  DEFAULT_EYE_HEIGHT_M,
} from "../../src/workspace/RoomLayout";
import {
  createDeviceStore,
  type PlacedDevice,
  type RoomSize,
} from "../../src/workspace/DeviceStore";
import {
  filterCatalog,
  opticalMetadata,
} from "../../src/workspace/CatalogQuery";
import {
  INITIAL_CATALOG,
  parseCatalog,
  deviceFromProfile,
} from "../../src/workspace/catalog";
const room: RoomSize = { width: 8, depth: 6, height: 3, capacity: 1 };
const seat = roomLayout(room).seats[0].position;
const camera: PlacedDevice = {
  id: "cam",
  catalogId: "custom",
  kind: "ptz_camera",
  surface: "north",
  position: { x: seat.x, y: seat.y, z: seat.z - 2 },
  rotation: { x: 0, y: 0, z: 0 },
  ports: [],
  metadata: {
    label: "Test camera",
    powerWatts: null,
    heatBtuPerHour: null,
    rackUnits: null,
    horizontalFovDeg: 60,
    verticalFovDeg: 40,
  },
};
const result = (device: PlacedDevice) => cameraCoverage(device, room).seats[0];
describe("Camera deterministic geometry", () => {
  it("includes a point directly ahead and reports distance", () => {
    expect(result(camera)).toMatchObject({
      status: "inside",
      distance: 2,
      horizontalInside: true,
      verticalInside: true,
    });
  });
  it("excludes a point behind", () =>
    expect(
      result({ ...camera, rotation: { x: 0, y: Math.PI, z: 0 } }).front,
    ).toBe(false));
  it("excludes horizontal outliers", () =>
    expect(
      result({ ...camera, position: { ...camera.position, x: seat.x - 3 } })
        .horizontalInside,
    ).toBe(false));
  it("excludes vertical outliers", () =>
    expect(
      result({ ...camera, position: { ...camera.position, y: seat.y + 2 } })
        .verticalInside,
    ).toBe(false));
  it("changes horizontal result when FOV changes", () => {
    const d = { ...camera, position: { ...camera.position, x: seat.x - 2 } };
    expect(result(d).status).toBe("outside");
    expect(
      result({ ...d, metadata: { ...d.metadata, horizontalFovDeg: 120 } })
        .status,
    ).toBe("inside");
  });
  it("applies pitch and roll as well as yaw", () => {
    expect(
      result({ ...camera, rotation: { x: Math.PI / 2, y: 0, z: 0 } }).status,
    ).toBe("outside");
    const d = { ...camera, position: { ...camera.position, x: seat.x - 0.9 } };
    expect(result(d).status).toBe("inside");
    expect(
      result({ ...d, rotation: { x: 0, y: 0, z: Math.PI / 2 } }).status,
    ).toBe("outside");
  });
  it("does not count missing VFOV as full coverage", () =>
    expect(
      result({
        ...camera,
        metadata: { ...camera.metadata, verticalFovDeg: undefined },
      }).status,
    ).toBe("unknown"));
  it("clips the calculated frustum to all room boundaries and reacts to room size", () => {
    const a = cameraCoverage(camera, room),
      b = cameraCoverage(camera, { ...room, width: 12, depth: 10 });
    expect(a.faces.length).toBeGreaterThan(0);
    expect(JSON.stringify(a.faces)).not.toBe(JSON.stringify(b.faces));
    for (const p of a.faces.flat()) {
      expect(p.x).toBeGreaterThanOrEqual(-4 - 1e-7);
      expect(p.x).toBeLessThanOrEqual(4 + 1e-7);
      expect(p.y).toBeGreaterThanOrEqual(-1e-7);
      expect(p.y).toBeLessThanOrEqual(3 + 1e-7);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(3 + 1e-7);
    }
  });
  it("updates seat geometry from centralized eye height", () => {
    expect(seat.y).toBe(DEFAULT_EYE_HEIGHT_M);
    expect(
      cameraCoverage(camera, { ...room, eyeHeightM: 1.6 }).seats[0].position.y,
    ).toBe(1.6);
  });
});
const state = createDeviceStore().getState();
const display: PlacedDevice = {
  ...camera,
  id: "screen",
  kind: "display",
  metadata: { ...camera.metadata, imageHeightM: 1 },
};
const viewing = (d: PlacedDevice) =>
  displayViewing(d, { room, engineering: state.engineering }).seats[0];
describe("Display deterministic planning", () => {
  it("accepts a centered front seat", () =>
    expect(viewing(display)).toMatchObject({
      status: "inside",
      distance: 2,
      horizontal: 0,
    }));
  it("reports off-axis failure and reason", () => {
    const r = viewing({
      ...display,
      position: { ...display.position, x: seat.x - 4 },
    });
    expect(r.status).toBe("outside");
    expect(r.reasons.join()).toContain("Horizontal off-axis");
  });
  it("rejects a seat behind a rotated screen", () => {
    expect(
      viewing({ ...display, rotation: { x: 0, y: Math.PI, z: 0 } }).front,
    ).toBe(false);
  });
  it("reports 3D distance rather than silently using floor distance", () => {
    const r = viewing({
      ...display,
      position: { x: seat.x - 3, y: seat.y - 4, z: seat.z - 12 },
    });
    expect(r.distance).toBe(13);
  });
  it("accounts for screen front plane depth", () => {
    const r = viewing({ ...display, dimensions: { x: 1.7, y: 1, z: 0.1 } });
    expect(r.distance).toBeCloseTo(1.9);
  });
  it("returns Unknown for missing image size", () =>
    expect(
      viewing({
        ...display,
        metadata: { ...display.metadata, imageHeightM: undefined },
      }).status,
    ).toBe("unknown"));
});
describe("Catalog V2", () => {
  it("combines typed category, manufacturer and case-insensitive multiword search", () => {
    const p = filterCatalog(INITIAL_CATALOG, {
      category: "camera",
      manufacturer: "Yealink",
      query: "UVC84 yealink",
    });
    expect(p.map((p) => p.id)).toEqual(["yealink-uvc84"]);
    expect(
      filterCatalog(INITIAL_CATALOG, {
        category: "display",
        manufacturer: "Yealink",
        query: "",
      }),
    ).toEqual([]);
  });
  it("keeps diagonal FOV separate and unknown axes unknown", () => {
    const p = parseCatalog([
      {
        id: "test",
        manufacturer: "User",
        model: "test",
        category: "camera",
        physical: { width: 0.1, height: 0.1, depth: 0.1 },
        camera: { diagonalFovDeg: 90 },
      },
    ])[0];
    expect(opticalMetadata(p)).toMatchObject({
      diagonalFov: 90,
      hfov: null,
      vfov: null,
    });
    expect(p.metadata.horizontalFovDeg).toBeUndefined();
  });
  it("custom import, placement and device FOV edits use the same live store", () => {
    const api = createDeviceStore();
    api
      .getState()
      .importCatalog([
        {
          id: "custom-test",
          manufacturer: "User",
          model: "Camera",
          category: "camera",
          physical: { width: 0.1, height: 0.1, depth: 0.1 },
          camera: { horizontalFovDeg: 60, verticalFovDeg: 40 },
          provenance: "user_defined",
        },
      ]);
    const p = api.getState().catalog.find((p) => p.id === "custom-test")!;
    const id = api
      .getState()
      .addDevice(deviceFromProfile(p, 0, api.getState().room));
    api.getState().updateDevice(id, { metadata: { horizontalFovDeg: 100 } });
    expect(api.getState().devices[id]?.metadata.horizontalFovDeg).toBe(100);
    expect(p.metadata.horizontalFovDeg).toBe(60);
    expect(() =>
      api.getState().updateDevice(id, { metadata: { horizontalFovDeg: 180 } }),
    ).toThrow();
  });
  it("validates configurable eye height", () => {
    const api = createDeviceStore();
    api.getState().setRoom({ eyeHeightM: 1.1 });
    expect(roomLayout(api.getState().room).seats[0].position.y).toBe(1.1);
    expect(() => api.getState().setRoom({ eyeHeightM: NaN })).toThrow();
  });
});
