import * as THREE from "three";
import type { CanvasManager } from "./CanvasManager";
import {
  DeviceStore,
  snapToSurface,
  type MountSurface,
  type XYZ,
} from "./DeviceStore";
import { allowedSurfaces } from "./LegacyCatalog";

/** Mounting-anchor drag, in metres. Returns an idempotent listener cleanup function.
 * The caller subscribes the canvas to the store; this controller never owns scene state.
 */
export function useDeviceDrag(
  canvas: CanvasManager,
  store: DeviceStore,
): () => void {
  const element = canvas.renderer.domElement;
  const ray = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const plane = new THREE.Plane();
  const hit = new THREE.Vector3();
  const offset = new THREE.Vector3();
  let disposed = false;
  let active:
    | {
        room: typeof canvas.room;
        pointerId: number;
        id: string;
        origin: XYZ;
        surface: MountSurface;
        startX: number;
        startY: number;
        moved: boolean;
        cursor: string;
        originalSurface: MountSurface;
      }
    | undefined;

  const updateRay = (event: PointerEvent): boolean => {
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      (-(event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    canvas.camera.updateMatrixWorld();
    ray.setFromCamera(pointer, canvas.camera);
    return true;
  };
  const down = (event: PointerEvent): void => {
    if (
      disposed ||
      active ||
      !event.isPrimary ||
      event.button !== 0 ||
      !updateRay(event)
    )
      return;
    canvas.scene.updateMatrixWorld(true);
    const intersection = ray.intersectObjects(canvas.pickTargets, true)[0];
    const device =
      intersection &&
      store.get(intersection.object.userData.deviceId as string);
    if (!device) return;
    store.api.getState().selectDevice(device.id);
    const normal =
      device.surface === "floor" ||
      device.surface === "ceiling" ||
      device.surface === "table"
        ? new THREE.Vector3(0, 1, 0)
        : device.surface === "east" || device.surface === "west"
          ? new THREE.Vector3(1, 0, 0)
          : new THREE.Vector3(0, 0, 1);
    plane.setFromNormalAndCoplanarPoint(
      normal,
      new THREE.Vector3(
        device.position.x,
        device.position.y,
        device.position.z,
      ),
    );
    if (
      Math.abs(ray.ray.direction.dot(normal)) < 1e-5 ||
      !ray.ray.intersectPlane(plane, hit)
    )
      return;
    offset
      .set(device.position.x, device.position.y, device.position.z)
      .sub(hit);
    // A pointer can disappear between event dispatch and capture (e.g. device removal).
    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      return;
    }
    active = {
      room: canvas.room,
      pointerId: event.pointerId,
      id: device.id,
      origin: { ...device.position },
      surface: device.surface,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      cursor: element.style.cursor,
      originalSurface: device.surface,
    };
    element.style.cursor = "grabbing";
    event.preventDefault();
  };
  const move = (event: PointerEvent): void => {
    if (!active || active.pointerId !== event.pointerId) return;
    const device = store.get(active.id);
    // Deletion or re-mounting externally ends this gesture without overwriting new state.
    if (
      !device ||
      device.surface !== active.surface ||
      active.room !== canvas.room
    ) {
      finish(false);
      return;
    }
    if (event.clientX !== active.startX || event.clientY !== active.startY)
      active.moved = true;
    if (!active.moved || !updateRay(event)) return;
    if (event.altKey) {
      let best:
        { surface: MountSurface; point: XYZ; distance: number } | undefined;
      for (const surface of store.api
        .getState()
        .catalog.find((p) => p.id === device.catalogId)?.surfaces ??
        allowedSurfaces(device.kind)) {
        const anchor = snapToSurface(
          { x: 0, y: 0, z: 0 },
          surface,
          canvas.room,
        );
        const normal = new THREE.Vector3(
          surface === "east" || surface === "west" ? 1 : 0,
          ["floor", "ceiling", "table"].includes(surface) ? 1 : 0,
          surface === "north" || surface === "south" ? 1 : 0,
        );
        const candidatePlane = new THREE.Plane().setFromNormalAndCoplanarPoint(
          normal,
          new THREE.Vector3(anchor.x, anchor.y, anchor.z),
        );
        const candidate = new THREE.Vector3();
        if (
          Math.abs(ray.ray.direction.dot(normal)) < 1e-5 ||
          !ray.ray.intersectPlane(candidatePlane, candidate)
        )
          continue;
        const snapped = snapToSurface(candidate, surface, canvas.room);
        // Ignore intersections outside the finite surface rather than clamping to an edge.
        if (
          Math.abs(snapped.x - candidate.x) > 0.26 ||
          Math.abs(snapped.y - candidate.y) > 0.26 ||
          Math.abs(snapped.z - candidate.z) > 0.26
        )
          continue;
        const distance = candidate.distanceTo(ray.ray.origin);
        if (!best || distance < best.distance)
          best = { surface, point: snapped, distance };
      }
      if (best) {
        active.surface = best.surface;
        offset.set(0, 0, 0);
        const n = new THREE.Vector3(
          best.surface === "east" || best.surface === "west" ? 1 : 0,
          ["floor", "ceiling", "table"].includes(best.surface) ? 1 : 0,
          best.surface === "north" || best.surface === "south" ? 1 : 0,
        );
        plane.setFromNormalAndCoplanarPoint(
          n,
          new THREE.Vector3(best.point.x, best.point.y, best.point.z),
        );
        store.update(active.id, {
          surface: best.surface,
          position: best.point,
        });
      }
      return;
    }
    if (
      Math.abs(ray.ray.direction.dot(plane.normal)) < 1e-5 ||
      !ray.ray.intersectPlane(plane, hit)
    )
      return;
    hit.add(offset);
    store.move(active.id, snapToSurface(hit, active.surface, canvas.room));
  };
  const finish = (cancel: boolean): void => {
    if (!active) return;
    const previous = active;
    active = undefined;
    try {
      if (
        cancel &&
        previous.room === canvas.room &&
        store.get(previous.id)?.surface === previous.surface
      )
        store.update(previous.id, {
          position: previous.origin,
          surface: previous.originalSurface,
        });
    } finally {
      if (element.hasPointerCapture(previous.pointerId))
        element.releasePointerCapture(previous.pointerId);
      element.style.cursor = previous.cursor;
    }
  };
  const up = (event: PointerEvent): void => {
    if (active?.pointerId !== event.pointerId) return;
    move(event);
    finish(false);
  };
  const cancel = (event: PointerEvent): void => {
    if (active?.pointerId === event.pointerId) finish(true);
  };
  const blur = (): void => finish(true);
  const key = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && active) {
      event.preventDefault();
      finish(true);
    }
  };
  element.addEventListener("pointerdown", down);
  element.addEventListener("pointermove", move);
  element.addEventListener("pointerup", up);
  element.addEventListener("pointercancel", cancel);
  element.addEventListener("lostpointercapture", cancel);
  window.addEventListener("blur", blur);
  window.addEventListener("keydown", key);
  return () => {
    if (disposed) return;
    disposed = true;
    finish(true);
    element.removeEventListener("pointerdown", down);
    element.removeEventListener("pointermove", move);
    element.removeEventListener("pointerup", up);
    element.removeEventListener("pointercancel", cancel);
    element.removeEventListener("lostpointercapture", cancel);
    window.removeEventListener("blur", blur);
    window.removeEventListener("keydown", key);
  };
}
