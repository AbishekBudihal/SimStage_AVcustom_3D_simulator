import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { CanvasManager } from "../../src/workspace/CanvasManager";
import type { PlacedDevice } from "../../src/workspace/DeviceStore";

import { ROOM_PRESETS } from "../../src/workspace/RoomPresets";
import { createWorkspace } from "../../src/workspace/createWorkspace";
import { engineeringAudit } from "../../src/workspace/Engineering";
const mocks = vi.hoisted(() => ({
  render: vi.fn(),
  dispose: vi.fn(),
  disconnect: vi.fn(),
  listeners: new Map<string, (event: unknown) => void>(),
}));
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  return {
    ...actual,
    WebGLRenderer: class {
      domElement = {
        style: { cssText: "" },
        setPointerCapture: vi.fn(),
        hasPointerCapture: () => false,
        releasePointerCapture: vi.fn(),
        remove: vi.fn(),
        getBoundingClientRect: () => ({
          left: 0,
          top: 0,
          width: 800,
          height: 600,
        }),
        addEventListener: (
          name: string,
          listener: (event: unknown) => void,
        ) => {
          const previous = mocks.listeners.get(name);
          mocks.listeners.set(
            name,
            previous
              ? (event) => {
                  previous(event);
                  listener(event);
                }
              : listener,
          );
        },
        removeEventListener: (name: string) => mocks.listeners.delete(name),
      };
      setClearColor = vi.fn();
      setPixelRatio = vi.fn();
      setSize = vi.fn();
      render = mocks.render;
      dispose = mocks.dispose;
    },
  };
});
const device: PlacedDevice = {
  id: "one",
  catalogId: "rack",
  kind: "rack",
  surface: "floor",
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  ports: [],
  metadata: {
    label: "Rack",
    powerWatts: null,
    heatBtuPerHour: null,
    rackUnits: 42,
  },
};
let manager: CanvasManager;
let frames: Map<number, FrameRequestCallback>;
let onSelect: ReturnType<typeof vi.fn>;
function flush() {
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach((callback) => callback(performance.now()));
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.listeners.clear();
  frames = new Map();
  let nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("window", {
    devicePixelRatio: 3,
    matchMedia: () => ({ matches: false }),
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect = mocks.disconnect;
    },
  );
  const host = {
    appendChild: vi.fn(),
    getBoundingClientRect: () => ({ width: 800, height: 600 }),
  } as unknown as HTMLElement;
  onSelect = vi.fn();
  manager = new CanvasManager(host, { onSelect });
  flush();
});
afterEach(() => {
  manager.dispose();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("CanvasManager", () => {
  it("resizes the shadow camera and releases procedural textures when rooms change", () => {
    const textures = new Set<THREE.Texture>();
    manager.scene.getObjectByName("Architectural room")!.traverse((o) => {
      if (
        o instanceof THREE.Mesh &&
        o.material instanceof THREE.MeshStandardMaterial &&
        o.material.map
      )
        textures.add(o.material.map);
    });
    expect(textures.size).toBeGreaterThan(0);
    const disposals = [...textures].map((t) => vi.spyOn(t, "dispose"));
    const light = manager.scene.children.find(
      (o) => o instanceof THREE.DirectionalLight,
    ) as THREE.DirectionalLight;
    const oldRight = light.shadow.camera.right;
    manager.setRoom({ width: 14, depth: 8, height: 3.5 });
    expect(light.shadow.camera.right).toBeGreaterThan(oldRight);
    expect(light.shadow.mapSize.x).toBe(2048);
    disposals.forEach((dispose) => expect(dispose).toHaveBeenCalledTimes(1));
  });
  it("disposes replaced room resources and preserves renderer and device objects", () => {
    manager.syncDevices([device], null);
    const mesh = manager.pickTargets[0],
      renderer = manager.renderer;
    const old = manager.scene.getObjectByName("Architectural room")!;
    const dispose = vi.spyOn(
      (old.children[0] as THREE.Mesh).geometry,
      "dispose",
    );
    manager.setRoom(ROOM_PRESETS.training.room);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(manager.renderer).toBe(renderer);
    expect(manager.pickTargets[0]).toBe(mesh);
    expect(manager.scene.children).not.toContain(old);
    manager.setRoom(ROOM_PRESETS.training.room);
    expect(dispose).toHaveBeenCalledTimes(1);
  });
  it("updates and reuses visual instances, replacing them only when seating count changes", () => {
    const store = createWorkspace();
    const audit = () =>
      engineeringAudit(store.api.getState(), store.api.getState().room);
    manager.setVisualOverlay(true, audit().visual);
    const layer = manager.scene.getObjectByName(
      "Visual planning seat markers",
    ) as THREE.InstancedMesh;
    const dispose = vi.spyOn(layer.geometry, "dispose");
    const color = new THREE.Color();
    layer.getColorAt(0, color);
    expect(color.getHex()).toBe(0x26d99a);
    store.api.getState().setEngineering({ viewingRatio: 4 });
    manager.setVisualOverlay(true, audit().visual);
    expect(manager.scene.children).toContain(layer);
    layer.getColorAt(6, color);
    expect(color.getHex()).toBe(0xf45363);
    store.api.getState().setRoomPreset("training");
    manager.setVisualOverlay(true, audit().visual);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(
      (
        manager.scene.getObjectByName(
          "Visual planning seat markers",
        ) as THREE.InstancedMesh
      ).count,
    ).toBe(24);
  });
  it("reuses the instanced heatmap and does not allocate or render a disabled layer", () => {
    const field = [
      { x: 0, z: 0, spl: 70, intelligibility: 0.7 },
      { x: 1, z: 0, spl: null, intelligibility: null },
    ];
    manager.setHeatmap("off", field);
    expect(
      manager.scene.children.some(
        (child) => child instanceof THREE.InstancedMesh,
      ),
    ).toBe(false);
    manager.setHeatmap("spl", field);
    const layer = manager.scene.children.find(
      (child) => child instanceof THREE.InstancedMesh,
    ) as THREE.InstancedMesh;
    expect(layer.count).toBe(2);
    const unknown = new THREE.Color();
    layer.getColorAt(1, unknown);
    expect(unknown.getHex()).toBe(0x526172);
    manager.setHeatmap("intelligibility", field);
    expect(manager.scene.children.includes(layer)).toBe(true);
    manager.setHeatmap("off");
    flush();
    expect(layer.visible).toBe(false);
    manager.setHeatmap("off", field);
    expect(frames.size).toBe(0);
  });
  it("snaps between perspective seat and orthographic overview cameras", () => {
    manager.setView("seat", false);
    expect(manager.camera).toBeInstanceOf(THREE.PerspectiveCamera);
    expect(manager.camera.position.y).toBe(1.2);
    expect(manager.camera.getWorldDirection(new THREE.Vector3()).z).toBeCloseTo(
      -1,
    );
    flush();
    expect(frames.size).toBe(0);
    manager.setView("plan", false);
    expect(manager.camera).toBeInstanceOf(THREE.OrthographicCamera);
    expect(manager.camera.position.x).toBe(0);
    manager.setView("isometric", false);
    expect(manager.camera.position.x).toBeCloseTo(
      manager.camera.position.y - manager.room.height / 2,
    );
    flush();
    expect(frames.size).toBe(0);
  });
  it("uses dark background, required lights and half-metre grid lines", () => {
    expect((manager.scene.background as THREE.Color).getHexString()).toBe(
      "202b35",
    );
    expect(
      manager.scene.children.some(
        (child) => child instanceof THREE.AmbientLight,
      ),
    ).toBe(true);
    expect(
      manager.scene.children.some(
        (child) => child instanceof THREE.DirectionalLight,
      ),
    ).toBe(true);
    const grid = manager.scene.children.find(
      (child) => child instanceof THREE.GridHelper,
    ) as THREE.GridHelper;
    const positions = grid.geometry.getAttribute("position");
    expect(positions.getZ(4) - positions.getZ(0)).toBe(0.5);
  });
  it("reuses meshes, batches updates and schedules no idle frames", () => {
    manager.syncDevices([device], null);
    const mesh = manager.pickTargets[0] as THREE.Mesh;
    const geometry = mesh.geometry;
    manager.syncDevices([{ ...device, position: { x: 1, y: 0, z: 0 } }], null);
    expect(manager.pickTargets[0]).toBe(mesh);
    expect(mesh.geometry).toBe(geometry);
    expect(mesh.position.x).toBe(1);
    expect(frames.size).toBe(1);
    flush();
    expect(frames.size).toBe(0);
  });
  it("isolates selection materials and removes deleted meshes", () => {
    const other = { ...device, id: "two" };
    manager.syncDevices([device, other], "one");
    const [first, second] = manager.pickTargets as THREE.Mesh[];
    expect(first.material).not.toBe(second.material);
    manager.syncDevices([device, other], null);
    expect(first.material).toBe(second.material);
    flush();
    manager.syncDevices([device, other], null);
    expect(frames.size).toBe(0);
    manager.syncDevices([other], null);
    expect(manager.pickTargets).toEqual([second]);
  });
  it("raycasts selection and clears selection on empty space", () => {
    manager.syncDevices([device], null);
    manager.setView("plan", false);
    mocks.listeners.get("pointerdown")?.({
      isPrimary: true,
      button: 0,
      preventDefault: vi.fn(),
      clientX: 400,
      clientY: 300,
    });
    expect(onSelect).toHaveBeenLastCalledWith("one");
    mocks.listeners.get("pointerdown")?.({
      isPrimary: true,
      button: 0,
      preventDefault: vi.fn(),
      clientX: 0,
      clientY: 0,
    });
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });
  it("disposes resources once and ignores subsequent updates", () => {
    manager.syncDevices([device], "one");
    const mesh = manager.pickTargets[0] as THREE.Mesh;
    const geometryDispose = vi.spyOn(mesh.geometry, "dispose");
    const materialDispose = vi.spyOn(
      mesh.material as THREE.Material,
      "dispose",
    );
    manager.dispose();
    manager.dispose();
    manager.syncDevices([device], null);
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
    expect(mocks.disconnect).toHaveBeenCalledTimes(1);
    expect(mocks.listeners.size).toBe(0);
    expect(frames.size).toBe(0);
    expect(manager.pickTargets).toHaveLength(0);
  });
});
