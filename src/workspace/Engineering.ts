import { directSpl } from "./AudioEngineering";
export { directSpl } from "./AudioEngineering";
import { sampleListeningPlane } from "./ListeningGrid";
import { screenOrigin, orientation } from "./OpticalTransform";
import * as T from "three";
import type {
  DeviceState,
  EngineeringSettings,
  PlacedDevice,
  RoomSize,
  XYZ,
} from "./DeviceStore";
import { roomLayout, eyeHeight } from "./RoomLayout";
import { mountYaw as surfaceYaw } from "./OpticalTransform";
import { summarizeBom } from "./BomSummary";
const radToDeg = 180 / Math.PI;
export function visualCheck(
  display: PlacedDevice,
  seat: XYZ,
  settings: EngineeringSettings,
) {
  return visualEvaluator(display, settings)(seat);
}
function visualEvaluator(display: PlacedDevice, settings: EngineeringSettings) {
  const quaternion = orientation(display).invert();
  const relative = new T.Vector3();
  const origin = screenOrigin(display);
  return (seat: XYZ) => {
    relative
      .set(seat.x - origin.x, seat.y - origin.y, seat.z - origin.z)
      .applyQuaternion(quaternion);
    const height = display.metadata.imageHeightM ?? 0;
    const distance = Math.hypot(relative.x, relative.z);
    const horizontal = Math.abs(Math.atan2(relative.x, relative.z) * radToDeg);
    const vertical =
      Math.atan2(Math.abs(relative.y) + height / 2, Math.max(0.001, distance)) *
      radToDeg;
    const heuristicMax = height * settings.viewingRatio;
    // AVIXA public BDM acuity factor 200; element percentage is a content assumption.
    const bdmMax = ((height * settings.elementPercent) / 100) * 200;
    const pass =
      height > 0 &&
      relative.z > 0 &&
      distance <= Math.min(heuristicMax, bdmMax) &&
      horizontal <= settings.horizontalLimit &&
      vertical <= settings.verticalLimit;
    const margin = Math.max(
      distance / Math.min(heuristicMax, bdmMax),
      horizontal / settings.horizontalLimit,
      vertical / settings.verticalLimit,
    );
    const status: "green" | "yellow" | "red" | "unknown" =
      height <= 0
        ? "unknown"
        : !pass
          ? "red"
          : margin >= 0.9
            ? "yellow"
            : "green";
    return {
      distance,
      horizontal,
      vertical,
      heuristicMax,
      bdmMax,
      pass,
      status,
    };
  };
}
/** Broadband MTF proxy only. Not IEC 60268-16 STI: no octave spectra/masking/echoes. */
export function intelligibilityProxy(
  spl: number | null,
  noise: number | null,
  rt60: number | null,
): number | null {
  if (spl === null || noise === null || rt60 === null) return null;
  const frequencies = [
    0.63, 0.8, 1, 1.25, 1.6, 2, 2.5, 3.15, 4, 5, 6.3, 8, 10, 12.5,
  ];
  return (
    frequencies.reduce((sum, f) => {
      const m = Math.min(
        0.999999,
        1 /
          Math.sqrt(1 + ((2 * Math.PI * f * rt60) / 13.8) ** 2) /
          (1 + 10 ** ((noise - spl) / 10)),
      );
      const snr = 10 * Math.log10(m / (1 - m));
      return sum + (Math.max(-15, Math.min(15, snr)) + 15) / 30;
    }, 0) / frequencies.length
  );
}
export interface FieldPoint {
  x: number;
  z: number;
  spl: number | null;
  intelligibility: number | null;
}
/** Seat-plane slice of the viewing region. Boundaries use the same checks as seat markers,
 * including all Euler rotations. Grid cells with unknown image size produce no region.
 * Each boundary segment is projected to the floor for legibility. */
