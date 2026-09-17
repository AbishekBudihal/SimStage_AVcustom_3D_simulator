import * as T from "three";
/** Pointer navigation with finite damping frames; device grabs retain priority. */
export class ViewportNavigation {
  readonly target = new T.Vector3();
  private drag: { id: number; x: number; y: number; pan: boolean } | undefined;
  private rotation = new T.Vector2();
  private zoom = 0;
  private disposed = false;
  constructor(
    private element: HTMLElement,
    private camera: () => T.OrthographicCamera | T.PerspectiveCamera,
    private invalidate: () => void,
    private deviceHit: (e: PointerEvent) => boolean,
    private scale: () => number,
  ) {
    element.addEventListener("pointerdown", this.down);
    element.addEventListener("pointermove", this.move);
    element.addEventListener("pointerup", this.up);
    element.addEventListener("pointercancel", this.up);
    element.addEventListener("lostpointercapture", this.up);
    element.addEventListener("wheel", this.wheel, { passive: false });
    element.addEventListener("contextmenu", this.context);
  }
  private context = (e: Event) => e.preventDefault();
  private down = (e: PointerEvent) => {
    if (!e.isPrimary || this.drag) return;
    if (e.button === 0 && this.deviceHit(e)) {
      this.stop();
      return;
    }
    if (e.button > 2) return;
    this.stop();
    this.drag = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      pan: e.button !== 0,
    };
    try {
      this.element.setPointerCapture(e.pointerId);
    } catch {
      this.drag = undefined;
      return;
    }
    e.preventDefault();
  };
  private move = (e: PointerEvent) => {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x,
      dy = e.clientY - d.y;
    d.x = e.clientX;
    d.y = e.clientY;
    const c = this.camera();
    if (d.pan) {
      const height = Math.max(1, this.element.getBoundingClientRect().height);
      const span =
        c instanceof T.OrthographicCamera
          ? (c.top - c.bottom) / c.zoom
          : 2 *
            c.position.distanceTo(this.target) *
            Math.tan((c.fov * Math.PI) / 360);
      const shift = new T.Vector3(
        (-dx * span) / height,
        (dy * span) / height,
        0,
      ).applyQuaternion(c.quaternion);
      this.target.add(shift);
      c.position.add(shift);
    } else this.rotation.add(new T.Vector2(-dx * 0.005, -dy * 0.005));
    this.invalidate();
  };
  private up = (e: PointerEvent) => {
    if (this.drag?.id === e.pointerId) {
      this.drag = undefined;
      if (this.element.hasPointerCapture(e.pointerId))
        this.element.releasePointerCapture(e.pointerId);
    }
  };
  private wheel = (e: WheelEvent) => {
    e.preventDefault();
    this.zoom += Math.max(
      -0.8,
      Math.min(0.8, e.deltaY * (e.deltaMode === 1 ? 0.035 : 0.0015)),
    );
    this.invalidate();
  };
  stop() {
    this.rotation.set(0, 0);
    this.zoom = 0;
  }
  update(): boolean {
    if (this.disposed) return false;
    const c = this.camera();
    const changing =
      this.rotation.lengthSq() > 1e-8 || Math.abs(this.zoom) > 1e-5;
    if (!changing) {
      this.stop();
      return false;
    }
    const part = 0.28,
      offset = c.position.clone().sub(this.target),
      spherical = new T.Spherical().setFromVector3(offset);
    spherical.theta += this.rotation.x * part;
    spherical.phi = T.MathUtils.clamp(
      spherical.phi + this.rotation.y * part,
      0.01,
      Math.PI / 2 - 0.015,
    );
    if (c instanceof T.OrthographicCamera) {
      c.zoom = T.MathUtils.clamp(
        c.zoom * Math.exp(-this.zoom * part),
        0.25,
        20,
      );
      c.updateProjectionMatrix();
    } else
      spherical.radius = T.MathUtils.clamp(
        spherical.radius * Math.exp(this.zoom * part),
        Math.max(0.35, this.scale() * 0.04),
        this.scale() * 6,
      );
    c.position
      .copy(this.target)
      .add(new T.Vector3().setFromSpherical(spherical));
    c.lookAt(this.target);
    this.rotation.multiplyScalar(1 - part);
    this.zoom *= 1 - part;
    return true;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const id = this.drag?.id;
    this.drag = undefined;
    if (id !== undefined && this.element.hasPointerCapture(id))
      this.element.releasePointerCapture(id);
    this.element.removeEventListener("pointerdown", this.down);
    this.element.removeEventListener("pointermove", this.move);
    this.element.removeEventListener("pointerup", this.up);
    this.element.removeEventListener("pointercancel", this.up);
    this.element.removeEventListener("lostpointercapture", this.up);
    this.element.removeEventListener("wheel", this.wheel);
    this.element.removeEventListener("contextmenu", this.context);
  }
}
/** Project all eight corners into the current camera basis to tightly fit any room. */
export function orthographicFit(
  camera: T.OrthographicCamera,
  bounds: T.Box3,
  aspect: number,
): number {
  camera.updateMatrixWorld();
  const inverse = camera.matrixWorldInverse;
  let x = 0,
    y = 0;
  const centre = bounds.getCenter(new T.Vector3()).applyMatrix4(inverse);
  for (const a of [bounds.min.x, bounds.max.x])
    for (const b of [bounds.min.y, bounds.max.y])
      for (const c of [bounds.min.z, bounds.max.z]) {
        const p = new T.Vector3(a, b, c).applyMatrix4(inverse).sub(centre);
        x = Math.max(x, Math.abs(p.x));
        y = Math.max(y, Math.abs(p.y));
      }
  return Math.max(y, x / Math.max(0.1, aspect)) * 1.16;
}
