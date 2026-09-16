import * as T from "three";
import type {
  DeviceState,
  EngineeringSettings,
  PlacedDevice,
  RoomSize,
  XYZ,
} from "./DeviceStore";
import { roomLayout } from "./RoomLayout";
import { surfaceYaw } from "./SpatialAssets";
import { summarizeBom } from "./BomSummary";
const radToDeg = 180 / Math.PI;
export function visualCheck(
  display: PlacedDevice,
  seat: XYZ,
  settings: EngineeringSettings,
) {
  const quaternion = new T.Quaternion().setFromEuler(
    new T.Euler(
      display.rotation.x,
      display.rotation.y,
      display.rotation.z,
      "XYZ",
    ),
  );
  quaternion.multiply(
    new T.Quaternion().setFromAxisAngle(
      new T.Vector3(0, 1, 0),
      surfaceYaw(display.surface),
    ),
  );
  const relative = new T.Vector3(
    seat.x - display.position.x,
    seat.y - display.position.y,
    seat.z - display.position.z,
  ).applyQuaternion(quaternion.invert());
  const height = display.metadata.imageHeightM ?? 0.8;
  const distance = Math.hypot(relative.x, relative.z);
  const horizontal = Math.abs(Math.atan2(relative.x, relative.z) * radToDeg);
  const vertical =
    Math.atan2(Math.abs(relative.y) + height / 2, Math.max(0.001, distance)) *
    radToDeg;
  const heuristicMax = height * settings.viewingRatio;
  // AVIXA public BDM acuity factor 200; element percentage is a content assumption.
  const bdmMax = ((height * settings.elementPercent) / 100) * 200;
  const pass =
    relative.z > 0 &&
    distance <= Math.min(heuristicMax, bdmMax) &&
    horizontal <= settings.horizontalLimit &&
    vertical <= settings.verticalLimit;
  return { distance, horizontal, vertical, heuristicMax, bdmMax, pass };
}
/** Incoherent free-field energy sum, specified on-axis SPL at 1m, no room gain/directivity. */
export function directSpl(
  speakers: readonly PlacedDevice[],
  point: XYZ,
): number | null {
  let energy = 0;
  for (const speaker of speakers) {
    if (speaker.metadata.splAt1m == null) continue;
    const distance = Math.max(
      1,
      Math.hypot(
        point.x - speaker.position.x,
        point.y - speaker.position.y,
        point.z - speaker.position.z,
      ),
    );
    energy +=
      10 ** ((speaker.metadata.splAt1m - 20 * Math.log10(distance)) / 10);
  }
  return energy > 0 ? 10 * Math.log10(energy) : null;
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
  for (let z = -room.depth / 2 + 0.25; z < room.depth / 2; z += 0.5)
    for (let x = -room.width / 2 + 0.25; x < room.width / 2; x += 0.5) {
      const spl = directSpl(speakers, { x, y: 1.2, z });
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
  if (!displays.length) warnings.push("Visual: no display placed.");
  else if (failures.length)
    warnings.push(
      `Visual: ${failures.length}/${seats.length} seats outside planning limits (${failures.map((s) => s.id).join(", ")}).`,
    );
  const back = visual.find((s) => s.id === "Back");
  if (back?.results.length && !back.results.some((r) => r.pass))
    warnings.push(
      `Back row: ${Math.min(...back.results.map((r) => r.distance)).toFixed(2)} m to nearest display; increase image height or reduce distance.`,
    );
  if (!speakers.length || speakers.some((s) => s.metadata.splAt1m == null))
    warnings.push(
      "Acoustic: missing speaker reference SPL; map is incomplete.",
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
      speakers.every((s) => s.metadata.splAt1m != null) &&
      levels.every((l) => l >= state.engineering.targetSpl),
    devices.length > 0 &&
      !bom.incomplete &&
      bom.power <= state.engineering.powerBudget,
    devices.length > 0 &&
      !bom.incomplete &&
      bom.heat <= state.engineering.heatBudget,
    devices.length > 0 && unconnected === 0,
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
