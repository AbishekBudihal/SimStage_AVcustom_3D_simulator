import { clipRoom } from "./RoomClip";
import * as T from "three";
import type { PlacedDevice, RoomSize, XYZ, DeviceState } from "./DeviceStore";
import { mountYaw as surfaceYaw, vector } from "./OpticalTransform";
import { roomLayout } from "./RoomLayout";
import { sampleListeningPlane } from "./ListeningGrid";
const radToDeg = 180 / Math.PI;
/** Free-field energy sum with optional sensitivity/drive and approximate conical directivity. */
export function directSpl(
  speakers: readonly PlacedDevice[],
  point: XYZ,
): number | null {
  let energy = 0;
  for (const speaker of speakers) {
    const m = speaker.metadata;
    if (m.speakerWatts === 0) continue;
    let reference = m.referenceSplDb ?? m.splAt1m;
    let referenceDistance =
      m.referenceSplDb !== undefined ? m.referenceDistanceM : 1;
    if (
      reference !== null &&
      reference !== undefined &&
      referenceDistance === undefined
    )
      return null;
    if (
      m.referenceSplDb === undefined &&
      m.splAt1m == null &&
      m.sensitivityDb !== undefined &&
      m.speakerWatts !== undefined
    ) {
      referenceDistance = 1;
      if (m.speakerWatts === 0) continue;
      reference = Math.min(
        m.maxSpl ?? Infinity,
        m.sensitivityDb + 10 * Math.log10(m.speakerWatts),
      );
    }
    if (reference == null) return null;
    let attenuation = 0;
    const a = angles(speaker, point);
    if (
      m.horizontalDispersionDeg !== undefined &&
      m.verticalDispersionDeg !== undefined
    ) {
      attenuation = Math.min(
        30,
        6 *
          Math.max(
            (a.horizontal / (m.horizontalDispersionDeg / 2)) ** 2,
            (a.vertical / (m.verticalDispersionDeg / 2)) ** 2,
          ),
      );
    } else if (m.coverageDegrees !== undefined)
      attenuation = Math.min(30, 6 * (a.angle / (m.coverageDegrees / 2)) ** 2);
    const distance = Math.max(
      referenceDistance!,
      Math.hypot(
        point.x - speaker.position.x,
        point.y - speaker.position.y,
        point.z - speaker.position.z,
      ),
    );
    energy +=
      10 **
      ((reference -
        attenuation -
        20 * Math.log10(distance / referenceDistance!)) /
        10);
  }
  return energy > 0 ? 10 * Math.log10(energy) : null;
}
export type AudioStatus = "covered" | "edge" | "outside" | "unknown";
export interface AudioPoint {
  status: AudioStatus;
  distance: number;
  horizontal: number;
  vertical: number;
  angle: number;
  reasons: string[];
  spl: number | null;
}
export interface AudioSeat extends AudioPoint {
  id: string;
  position: XYZ;
}
export interface AudioDeviceResult {
  deviceId: string;
  origin: XYZ;
  direction: XYZ;
  segments: XYZ[][];
  seats: AudioSeat[];
  model: string;
  notes: string[];
}
export interface AudioSample {
  x: number;
  z: number;
  status: AudioStatus;
  spl: number | null;
}
export type AudioSeatSummary = Pick<
  AudioSeat,
  "id" | "position" | "status" | "reasons" | "spl"
