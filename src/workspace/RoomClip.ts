import * as T from "three";
import type { RoomSize } from "./DeviceStore";
/** Clip convex frustum faces against the room box, creating cap polygons on each plane. */
export function clipRoom(faces: T.Vector3[][], room: RoomSize): T.Vector3[][] {
  for (const [normal, constant] of [
    [new T.Vector3(1, 0, 0), room.width / 2],
    [new T.Vector3(-1, 0, 0), room.width / 2],
    [new T.Vector3(0, 1, 0), 0],
    [new T.Vector3(0, -1, 0), room.height],
    [new T.Vector3(0, 0, 1), room.depth / 2],
    [new T.Vector3(0, 0, -1), room.depth / 2],
  ] as const) {
    const cuts: T.Vector3[] = [],
      next: T.Vector3[][] = [];
    for (const polygon of faces) {
      const out: T.Vector3[] = [];
      for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i],
          b = polygon[(i + 1) % polygon.length],
          da = a.dot(normal) + constant,
          db = b.dot(normal) + constant;
        if (da >= -1e-8) out.push(a);
        if (da >= 0 !== db >= 0) {
          const p = a.clone().lerp(b, da / (da - db));
          out.push(p);
          if (!cuts.some((v) => v.distanceToSquared(p) < 1e-12)) cuts.push(p);
        }
      }
      if (out.length >= 3) next.push(out);
    }
    if (cuts.length >= 3) {
      const center = cuts
          .reduce((s, p) => s.add(p), new T.Vector3())
          .divideScalar(cuts.length),
        u = new T.Vector3(
          Math.abs(normal.y) < 0.9 ? 0 : 1,
          Math.abs(normal.y) < 0.9 ? 1 : 0,
          0,
        )
          .cross(normal)
          .normalize(),
        v = normal.clone().cross(u);
      cuts.sort(
        (a, b) =>
          Math.atan2(
            a.clone().sub(center).dot(v),
            a.clone().sub(center).dot(u),
          ) -
          Math.atan2(
            b.clone().sub(center).dot(v),
            b.clone().sub(center).dot(u),
          ),
      );
      next.push(cuts);
    }
    faces = next;
  }
  return faces;
}