export function visualRegionBoundary(
  display: PlacedDevice,
  settings: EngineeringSettings,
  room: RoomSize,
): number[] {
  if (!display.metadata.imageHeightM) return [];
  const step = 0.25,
    cols = Math.ceil(room.width / step),
    rows = Math.ceil(room.depth / step);
  const dx = room.width / cols,
    dz = room.depth / rows;
  const cells = new Uint8Array(cols * rows),
    check = visualEvaluator(display, settings);
  for (let z = 0; z < rows; z++)
    for (let x = 0; x < cols; x++)
      cells[z * cols + x] = Number(
        check({
          x: -room.width / 2 + (x + 0.5) * dx,
          y: eyeHeight(room),
          z: -room.depth / 2 + (z + 0.5) * dz,
        }).pass,
      );
  const vertices: number[] = [];
  const line = (x1: number, z1: number, x2: number, z2: number) =>
    vertices.push(x1, 0.08, z1, x2, 0.08, z2);
  for (let z = 0; z < rows; z++)
    for (let x = 0; x < cols; x++)
      if (cells[z * cols + x]) {
        const left = -room.width / 2 + x * dx,
          top = -room.depth / 2 + z * dz;
        if (x === 0 || !cells[z * cols + x - 1])
          line(left, top, left, top + dz);
        if (x === cols - 1 || !cells[z * cols + x + 1])
          line(left + dx, top, left + dx, top + dz);
        if (z === 0 || !cells[(z - 1) * cols + x])
          line(left, top, left + dx, top);
        if (z === rows - 1 || !cells[(z + 1) * cols + x])
          line(left, top + dz, left + dx, top + dz);
      }
  return vertices;
}
export function engineeringAudit(state: DeviceState, room: RoomSize) {
  const devices = Object.values(state.devices).filter(
    (d): d is PlacedDevice => !!d,
  );
  const displays = devices.filter((d) => d.kind === "display"),
    speakers = devices.filter((d) => d.kind === "speaker");
  const seats = roomLayout(room).seats;
  const visual = seats.map((seat) => ({
    ...seat,
    results: displays.map((d) => ({
      deviceId: d.id,
      ...visualCheck(d, seat.position, state.engineering),
    })),
  }));
  const failures = visual.filter((s) => !s.results.some((r) => r.pass));
  const field: FieldPoint[] = [];
  for (const { x, y, z } of sampleListeningPlane(room)) {
    const spl = directSpl(speakers, { x, y, z });
    field.push({
      x,
      z,
      spl,
      intelligibility: intelligibilityProxy(
        spl,
        state.engineering.noiseDb,
        state.engineering.rt60,
      ),
    });
  }
  const levels = seats
    .map((seat) => directSpl(speakers, seat.position))
    .filter((n): n is number => n !== null);
  const bom = summarizeBom(state.devices),
    warnings: string[] = [];
  if (room.capacity !== undefined && seats.length < room.capacity)
    warnings.push(
      `Layout: ${seats.length} of ${room.capacity} requested seats fit; enlarge the room or reduce capacity.`,
    );
  for (const device of devices)
    if (
      Math.abs(device.position.x) > room.width / 2 ||
      Math.abs(device.position.z) > room.depth / 2 ||
      device.position.y > room.height
    )
      warnings.push(
        `Placement: ${device.metadata.label} is outside the resized room; manual position preserved.`,
      );
  if (!displays.length) warnings.push("Visual: no display placed.");
  else if (failures.length)
    warnings.push(
      `Visual: ${failures.length}/${seats.length} seats outside planning limits (${failures.map((s) => s.id).join(", ")}).`,
    );
  if (displays.some((d) => !d.metadata.imageHeightM))
    warnings.push(
      "Visual: image height is missing; no assumed screen size is used.",
    );
  const missingPorts = devices.filter(
    (d) => !d.ports.length && d.kind !== "rack",
  ).length;
  if (missingPorts)
    warnings.push(
      `Wiring: ${missingPorts} devices have no supplied port definitions; mapping is incomplete.`,
    );
  const back = visual.find((s) => s.id === "Back");
  if (back?.results.length && !back.results.some((r) => r.pass))
    warnings.push(
      `Back row: ${Math.min(...back.results.map((r) => r.distance)).toFixed(2)} m to nearest display; increase image height or reduce distance.`,
    );
  const hasReference = (s: PlacedDevice) =>
    (s.metadata.referenceSplDb !== undefined &&
      s.metadata.referenceDistanceM !== undefined) ||
    s.metadata.splAt1m != null ||
    (s.metadata.sensitivityDb !== undefined &&
      s.metadata.speakerWatts !== undefined);
  if (!speakers.length || speakers.some((s) => !hasReference(s)))
    warnings.push(
      "Acoustic: missing speaker reference SPL; map is incomplete.",
    );
  if (speakers.some((s) => s.metadata.speakerWatts === 0))
    warnings.push("Acoustic: a speaker has zero drive power (muted).");
  if (speakers.some((s) => s.metadata.sensitivityDb !== undefined))
    warnings.push(
      "Acoustic: drive power is an assumption; amplifier routing, headroom and transformer taps are not verified.",
    );
  if (levels.some((level) => level < state.engineering.targetSpl))
    warnings.push(
      `Acoustic: ${levels.filter((l) => l < state.engineering.targetSpl).length} seats below ${state.engineering.targetSpl} dB planning target.`,
    );
  if (state.engineering.noiseDb === null || state.engineering.rt60 === null)
    warnings.push(
      "Intelligibility proxy unavailable: enter background noise and RT60.",
    );
  if (bom.incomplete)
    warnings.push(
      `Loads: ${bom.incomplete} devices have unknown power or heat.`,
    );
  if (bom.power > state.engineering.powerBudget)
    warnings.push(
      `Power: ${bom.power.toFixed(0)} W exceeds ${state.engineering.powerBudget} W budget.`,
    );
  if (bom.heat > state.engineering.heatBudget)
    warnings.push(
      `Thermal: ${bom.heat.toFixed(0)} BTU/h exceeds ${state.engineering.heatBudget} BTU/h budget.`,
    );
  const unconnected = devices.reduce(
    (sum, d) =>
      sum +
      d.ports.filter(
        (p) =>
          p.direction === "input" &&
          !state.connections.some(
            (c) => c.to.deviceId === d.id && c.to.portId === p.id,
          ),
      ).length,
    0,
  );
  if (unconnected)
    warnings.push(
      `Wiring: ${unconnected} input ports are not connected (some may be optional).`,
    );
  // Equal-weight, published planning checks; unknown categories explicitly fail readiness.
  const checks = [
    displays.length > 0 && !failures.length,
    speakers.length > 0 &&
      speakers.every(hasReference) &&
      levels.length === seats.length &&
      levels.every((l) => l >= state.engineering.targetSpl),
    devices.length > 0 &&
      !bom.incomplete &&
      bom.power <= state.engineering.powerBudget,
    devices.length > 0 &&
      !bom.incomplete &&
      bom.heat <= state.engineering.heatBudget,
    devices.length > 0 && unconnected === 0 && missingPorts === 0,
  ];
  return {
    visual,
    field,
    bom,
    warnings,
    score: Math.round((checks.filter(Boolean).length / checks.length) * 100),
    seats: seats.length,
    splMin: levels.length ? Math.min(...levels) : null,
    splMax: levels.length ? Math.max(...levels) : null,
  };
}
export type Audit = ReturnType<typeof engineeringAudit>;
