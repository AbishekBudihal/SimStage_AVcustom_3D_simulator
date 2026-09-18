import * as T from "three";
import type { DeviceState, PlacedDevice, RoomSize, XYZ } from "./DeviceStore";
import { orientation, vector, screenOrigin } from "./OpticalTransform";
import { roomLayout } from "./RoomLayout";
import { visualCheck, visualRegionBoundary } from "./Engineering";
export type OpticalStatus = "inside" | "outside" | "unknown" | "warning";
export interface OpticalSeat {
  id: string;
  position: XYZ;
  distance: number;
  horizontal: number;
  vertical: number;
  horizontalInside: boolean | null;
  verticalInside: boolean | null;
  front: boolean;
  status: OpticalStatus;
  reasons: string[];
}
export interface OpticalResult {
  deviceId: string;
  kind: "camera" | "display";
  origin: XYZ;
  direction: XYZ;
  seats: OpticalSeat[];
  segments: XYZ[][];
  faces: XYZ[][];
  hfov: number | null;
  vfov: number | null;
  assumptions: string[];
}
const validFov = (n: number | undefined) =>
  n !== undefined && Number.isFinite(n) && n > 0 && n < 180 ? n : null;
/** Clip convex frustum faces against the room box, creating cap polygons on each plane. */
function clipRoom(faces: T.Vector3[][], room: RoomSize): T.Vector3[][] {
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
/** Rectilinear pinhole geometry; local +Z forward. Missing VFOV never counts as full coverage. */
export function cameraCoverage(
  device: PlacedDevice,
  room: RoomSize,
): OpticalResult {
  const origin = vector(device.position),
    q = orientation(device),
    inverse = q.clone().invert(),
    hfov = validFov(device.metadata.horizontalFovDeg),
    vfov = validFov(device.metadata.verticalFovDeg);
  const seats: OpticalSeat[] = roomLayout(room).seats.map((s) => {
    const p = vector(s.position).sub(origin).applyQuaternion(inverse),
      front = p.z > 1e-8;
    const horizontal = (Math.atan2(Math.abs(p.x), p.z) * 180) / Math.PI,
      vertical = (Math.atan2(Math.abs(p.y), p.z) * 180) / Math.PI;
    const horizontalInside =
        hfov === null ? null : front && horizontal <= hfov / 2 + 1e-8,
      verticalInside =
        vfov === null ? null : front && vertical <= vfov / 2 + 1e-8;
    const reasons: string[] = [];
    if (!front) reasons.push("Behind camera");
    if (horizontalInside === false) reasons.push("Outside horizontal FOV");
    if (verticalInside === false) reasons.push("Outside vertical FOV");
    if (hfov === null) reasons.push("HFOV Unknown");
    if (vfov === null) reasons.push("VFOV Unknown");
    return {
      id: s.id,
      position: s.position,
      distance: p.length(),
      horizontal,
      vertical,
      horizontalInside,
      verticalInside,
      front,
      status:
        !front || horizontalInside === false || verticalInside === false
          ? "outside"
          : hfov === null || vfov === null
            ? "unknown"
            : "inside",
      reasons,
    };
  });
  const direction = new T.Vector3(0, 0, 1).applyQuaternion(q),
    far = Math.max(
      1,
      ...[-room.width / 2, room.width / 2].flatMap((x) =>
        [0, room.height].flatMap((y) =>
          [-room.depth / 2, room.depth / 2].map((z) =>
            new T.Vector3(x, y, z).sub(origin).length(),
          ),
        ),
      ),
    );
  let faces: T.Vector3[][] = [];
  const segments: XYZ[][] = [];
  if (hfov !== null && vfov !== null) {
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([x, y]) =>
      new T.Vector3(
        x * far * Math.tan((hfov * Math.PI) / 360),
        y * far * Math.tan((vfov * Math.PI) / 360),
        far,
      )
        .applyQuaternion(q)
        .add(origin),
    );
    faces = clipRoom(
      [corners, ...corners.map((p, i) => [origin, p, corners[(i + 1) % 4]])],
      room,
    );
    for (const face of faces) segments.push([...face, face[0]]);
  } else if (hfov !== null) {
    for (const sign of [-1, 1]) {
      const rayDirection = new T.Vector3(
        sign * Math.tan((hfov * Math.PI) / 360),
        0,
        1,
      )
        .normalize()
        .applyQuaternion(q);
      const hit = new T.Ray(origin, rayDirection).intersectBox(
        new T.Box3(
          new T.Vector3(-room.width / 2, 0, -room.depth / 2),
          new T.Vector3(room.width / 2, room.height, room.depth / 2),
        ),
        new T.Vector3(),
      );
      if (hit) segments.push([origin, hit]);
    }
  }
  return {
    deviceId: device.id,
    kind: "camera",
    origin,
    direction,
    seats,
    segments,
    faces,
    hfov,
    vfov,
    assumptions: [
      "Rectilinear FOV; camera lens uses mounting anchor (lens offset unknown).",
      "Room-clipped geometry only; no furniture/person occlusion, autofocus or pixels-on-target.",
    ],
  };
}
/** Reuses active viewing criteria; planar distance for limits, 3D distance for reporting. */
export function displayViewing(
  device: PlacedDevice,
  state: Pick<DeviceState, "room" | "engineering">,
): OpticalResult {
  const origin = screenOrigin(device),
    q = orientation(device),
    direction = new T.Vector3(0, 0, 1).applyQuaternion(q);
  const seats: OpticalSeat[] = roomLayout(state.room).seats.map((s) => {
    const r = visualCheck(device, s.position, state.engineering),
      local = vector(s.position)
        .sub(origin)
        .applyQuaternion(q.clone().invert());
    const front = local.z > 0,
      reasons: string[] = [];
    if (!front) reasons.push("Behind display screen");
    if (r.status === "unknown") reasons.push("Image height Unknown");
    if (r.distance > Math.min(r.heuristicMax, r.bdmMax))
      reasons.push("Distance exceeds configured planning limit");
    if (r.horizontal > state.engineering.horizontalLimit)
      reasons.push(
        "Horizontal off-axis angle exceeds configured planning criterion",
      );
    if (r.vertical > state.engineering.verticalLimit)
      reasons.push(
        "Vertical screen-edge angle exceeds configured planning criterion",
      );
    if (r.status === "yellow")
      reasons.push("Within 10% of a configured planning limit");
    return {
      id: s.id,
      position: s.position,
      distance: local.length(),
      horizontal: r.horizontal,
      vertical: r.vertical,
      horizontalInside: r.horizontal <= state.engineering.horizontalLimit,
      verticalInside: r.vertical <= state.engineering.verticalLimit,
      front,
      status:
        r.status === "unknown"
          ? "unknown"
          : !r.pass
            ? "outside"
            : r.status === "yellow"
              ? "warning"
              : "inside",
      reasons,
    };
  });
  const boundary = visualRegionBoundary(device, state.engineering, state.room),
    segments: XYZ[][] = [];
  for (let i = 0; i < boundary.length; i += 6)
    segments.push([
      { x: boundary[i], y: boundary[i + 1], z: boundary[i + 2] },
      { x: boundary[i + 3], y: boundary[i + 4], z: boundary[i + 5] },
    ]);
  return {
    deviceId: device.id,
    kind: "display",
    origin,
    direction,
    seats,
    segments,
    faces: [],
    hfov: null,
    vfov: null,
    assumptions: [
      "Screen plane uses front face of physical envelope; exact bezel/lens geometry unknown.",
      "Existing planning limits: min(image height × 4/6/8, image height × element % × 200); not certified DISCAS.",
      "Vertical limit uses farthest screen edge; distance criterion uses horizontal distance. Resolution is metadata, not a pixel-legibility claim.",
    ],
  };
}
