import { describe, expect, it, vi } from "vitest";
import * as T from "three";
import {
  ViewportNavigation,
  orthographicFit,
} from "../../src/workspace/ViewportNavigation";
import {
  cableRoutes,
  measurements,
  SpatialOverlays,
} from "../../src/workspace/SpatialOverlays";
import { createWorkspace } from "../../src/workspace/createWorkspace";
function setup(hit = false) {
  const handlers = new Map<string, Function>();
  const element = {
    addEventListener: (n: string, f: Function) => handlers.set(n, f),
    removeEventListener: (n: string) => handlers.delete(n),
    setPointerCapture: vi.fn(),
    hasPointerCapture: () => true,
    releasePointerCapture: vi.fn(),
    getBoundingClientRect: () => ({ height: 600 }),
  };
  const camera = new T.OrthographicCamera(-8, 8, 6, -6, 0.01, 1000);
  camera.position.set(8, 8, 8);
  camera.lookAt(0, 0, 0);
  const navigation = new ViewportNavigation(
    element as unknown as HTMLElement,
    () => camera,
    vi.fn(),
    () => hit,
    () => 8,
  );
  const event = (name: string, extra = {}) =>
    handlers.get(name)?.({
      isPrimary: true,
      pointerId: 1,
      button: 0,
      clientX: 0,
      clientY: 0,
      preventDefault: vi.fn(),
      ...extra,
    });
  const settle = () => {
    let n = 0;
    while (navigation.update() && n++ < 100) {}
    expect(n).toBeLessThan(100);
  };
  return { camera, navigation, event, settle, handlers, element };
}
describe("Viewport interaction", () => {
  it("orbits with finite damping and stops rendering when settled", () => {
    const s = setup(),
      before = s.camera.position.clone();
    s.event("pointerdown");
    s.event("pointermove", { clientX: 100, clientY: 20 });
    s.event("pointerup");
    s.settle();
    expect(s.camera.position.distanceTo(before)).toBeGreaterThan(1);
    expect(s.navigation.update()).toBe(false);
    s.navigation.dispose();
    expect(s.handlers.size).toBe(0);
  });
  it("pans camera and target together using the middle button", () => {
    const s = setup(),
      before = s.camera.position.clone();
    s.event("pointerdown", { button: 1 });
    s.event("pointermove", { clientX: 100 });
    expect(
      s.camera.position.clone().sub(before).distanceTo(s.navigation.target),
    ).toBeLessThan(1e-8);
    expect(s.navigation.target.length()).toBeGreaterThan(0);
    s.navigation.dispose();
    expect(s.element.releasePointerCapture).toHaveBeenCalledWith(1);
  });
  it("zooms the projection and enforces zoom limits", () => {
    const s = setup();
    for (let i = 0; i < 25; i++) {
      s.event("wheel", { deltaY: -500, deltaMode: 0 });
      s.settle();
    }
    expect(s.camera.zoom).toBe(20);
    s.navigation.dispose();
  });
  it("reserves device grabs for equipment dragging", () => {
    const s = setup(true),
      before = s.camera.position.clone();
    s.event("pointerdown");
    s.event("pointermove", { clientX: 100 });
    s.settle();
    expect(s.camera.position.equals(before)).toBe(true);
    expect(s.element.setPointerCapture).not.toHaveBeenCalled();
    s.navigation.dispose();
  });
  it.each([
    [4, 3, 2.5, 0.6],
    [14, 8, 4, 2],
  ])("fits every room corner at %s by %s metres", (w, d, h, aspect) => {
    const c = new T.OrthographicCamera(-1, 1, 1, -1, 0.01, 1000),
      center = new T.Vector3(0, h / 2, 0);
    c.position.copy(center).add(new T.Vector3(20, 20, 20));
    c.lookAt(center);
    const bounds = new T.Box3(
      new T.Vector3(-w / 2, 0, -d / 2),
      new T.Vector3(w / 2, h, d / 2),
    );
    const span = orthographicFit(c, bounds, aspect);
    Object.assign(c, {
      left: -span * aspect,
      right: span * aspect,
      top: span,
      bottom: -span,
    });
    c.updateProjectionMatrix();
    for (const x of [-w / 2, w / 2])
      for (const y of [0, h])
        for (const z of [-d / 2, d / 2]) {
          const p = new T.Vector3(x, y, z).project(c);
          expect(Math.abs(p.x)).toBeLessThan(0.87);
          expect(Math.abs(p.y)).toBeLessThan(0.87);
        }
  });
});
describe("Live spatial overlays", () => {
  it("measures actual envelope dimensions", () => {
    const result = measurements({ width: 14, depth: 8, height: 4 });
    expect(
      result.map((m) =>
        Math.hypot(m.a.x - m.b.x, m.a.y - m.b.y, m.a.z - m.b.z),
      ),
    ).toEqual([14, 8, 4]);
  });
  it("routes only real connections and recomputes endpoints and length after movement", () => {
    const store = createWorkspace(),
      state = store.api.getState(),
      routes = cableRoutes(state);
    expect(routes.length).toBe(state.connections.length);
    expect(routes.length).toBeGreaterThan(0);
    const first = routes[0],
      device = state.devices[first.from.deviceId]!;
    const next = cableRoutes({
      ...state,
      devices: {
        ...state.devices,
        [device.id]: {
          ...device,
          position: { ...device.position, x: device.position.x + 1 },
        },
      },
    })[0];
    expect(next.points[0].x).toBe(first.points[0].x + 1);
    expect(next.length).not.toBe(first.length);
    expect(cableRoutes({ ...state, connections: [] })).toEqual([]);
  });
  it("filters pickable cables and disposes replaced geometry", () => {
    const state = createWorkspace().api.getState(),
      scene = new T.Scene(),
      layer = new SpatialOverlays(scene);
    layer.update("cables", state, "All", null);
    expect(layer.cables.length).toBe(state.connections.length);
    const line = layer.cables[0] as T.Line,
      dispose = vi.spyOn(line.geometry, "dispose");
    expect(line.userData.cableId).toBe(state.connections[0].id);
    layer.update("cables", state, "Power", null);
    expect(layer.cables).toHaveLength(0);
    expect(dispose).toHaveBeenCalledOnce();
    layer.dispose();
    expect(scene.children).toHaveLength(0);
  });
});
