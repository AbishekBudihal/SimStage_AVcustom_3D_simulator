import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  DeviceStore,
  type MountSurface,
  type XYZ,
} from "../../src/workspace/DeviceStore";
import { useDeviceDrag } from "../../src/workspace/useDeviceDrag";
import type { CanvasManager } from "../../src/workspace/CanvasManager";

let cleanup = () => {};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function setup(
  surface: MountSurface = "floor",
  origin: XYZ = { x: 0, y: 0, z: 0 },
) {
  const listeners = new Map<string, (event: any) => void>();
  const windowListeners = new Map<string, (event: any) => void>();
  const captures = new Set<number>();
  const element = {
    style: { cursor: "grab" },
    getBoundingClientRect: () => ({
      left: 30,
      top: 20,
      width: 800,
      height: 600,
    }),
    setPointerCapture: (id: number) => captures.add(id),
    hasPointerCapture: (id: number) => captures.has(id),
    releasePointerCapture: (id: number) => captures.delete(id),
    addEventListener: (name: string, fn: (event: any) => void) =>
      listeners.set(name, fn),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  vi.stubGlobal("window", {
    addEventListener: (name: string, fn: (event: any) => void) =>
      windowListeners.set(name, fn),
    removeEventListener: (name: string) => windowListeners.delete(name),
  });
  const camera = new THREE.OrthographicCamera(-4, 4, 3, -3, 0.1, 100);
  camera.position.set(8, 8, 8);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const scene = new THREE.Scene();
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshBasicMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(origin.x, origin.y, origin.z);
  mesh.userData.deviceId = "one";
  scene.add(mesh);
  const store = new DeviceStore();
  store.add({
    id: "one",
    catalogId: "one",
    kind: "rack",
    surface,
    position: origin,
    rotation: { x: 0, y: 0, z: 0 },
    ports: [],
    metadata: {
      label: "Rack",
      powerWatts: null,
      heatBtuPerHour: null,
      rackUnits: null,
    },
  });
  const dispose = useDeviceDrag(
    {
      renderer: { domElement: element },
      camera,
      scene,
      pickTargets: [mesh],
      get room() {
        return store.api.getState().room;
      },
    } as unknown as CanvasManager,
    store,
  );
  cleanup = () => {
    dispose();
    geometry.dispose();
    material.dispose();
  };
  function pointer(name: string, point: XYZ, pointerId = 1, altKey = false) {
    const screen = new THREE.Vector3(point.x, point.y, point.z).project(camera);
    listeners.get(name)?.({
      clientX: 30 + (screen.x + 1) * 400,
      clientY: 20 + (1 - screen.y) * 300,
      pointerId,
      altKey,
      isPrimary: true,
      button: 0,
      preventDefault: vi.fn(),
    });
  }
  return {
    store,
    pointer,
    element,
    captures,
    listeners,
    windowListeners,
    dispose,
  };
}

describe("device dragging with real Three.js ray intersections", () => {
  it("does not restore old room coordinates when a preset changes during drag", () => {
    const origin = { x: 0, y: 1, z: -3 },
      test = setup("north", origin);
    test.pointer("pointerdown", origin);
    test.store.api.getState().setRoomPreset("huddle");
    test.windowListeners.get("keydown")?.({
      key: "Escape",
      preventDefault: vi.fn(),
    });
    expect(test.store.get("one")!.position.z).toBe(-1.5);
    expect(test.captures.size).toBe(0);
  });
  it("remounts a table device with Alt-drag and restores surface on Escape", () => {
    const origin = { x: 0, y: 0.75, z: 0 };
    const test = setup("table", origin);
    test.store.update("one", { kind: "ptz_camera" });
    test.pointer("pointerdown", origin);
    test.pointer("pointermove", { x: 0, y: 1.5, z: -3 }, 1, true);
    expect(test.store.get("one")?.surface).toBe("north");
    expect(test.store.get("one")?.position.z).toBe(-3);
    test.windowListeners.get("keydown")?.({
      key: "Escape",
      preventDefault: vi.fn(),
    });
    expect(test.store.get("one")?.surface).toBe("table");
    expect(test.store.get("one")?.position).toEqual(origin);
  });
  it.each<MountSurface>(["floor", "ceiling", "north", "south", "east", "west"])(
    "snaps movement on %s and rolls back with Escape",
    (surface) => {
      const origin = {
        x: surface === "east" ? 4 : surface === "west" ? -4 : 0,
        y: surface === "ceiling" ? 3 : surface === "floor" ? 0 : 1,
        z: surface === "north" ? -3 : surface === "south" ? 3 : 0,
      };
      const test = setup(surface, origin);
      test.pointer("pointerdown", origin);
      expect(test.captures.has(1)).toBe(true);
      const target = {
        x: origin.x + (surface === "east" || surface === "west" ? 0 : 0.74),
        y: origin.y + (surface === "floor" || surface === "ceiling" ? 0 : 0.74),
        z: origin.z + (surface === "north" || surface === "south" ? 0 : 0.74),
      };
      test.pointer("pointermove", target);
      const position = test.store.get("one")!.position;
      expect(position.x).toBeCloseTo(
        origin.x + (target.x === origin.x ? 0 : 0.5),
      );
      expect(position.y).toBeCloseTo(
        origin.y + (target.y === origin.y ? 0 : 0.5),
      );
      expect(position.z).toBeCloseTo(
        origin.z + (target.z === origin.z ? 0 : 0.5),
      );
      test.windowListeners.get("keydown")?.({
        key: "Escape",
        preventDefault: vi.fn(),
      });
      expect(test.store.get("one")!.position).toEqual(origin);
      expect(test.captures.size).toBe(0);
      expect(test.element.style.cursor).toBe("grab");
      test.pointer("pointerup", target);
      expect(test.store.get("one")!.position).toEqual(origin);
    },
  );
  it("preserves grab offset, ignores other pointers and commits on release", () => {
    const test = setup();
    test.pointer("pointerdown", { x: 0.2, y: 0, z: 0 });
    test.pointer("pointermove", { x: 1, y: 0, z: 0 }, 2);
    expect(test.store.get("one")!.position.x).toBe(0);
    test.pointer("pointerup", { x: 0.8, y: 0, z: 0 });
    expect(test.store.get("one")!.position.x).toBe(0.5);
    test.windowListeners.get("keydown")?.({
      key: "Escape",
      preventDefault: vi.fn(),
    });
    expect(test.store.get("one")!.position.x).toBe(0.5);
  });
  it("does not snap an off-grid asset on a plain click", () => {
    const origin = { x: 0.13, y: 0, z: 0.12 };
    const test = setup("floor", origin);
    test.pointer("pointerdown", origin);
    test.pointer("pointerup", origin);
    expect(test.store.get("one")!.position).toEqual(origin);
  });
  it("rolls back on cleanup and removes every listener", () => {
    const test = setup();
    test.pointer("pointerdown", { x: 0, y: 0, z: 0 });
    test.pointer("pointermove", { x: 1, y: 0, z: 0 });
    test.dispose();
    test.dispose();
    expect(test.store.get("one")!.position.x).toBe(0);
    expect(test.listeners.size + test.windowListeners.size).toBe(0);
    expect(test.captures.size).toBe(0);
  });
});