>;
export interface AudioAnalysis {
  kind: "microphone" | "speaker";
  devices: AudioDeviceResult[];
  seats: AudioSeatSummary[];
  field: AudioSample[];
  missingSplDevices: string[];
  range: [number, number] | null;
  scope: string;
}
export function audioOrientation(d: PlacedDevice) {
  return new T.Quaternion()
    .setFromEuler(new T.Euler(d.rotation.x, d.rotation.y, d.rotation.z, "XYZ"))
    .multiply(
      d.surface === "ceiling"
        ? new T.Quaternion().setFromAxisAngle(
            new T.Vector3(1, 0, 0),
            Math.PI / 2,
          )
        : new T.Quaternion().setFromAxisAngle(
            new T.Vector3(0, 1, 0),
            surfaceYaw(d.surface),
          ),
    );
}
function angles(d: PlacedDevice, p: XYZ) {
  const v = vector(p)
    .sub(vector(d.position))
    .applyQuaternion(audioOrientation(d).invert());
  const distance = v.length();
  return {
    distance,
    horizontal: Math.atan2(Math.abs(v.x), v.z) * radToDeg,
    vertical: Math.atan2(Math.abs(v.y), v.z) * radToDeg,
    angle: distance
      ? Math.acos(T.MathUtils.clamp(v.z / distance, -1, 1)) * radToDeg
      : 0,
  };
}
function status(ratios: number[], unknown: boolean): AudioStatus {
  return ratios.some((r) => r > 1 + 1e-8)
    ? "outside"
    : unknown
      ? "unknown"
      : ratios.some((r) => r >= 0.9)
        ? "edge"
        : "covered";
}
export function microphonePoint(d: PlacedDevice, p: XYZ): AudioPoint {
  const a = angles(d, p),
    m = d.metadata,
    ratios: number[] = [],
    reasons: string[] = [];
  let unknown = false;
  if (m.micRadiusM !== undefined) {
    ratios.push(a.distance / m.micRadiusM);
    if (a.distance > m.micRadiusM + 1e-8)
      reasons.push("Outside preferred 3D pickup distance");
  } else {
    unknown = true;
    reasons.push("Pickup distance Unknown");
  }
  if (m.micModel === "cone" || m.micModel === "horizontal_sector") {
    if (m.micAngleDeg !== undefined) {
      const angle = m.micModel === "cone" ? a.angle : a.horizontal;
      ratios.push(angle / (m.micAngleDeg / 2));
      if (angle > m.micAngleDeg / 2 + 1e-8)
        reasons.push("Outside configured pickup angle");
    } else {
      unknown = true;
      reasons.push("Pickup angle Unknown");
    }
  } else if (m.micModel !== "omni" && m.micModel !== "radius_only") {
    unknown = true;
    reasons.push(
      "Pickup model Unknown; pattern name alone does not define coverage",
    );
  }
  const value = status(ratios, unknown);
  if (value === "edge")
    reasons.push("Within outer 10% of preferred radius or pickup half-angle");
  return { ...a, status: value, reasons, spl: null };
}
export function speakerPoint(d: PlacedDevice, p: XYZ): AudioPoint {
  const a = angles(d, p),
    m = d.metadata,
    ratios: number[] = [],
    reasons: string[] = [];
  let unknown = false;
  if (
    m.horizontalDispersionDeg !== undefined ||
    m.verticalDispersionDeg !== undefined
  ) {
    for (const [value, limit, label] of [
      [a.horizontal, m.horizontalDispersionDeg, "horizontal"],
      [a.vertical, m.verticalDispersionDeg, "vertical"],
    ] as const) {
      if (limit === undefined) {
        unknown = true;
        reasons.push(`${label} dispersion Unknown`);
      } else {
        ratios.push(value / (limit / 2));
        if (value > limit / 2 + 1e-8)
          reasons.push(`Outside ${label} dispersion`);
      }
    }
  } else if (m.coverageDegrees !== undefined) {
    ratios.push(a.angle / (m.coverageDegrees / 2));
    if (a.angle > m.coverageDegrees / 2 + 1e-8)
      reasons.push("Outside conical dispersion");
  } else {
    unknown = true;
    reasons.push("Dispersion Unknown");
  }
  const value = status(ratios, unknown);
  if (value === "edge")
    reasons.push("Within outer 10% of dispersion half-angle");
  const spl = unknown ? null : directSpl([d], p);
  if (spl === null)
    reasons.push(
      "SPL estimate unavailable — insufficient metadata or muted source",
    );
  return { ...a, status: value, reasons, spl };
}
export function combineLevels(levels: readonly number[]): number | null {
  if (!levels.length) return null;
  const max = Math.max(...levels);
  return (
    max +
    10 * Math.log10(levels.reduce((s, n) => s + 10 ** ((n - max) / 10), 0))
  );
}
export function unionCoverage(values: readonly AudioStatus[]): AudioStatus {
  return values.includes("covered")
    ? "covered"
    : values.includes("edge")
      ? "edge"
      : values.includes("unknown") || !values.length
        ? "unknown"
        : "outside";
}
function geometry(
  d: PlacedDevice,
  room: RoomSize,
  kind: "microphone" | "speaker",
): XYZ[][] {
  const m = d.metadata,
    q = audioOrientation(d),
    origin = vector(d.position),
    segments: XYZ[][] = [];
  const transform = (p: T.Vector3) => p.applyQuaternion(q).add(origin),
    extent =
      kind === "microphone"
        ? m.micRadiusM
        : Math.hypot(room.width, room.depth, room.height);
  if (!extent) return segments;
  if (
    kind === "microphone" &&
    (m.micModel === "omni" || m.micModel === "radius_only")
  ) {
    for (const axis of [0, 1, 2])
      segments.push(
        Array.from({ length: 65 }, (_, i) => {
          const a = (i * Math.PI) / 32,
            p = new T.Vector3();
          p.setComponent((axis + 1) % 3, Math.cos(a) * extent);
          p.setComponent((axis + 2) % 3, Math.sin(a) * extent);
          return transform(p);
        }),
      );
    return segments;
  }
  const angle = kind === "microphone" ? m.micAngleDeg : m.coverageDegrees;
  const h = m.horizontalDispersionDeg,
    v = m.verticalDispersionDeg;
  if (
    kind === "speaker" &&
    (h !== undefined || v !== undefined) &&
    (h === undefined || v === undefined || h >= 180 || v >= 180)
  )
    return segments;
  if (
    kind === "speaker" &&
    h !== undefined &&
    v !== undefined &&
    h < 180 &&
    v < 180
  ) {
    const points = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([x, y]) =>
      transform(
        new T.Vector3(
          x * Math.tan((h * Math.PI) / 360),
          y * Math.tan((v * Math.PI) / 360),
          1,
        )
          .normalize()
          .multiplyScalar(extent),
      ),
    );
    const faces = clipRoom(
      [
        points,
        ...points.map((p, i) => [origin, p, points[(i + 1) % points.length]]),
      ],
      room,
    );
    for (const face of faces) segments.push([...face, face[0]]);
  } else if (
    angle !== undefined &&
    (kind === "speaker" || m.micModel === "cone")
  ) {
    const half = (angle * Math.PI) / 360,
      ring = Array.from({ length: 65 }, (_, i) =>
        transform(
          new T.Vector3(
            Math.sin(half) * Math.cos((i * Math.PI) / 32),
            Math.sin(half) * Math.sin((i * Math.PI) / 32),
            Math.cos(half),
          ).multiplyScalar(extent),
        ),
      );
    segments.push(ring);
    for (const i of [0, 16, 32, 48]) segments.push([origin, ring[i]]);
  } else if (
    kind === "microphone" &&
    m.micModel === "horizontal_sector" &&
    angle !== undefined
  ) {
    const ring = Array.from({ length: 33 }, (_, i) => {
      const a = ((-angle / 2 + (angle * i) / 32) * Math.PI) / 180;
      return transform(
        new T.Vector3(Math.sin(a) * extent, 0, Math.cos(a) * extent),
      );
    });
    segments.push([origin, ...ring, origin]);
  }
  return segments;
}
/** Coverage is a union. Complete SPL uses incoherent energy summation; missing contributors keep total Unknown. */
export function analyzeAudio(
  state: Pick<DeviceState, "room" | "devices">,
  kind: "microphone" | "speaker",
  onlyId?: string,
): AudioAnalysis {
  const devices = Object.values(state.devices).filter(
    (d): d is PlacedDevice =>
      !!d &&
      d.kind === (kind === "microphone" ? "ceiling_mic" : "speaker") &&
      (!onlyId || d.id === onlyId),
  );
  const evaluate = kind === "microphone" ? microphonePoint : speakerPoint,
    seats = roomLayout(state.room).seats;
  const combine = (
    point: XYZ,
  ): Pick<AudioPoint, "status" | "reasons" | "spl"> => {
    const values = devices.map((d) => evaluate(d, point));
    const known = values.flatMap((v) => (v.spl === null ? [] : [v.spl]));
    const muted = devices.filter((d) => d.metadata.speakerWatts === 0).length;
    return {
      status: unionCoverage(values.map((v) => v.status)),
      reasons: values.flatMap((v, i) =>
        v.reasons.map((r) => `${devices[i].metadata.label}: ${r}`),
      ),
      spl:
        kind === "speaker" && known.length + muted === devices.length
          ? combineLevels(known)
          : null,
    };
  };
  const results: AudioDeviceResult[] = devices.map((d) => ({
    deviceId: d.id,
    origin: d.position,
    direction: new T.Vector3(0, 0, 1).applyQuaternion(audioOrientation(d)),
    segments: geometry(d, state.room, kind),
    seats: seats.map((s) => ({
      ...evaluate(d, s.position),
      id: s.id,
      position: s.position,
    })),
    model:
      kind === "microphone"
        ? (d.metadata.micModel ?? "Unknown")
        : d.metadata.horizontalDispersionDeg !== undefined ||
            d.metadata.verticalDispersionDeg !== undefined
          ? "horizontal / vertical"
          : d.metadata.coverageDegrees !== undefined
            ? "conical"
            : "Unknown",
    notes:
      kind === "microphone"
        ? [
            "Preferred 3D distance is a geometric planning boundary, not a measured polar response.",
            "Radius-only beamforming models do not simulate lobe steering.",
          ]
        : [
            "Free-field engineering estimate; source drive and reference conditions must be verified.",
            "No reflections, reverberation, absorption, boundary gain, EQ, noise or phase interference.",
            "Smooth assumed polar: −6 dB at nominal half-angle; not measured polar data.",
          ],
  }));
  const combined = seats.map((s) => ({
    ...combine(s.position),
    id: s.id,
    position: s.position,
  }));
  const field = sampleListeningPlane(state.room).map((p) => {
    const r = combine(p);
    return { x: p.x, z: p.z, status: r.status, spl: r.spl };
  });
  const levels = combined.flatMap((s) => (s.spl === null ? [] : [s.spl]));
  return {
    kind,
    devices: results,
    seats: combined,
    field,
    range:
      levels.length === seats.length && levels.length > 0
        ? [Math.min(...levels), Math.max(...levels)]
        : null,
    scope: onlyId ? "Selected device" : "All room devices",
    missingSplDevices:
      kind === "speaker"
        ? devices
            .filter(
              (d) =>
                d.metadata.speakerWatts !== 0 &&
                results
                  .find((r) => r.deviceId === d.id)
                  ?.seats.some((s) => s.spl === null),
            )
            .map((d) => d.metadata.label)
        : [],
  };
}
