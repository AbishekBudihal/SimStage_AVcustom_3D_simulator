import * as THREE from 'three';
import type { CanvasManager } from './CanvasManager';
import { DeviceStore, snapToSurface, type MountSurface, type XYZ } from './DeviceStore';

/** Mounting-anchor drag, in metres. Returns an idempotent listener cleanup function.
 * The caller subscribes the canvas to the store; this controller never owns scene state.
 */
export function useDeviceDrag(canvas: CanvasManager, store: DeviceStore): () => void {
  const element = canvas.renderer.domElement;
  const ray = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const plane = new THREE.Plane();
  const hit = new THREE.Vector3();
  const offset = new THREE.Vector3();
  let disposed = false;
  let active: {
    pointerId: number; id: string; origin: XYZ; surface: MountSurface;
    startX: number; startY: number; moved: boolean; cursor: string;
  } | undefined;

  const updateRay = (event: PointerEvent): boolean => {
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    canvas.camera.updateMatrixWorld();
    ray.setFromCamera(pointer, canvas.camera);
    return true;
  };
  const down = (event: PointerEvent): void => {
    if (disposed || active || !event.isPrimary || event.button !== 0 || !updateRay(event)) return;
    canvas.scene.updateMatrixWorld(true);
    const intersection = ray.intersectObjects(canvas.pickTargets, false)[0];
    const device = intersection && store.get(intersection.object.userData.deviceId as string);
    if (!device) return;
    store.api.getState().selectDevice(device.id);
    const normal = device.surface === 'floor' || device.surface === 'ceiling' ? new THREE.Vector3(0, 1, 0)
      : device.surface === 'east' || device.surface === 'west' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    plane.setFromNormalAndCoplanarPoint(normal, new THREE.Vector3(device.position.x, device.position.y, device.position.z));
    if (Math.abs(ray.ray.direction.dot(normal)) < 1e-5 || !ray.ray.intersectPlane(plane, hit)) return;
    offset.set(device.position.x, device.position.y, device.position.z).sub(hit);
    // A pointer can disappear between event dispatch and capture (e.g. device removal).
    try { element.setPointerCapture(event.pointerId); } catch { return; }
    active = {
      pointerId: event.pointerId, id: device.id, origin: { ...device.position }, surface: device.surface,
      startX: event.clientX, startY: event.clientY, moved: false, cursor: element.style.cursor,
    };
    element.style.cursor = 'grabbing';
    event.preventDefault();
  };
  const move = (event: PointerEvent): void => {
    if (!active || active.pointerId !== event.pointerId) return;
    const device = store.get(active.id);
    // Deletion or re-mounting externally ends this gesture without overwriting new state.
    if (!device || device.surface !== active.surface) { finish(false); return; }
    if (event.clientX !== active.startX || event.clientY !== active.startY) active.moved = true;
    if (!active.moved || !updateRay(event)) return;
    if (Math.abs(ray.ray.direction.dot(plane.normal)) < 1e-5 || !ray.ray.intersectPlane(plane, hit)) return;
    hit.add(offset);
    store.move(active.id, snapToSurface(hit, active.surface, canvas.room));
  };
  const finish = (cancel: boolean): void => {
    if (!active) return;
    const previous = active;
    active = undefined;
    try {
      if (cancel && store.get(previous.id)?.surface === previous.surface) store.move(previous.id, previous.origin);
    } finally {
      if (element.hasPointerCapture(previous.pointerId)) element.releasePointerCapture(previous.pointerId);
      element.style.cursor = previous.cursor;
    }
  };
  const up = (event: PointerEvent): void => {
    if (active?.pointerId !== event.pointerId) return;
    move(event);
    finish(false);
  };
  const cancel = (event: PointerEvent): void => { if (active?.pointerId === event.pointerId) finish(true); };
  const blur = (): void => finish(true);
  const key = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && active) { event.preventDefault(); finish(true); }
  };
  element.addEventListener('pointerdown', down);
  element.addEventListener('pointermove', move);
  element.addEventListener('pointerup', up);
  element.addEventListener('pointercancel', cancel);
  element.addEventListener('lostpointercapture', cancel);
  window.addEventListener('blur', blur);
  window.addEventListener('keydown', key);
  return () => {
    if (disposed) return;
    disposed = true;
    finish(true);
    element.removeEventListener('pointerdown', down);
    element.removeEventListener('pointermove', move);
    element.removeEventListener('pointerup', up);
    element.removeEventListener('pointercancel', cancel);
    element.removeEventListener('lostpointercapture', cancel);
    window.removeEventListener('blur', blur);
    window.removeEventListener('keydown', key);
  };
}
