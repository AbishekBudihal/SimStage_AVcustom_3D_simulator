import * as T from "three";
import type { CanvasManager } from "./CanvasManager";
import type { DeviceStore, FurnitureEdit, RoomSize } from "./DeviceStore";
import { roomLayout } from "./RoomLayout";

export function useFurnitureDrag(
  canvas: CanvasManager,
  store: DeviceStore,
): () => void {
  const element = canvas.renderer.domElement;
  const ray = new T.Raycaster(),
    point = new T.Vector3(),
    plane = new T.Plane();
  let active:
    | {
        id: string;
        pointer: number;
        dx: number;
        dz: number;
        original: FurnitureEdit | undefined;
        expected: RoomSize;
        startX: number;
        startY: number;
      }
    | undefined;
  const intersect = (e: PointerEvent) => {
    const r = element.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    canvas.camera.updateMatrixWorld();
    ray.setFromCamera(
      new T.Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        1 - ((e.clientY - r.top) / r.height) * 2,
      ),
      canvas.camera,
    );
    return (
      Math.abs(ray.ray.direction.dot(plane.normal)) > 1e-5 &&
      !!ray.ray.intersectPlane(plane, point)
    );
  };
  const down = (e: PointerEvent) => {
    if (!canvas.furnitureEditing || active || !e.isPrimary || e.button !== 0)
      return;
    const id = canvas.pickFurniture(e);
    if (!id) return;
    const room = store.api.getState().room,
      layout = roomLayout(room);
    const table = id.startsWith("table:")
      ? layout.tables[Number(id.slice(6))]
      : undefined;
    const seat = layout.seats.find((s) => `seat:${s.id}` === id);
    if (!table && !seat) return;
    plane.set(new T.Vector3(0, 1, 0), -(table?.height ?? 0.46));
    if (!intersect(e)) return;
    try {
      element.setPointerCapture(e.pointerId);
    } catch {
      return;
    }
    active = {
      id,
      pointer: e.pointerId,
      dx: (table?.x ?? seat!.position.x) - point.x,
      dz: (table?.z ?? seat!.position.z) - point.z,
      original: room.furniture?.[id],
      expected: room,
      startX: e.clientX,
      startY: e.clientY,
    };
    element.style.cursor = "grabbing";
    e.preventDefault();
  };
  const finish = (rollback: boolean) => {
    const previous = active;
    if (!previous) return;
    active = undefined;
    const room = store.api.getState().room;
    if (rollback && room === previous.expected) {
      const furniture = { ...room.furniture };
      if (previous.original) furniture[previous.id] = previous.original;
      else delete furniture[previous.id];
      store.api.getState().setRoom({ furniture });
    }
    if (element.hasPointerCapture(previous.pointer))
      element.releasePointerCapture(previous.pointer);
    element.style.cursor = canvas.furnitureEditing ? "grab" : "";
  };
  const move = (e: PointerEvent) => {
    if (!active || e.pointerId !== active.pointer) return;
    if (
      !canvas.furnitureEditing ||
      store.api.getState().room !== active.expected
    ) {
      finish(false);
      return;
    }
    if (
      Math.hypot(e.clientX - active.startX, e.clientY - active.startY) < 3 ||
      !intersect(e)
    )
      return;
    const snap = (n: number) =>
      Math.round(n / (e.shiftKey ? 0.05 : 0.25)) * (e.shiftKey ? 0.05 : 0.25);
    const room = store.api.getState().room;
    store.api
      .getState()
      .setRoom({
        furniture: {
          ...room.furniture,
          [active.id]: {
            ...room.furniture?.[active.id],
            x: snap(point.x + active.dx),
            z: snap(point.z + active.dz),
          },
        },
      });
    active.expected = store.api.getState().room;
  };
  const up = (e: PointerEvent) => {
    if (active?.pointer === e.pointerId) {
      move(e);
      finish(false);
    }
  };
  const cancel = (e: PointerEvent) => {
    if (active?.pointer === e.pointerId) finish(true);
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === "Escape" && active) {
      e.preventDefault();
      finish(true);
    }
  };
  const blur = () => finish(true);
  element.addEventListener("pointerdown", down);
  element.addEventListener("pointermove", move);
  element.addEventListener("pointerup", up);
  element.addEventListener("pointercancel", cancel);
  element.addEventListener("lostpointercapture", cancel);
  window.addEventListener("keydown", key);
  window.addEventListener("blur", blur);
  return () => {
    finish(true);
    element.removeEventListener("pointerdown", down);
    element.removeEventListener("pointermove", move);
    element.removeEventListener("pointerup", up);
    element.removeEventListener("pointercancel", cancel);
    element.removeEventListener("lostpointercapture", cancel);
    window.removeEventListener("keydown", key);
    window.removeEventListener("blur", blur);
  };
}
