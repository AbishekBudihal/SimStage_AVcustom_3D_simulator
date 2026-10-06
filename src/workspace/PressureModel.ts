import { environmentBlocker } from "./EnvironmentImport";
import type { DeviceState, PlacedDevice, XYZ } from "./DeviceStore";
import { roomLayout } from "./RoomLayout";
import { audioOrientation } from "./AudioEngineering";
import { Vector3 } from "three";

/** User-authored response samples; interpolation never makes them measured data. */
export interface AcousticBand {
  hz: number;
  sensitivityDb: number;
  horizontalDeg: number;
  verticalDeg: number;
}
export interface PressureSettings {
  signal: "pink" | "speech" | "sine";
  lowHz: number;
  highHz: number;
  toneHz: number;
  surface: "audience" | "surfaces";
  audienceHeight: number;
  audienceRise: number;
  spacing: number;
  reflections: boolean;
  absorption: number;
  obstruction: boolean;
  minimumDb: number;
  maximumDb: number;
}
export const DEFAULT_PRESSURE: Readonly<PressureSettings> = Object.freeze({
  signal: "pink",
  lowHz: 125,
  highHz: 8000,
  toneHz: 1000,
  surface: "audience",
  audienceHeight: 1.2,
  audienceRise: 0,
  spacing: 0.25,
  reflections: false,
  absorption: 0.3,
  obstruction: true,
  minimumDb: 40,
  maximumDb: 100,
});
export function validateBands(bands: readonly AcousticBand[]) {
  if (bands.length < 2 || bands.length > 256)
    throw new Error("Enter 2–256 frequency rows");
  for (const [i, b] of bands.entries())
    if (
      !Object.values(b).every(Number.isFinite) ||
      b.hz < 20 ||
      b.hz > 20000 ||
      b.sensitivityDb < 0 ||
      b.sensitivityDb > 150 ||
      b.horizontalDeg <= 0 ||
      b.horizontalDeg > 360 ||
      b.verticalDeg <= 0 ||
      b.verticalDeg > 360 ||
      (i > 0 && b.hz <= bands[i - 1].hz)
    )
      throw new Error(
        "Frequency rows must ascend from 20–20000 Hz, with valid sensitivity and dispersion",
      );
}
export function validatePressure(s: PressureSettings) {
  if (
    !["pink", "speech", "sine"].includes(s.signal) ||
    !["audience", "surfaces"].includes(s.surface) ||
    ![
      s.lowHz,
      s.highHz,
      s.toneHz,
      s.audienceHeight,
      s.audienceRise,
      s.spacing,
      s.absorption,
      s.minimumDb,
      s.maximumDb,
    ].every(Number.isFinite) ||
    s.lowHz < 20 ||
    s.highHz > 20000 ||
    s.lowHz >= s.highHz ||
    s.toneHz < 20 ||
    s.toneHz > 20000 ||
    s.audienceHeight < 0 ||
    s.audienceHeight > 8 ||
    s.audienceRise < 0 ||
    s.audienceRise > 6 ||
    s.spacing < 0.1 ||
    s.spacing > 1 ||
    s.absorption < 0 ||
    s.absorption > 1 ||
    s.minimumDb < 0 ||
    s.maximumDb > 150 ||
    s.minimumDb >= s.maximumDb ||
    typeof s.reflections !== "boolean" ||
    typeof s.obstruction !== "boolean"
  )
    throw new Error("Invalid pressure-map settings");
}
export function responseAt(d: PlacedDevice, hz: number): AcousticBand | null {
  const bands = d.metadata.acousticBands;
  if (bands?.length) {
    if (hz < bands[0].hz - 1e-8 || hz > bands[bands.length - 1].hz + 1e-8)
      return null;
    const index = bands.findIndex((b) => b.hz >= hz);
    if (index <= 0) return bands[0];
    const a = bands[index - 1],
      b = bands[index],
      t = Math.log(hz / a.hz) / Math.log(b.hz / a.hz);
    return {
      hz,
      sensitivityDb: a.sensitivityDb + (b.sensitivityDb - a.sensitivityDb) * t,
      horizontalDeg: a.horizontalDeg + (b.horizontalDeg - a.horizontalDeg) * t,
      verticalDeg: a.verticalDeg + (b.verticalDeg - a.verticalDeg) * t,
    };
  }
  const m = d.metadata,
    h = m.horizontalDispersionDeg ?? m.coverageDegrees,
    v = m.verticalDispersionDeg ?? m.coverageDegrees;
  return m.sensitivityDb === undefined || h === undefined || v === undefined
    ? null
    : { hz, sensitivityDb: m.sensitivityDb, horizontalDeg: h, verticalDeg: v };
}
/** Constant fractional-octave bins; clipped edge widths conserve total drive power. */
export function signalBands(
  s: PressureSettings,
): { hz: number; weight: number }[] {
  if (s.signal === "sine") return [{ hz: s.toneHz, weight: 1 }];
  const first = 12 * Math.log2(s.lowHz / 1000),
    last = 12 * Math.log2(s.highHz / 1000),
    bands: { hz: number; weight: number }[] = [];
  for (let n = Math.floor(first - 0.5); n <= Math.ceil(last + 0.5); n++) {
    const left = Math.max(first, n - 0.5),
      right = Math.min(last, n + 0.5);
    if (right <= left) continue;
    const hz = 1000 * 2 ** ((left + right) / 2 / 12);
    // Editable response data plus a deliberately generic speech-shaped spectrum.
    const speechDb = -6 * Math.abs(Math.log2(hz / 1000));
    bands.push({
      hz,
      weight:
        (right - left) * (s.signal === "speech" ? 10 ** (speechDb / 10) : 1),
    });
  }
  const total = bands.reduce((n, b) => n + b.weight, 0);
  return bands.map((b) => ({ ...b, weight: b.weight / total }));
}
export interface AcousticBox {
  min: XYZ;
  max: XYZ;
}
export function segmentBlocked(
  a: XYZ,
  b: XYZ,
  boxes: readonly AcousticBox[],
): boolean {
  return boxes.some((box) => {
    let near = 0,
      far = 1;
    for (const axis of ["x", "y", "z"] as const) {
      const delta = b[axis] - a[axis];
      if (Math.abs(delta) < 1e-10) {
        if (a[axis] < box.min[axis] || a[axis] > box.max[axis]) return false;
        continue;
      }
      const t1 = (box.min[axis] - a[axis]) / delta,
        t2 = (box.max[axis] - a[axis]) / delta;
      near = Math.max(near, Math.min(t1, t2));
      far = Math.min(far, Math.max(t1, t2));
      if (far < near) return false;
    }
    // Surface contact at the receiver/source is not an obstruction.
    return far > 1e-5 && near < 1 - 1e-5 && far - near > 1e-6;
  });
}
export type PressureInput = Pick<DeviceState, "devices" | "room"> &
  Partial<Pick<DeviceState, "environment">>;
export interface SoundPath {
  distance: number;
  direction: XYZ;
  reflected: boolean;
}
export function soundPaths(
  source: XYZ,
  receiver: XYZ,
  room: DeviceState["room"],
  boxes: readonly AcousticBox[],
  reflections: boolean,
  importedBlocked: (a: XYZ, b: XYZ) => boolean = () => false,
): SoundPath[] {
  const paths: SoundPath[] = [];
  const length = (a: XYZ, b: XYZ) =>
    Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const direction = (p: XYZ) => ({
    x: p.x - source.x,
    y: p.y - source.y,
    z: p.z - source.z,
  });
  if (
    !segmentBlocked(source, receiver, boxes) &&
    !importedBlocked(source, receiver)
  )
    paths.push({
      distance: length(source, receiver),
      direction: direction(receiver),
      reflected: false,
    });
  if (!reflections) return paths;
  const bounds = {
    x: [-room.width / 2, room.width / 2],
    y: [0, room.height],
    z: [-room.depth / 2, room.depth / 2],
  };
  for (const axis of ["x", "y", "z"] as const)
    for (const boundary of bounds[axis]) {
      const image = { ...source, [axis]: 2 * boundary - source[axis] },
        denominator = receiver[axis] - image[axis];
      if (Math.abs(denominator) < 1e-10) continue;
      const t = (boundary - image[axis]) / denominator;
      if (t <= 1e-6 || t >= 1 - 1e-6) continue;
      const bounce = {
        x: image.x + t * (receiver.x - image.x),
        y: image.y + t * (receiver.y - image.y),
        z: image.z + t * (receiver.z - image.z),
      };
      if (
        (["x", "y", "z"] as const).some(
          (k) =>
            bounce[k] < bounds[k][0] - 1e-6 || bounce[k] > bounds[k][1] + 1e-6,
        )
      )
        continue;
      if (
        segmentBlocked(source, bounce, boxes) ||
        segmentBlocked(bounce, receiver, boxes) ||
        importedBlocked(source, bounce) ||
        importedBlocked(bounce, receiver)
      )
        continue;
      paths.push({
        distance: length(source, bounce) + length(bounce, receiver),
        direction: direction(bounce),
        reflected: true,
      });
    }
  return paths;
}
function obstacles(state: PressureInput): AcousticBox[] {
  const tables = roomLayout(state.room).tables.map((t) => ({
    min: { x: t.x - t.width / 2, y: t.height - 0.075, z: t.z - t.depth / 2 },
    max: { x: t.x + t.width / 2, y: t.height, z: t.z + t.depth / 2 },
  }));
  for (const d of Object.values(state.devices))
    if (d?.kind === "rack" && d.dimensions && d.surface === "floor") {
      // World-aligned conservative envelope of the rotated equipment box.
      const half = new Vector3(
          d.dimensions.x / 2,
          d.dimensions.y / 2,
          d.dimensions.z / 2,
        ),
        q = audioOrientation(d),
        points: Vector3[] = [];
      for (const x of [-half.x, half.x])
        for (const y of [0, d.dimensions.y])
          for (const z of [-half.z, half.z])
            points.push(
              new Vector3(x, y, z)
                .applyQuaternion(q)
                .add(new Vector3(d.position.x, d.position.y, d.position.z)),
            );
      tables.push({
        min: {
          x: Math.min(...points.map((p) => p.x)),
          y: Math.min(...points.map((p) => p.y)),
          z: Math.min(...points.map((p) => p.z)),
        },
        max: {
          x: Math.max(...points.map((p) => p.x)),
          y: Math.max(...points.map((p) => p.y)),
          z: Math.max(...points.map((p) => p.z)),
        },
      });
    }
  return tables;
}
export interface PressureSurface {
  id: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  rise: number;
  columns: number;
  rows: number;
  levels: (number | null)[];
}
export interface PressureResult {
  surfaces: PressureSurface[];
  minimum: number | null;
  maximum: number | null;
  unknown: number;
  blocked: number;
  sampleCount: number;
  frequencyCount: number;
  warnings: string[];
}
/** Estimated parametric polar response. No measured phase, diffraction, or room modal solution. */
export function pressureMap(
  state: PressureInput,
  s: PressureSettings,
): PressureResult {
  validatePressure(s);
  if (
    s.surface === "audience" &&
    s.audienceHeight + s.audienceRise >= state.room.height
  )
    throw new Error("Audience plane must remain below the ceiling");
  const importedBlocked = environmentBlocker(
    s.obstruction ? state.environment : null,
  );
  const bands = signalBands(s),
    boxes = s.obstruction ? obstacles(state) : [];
  const all = Object.values(state.devices).filter(
    (d): d is PlacedDevice => !!d && d.kind === "speaker",
  );
  const warnings: string[] = [];
  if (state.environment)
    warnings.push(
      "Imported meshes cast geometric shadows. Reflections still use the rectangular room; imported audience blocks do not create listener seats. Optical and quick coverage layers do not test imported obstructions.",
    );
  const sources = all
    .filter((d) => d.metadata.speakerWatts !== 0)
    .map((d) => {
      const response = bands.map((b) => responseAt(d, b.hz)),
        power = d.metadata.speakerWatts;
      const outside =
        Math.abs(d.position.x) > state.room.width / 2 ||
        Math.abs(d.position.z) > state.room.depth / 2 ||
        d.position.y < 0 ||
        d.position.y > state.room.height;
      const valid =
        !outside && power !== undefined && response.every((b) => b !== null);
      if (!valid)
        warnings.push(
          `${d.metadata.label}: ${outside ? "source outside room" : power === undefined ? "drive power missing" : "sensitivity/dispersion or frequency range incomplete"}`,
        );
      if (!d.metadata.acousticBands)
        warnings.push(
          `${d.metadata.label}: flat sensitivity and constant dispersion assumed across frequency`,
        );
      return {
        d,
        response,
        power: power ?? 0,
        valid,
        inverse: audioOrientation(d).invert(),
      };
    });
  if (!all.length) warnings.push("No speakers placed");
  if (s.signal === "sine" && sources.length > 1)
    warnings.push(
      "Sine sources are phase-locked; entered phase/delay controls their coherent sum. Measured phase response is unavailable.",
    );
  const tables = roomLayout(state.room).tables;
  const patches =
    s.surface === "audience"
      ? [
          {
            id: "audience",
            x: 0,
            z: 0,
            width: state.room.width,
            depth: state.room.depth,
            height: s.audienceHeight,
            rise: s.audienceRise,
          },
        ]
      : [
          {
            id: "floor",
            x: 0,
            z: 0,
            width: state.room.width,
            depth: state.room.depth,
            height: 0,
            rise: 0,
          },
          ...tables.map((t, i) => ({
            id: `table:${i}`,
            x: t.x,
            z: t.z,
            width: t.width,
            depth: t.depth,
            height: t.height,
            rise: 0,
          })),
        ];
  let minimum = Infinity,
    maximum = -Infinity,
    unknown = 0,
    blocked = 0,
    sampleCount = 0;
  // Bound work and texture size even for maximum-size rooms and many desks.
  const totalArea = patches.reduce((a, p) => a + p.width * p.depth, 0),
    spacing = Math.max(s.spacing, Math.sqrt(totalArea / 12000));
  if (
    s.signal === "sine" &&
    (sources.length > 1 || s.reflections) &&
    spacing > 343 / s.toneHz / 4
  )
    warnings.push(
      "Sine interference is spatially under-resolved at this grid spacing; smooth shading cannot recover missed peaks/nulls.",
    );
  const surfaces = patches.map((p) => {
    const columns = Math.ceil(p.width / spacing) + 1,
      rows = Math.ceil(p.depth / spacing) + 1,
      levels: (number | null)[] = [];
    for (let row = 0; row < rows; row++)
      for (let col = 0; col < columns; col++) {
        sampleCount++;
        const receiver = {
          x: p.x - p.width / 2 + (col * p.width) / (columns - 1),
          y: p.height + (p.rise * row) / (rows - 1),
          z: p.z - p.depth / 2 + (row * p.depth) / (rows - 1),
        };
        if (!all.length || sources.some((d) => !d.valid)) {
          levels.push(null);
          unknown++;
          continue;
        }
        const paths = sources.map((source) =>
          soundPaths(
            source.d.position,
            receiver,
            state.room,
            boxes,
            s.reflections,
            importedBlocked,
          ),
        );
        if (sources.length && paths.every((p) => p.length === 0)) blocked++;
        const localPaths = paths.map((paths, i) =>
          paths.map((path) => {
            const direction = new Vector3(
              path.direction.x,
              path.direction.y,
              path.direction.z,
            ).applyQuaternion(sources[i].inverse);
            return {
              ...path,
              horizontal:
                (Math.abs(Math.atan2(direction.x, direction.z)) * 180) /
                Math.PI,
              vertical:
                (Math.abs(
                  Math.atan2(direction.y, Math.hypot(direction.x, direction.z)),
                ) *
                  180) /
                Math.PI,
            };
          }),
        );
        let energy = 0;
        for (let band = 0; band < bands.length; band++) {
          let real = 0,
            imaginary = 0,
            bandEnergy = 0;
          for (let i = 0; i < sources.length; i++) {
            const source = sources[i],
              response = source.response[band]!;
            for (const path of localPaths[i]) {
              const gain = path.reflected ? 1 - s.absorption : 1;
              if (gain <= 0 || source.power <= 0) continue;
              const loss = Math.min(
                60,
                6 *
                  Math.max(
                    response.horizontalDeg === 360
                      ? 0
                      : (path.horizontal / (response.horizontalDeg / 2)) ** 2,
                    response.verticalDeg === 360
                      ? 0
                      : (path.vertical / (response.verticalDeg / 2)) ** 2,
                  ),
              );
              const level =
                response.sensitivityDb +
                10 * Math.log10(source.power * bands[band].weight * gain) -
                loss -
                20 * Math.log10(Math.max(1, path.distance));
              const power = 10 ** (level / 10);
              if (s.signal !== "sine") bandEnergy += power;
              else {
                const phase =
                  ((source.d.metadata.acousticPhaseDeg ?? 0) * Math.PI) / 180 -
                  2 *
                    Math.PI *
                    bands[band].hz *
                    (path.distance / 343 +
                      (source.d.metadata.acousticDelayMs ?? 0) / 1000);
                const amplitude = Math.sqrt(power);
                real += amplitude * Math.cos(phase);
                imaginary += amplitude * Math.sin(phase);
              }
            }
          }
          energy +=
            s.signal === "sine"
              ? real * real + imaginary * imaginary
              : bandEnergy;
        }
        const level = 10 * Math.log10(Math.max(1e-12, energy));
        levels.push(level);
        minimum = Math.min(minimum, level);
        maximum = Math.max(maximum, level);
      }
    return { ...p, columns, rows, levels };
  });
  if (spacing > s.spacing + 1e-6)
    warnings.push(
      `Sampling coarsened to ${spacing.toFixed(2)} m to bound computation`,
    );
  return {
    surfaces,
    minimum: minimum === Infinity ? null : minimum,
    maximum: maximum === -Infinity ? null : maximum,
    unknown,
    blocked,
    sampleCount,
    frequencyCount: bands.length,
    warnings,
  };
}

export function parseBandText(
  text: string,
): readonly AcousticBand[] | undefined {
  if (!text.trim()) return undefined;
  const bands = text
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const values = line.split(",").map((x) => x.trim());
      if (values.length !== 4 || values.some((x) => x === ""))
        throw new Error(
          "Each response row needs Hz, sensitivity, horizontal dispersion, vertical dispersion",
        );
      const [hz, sensitivityDb, horizontalDeg, verticalDeg] =
        values.map(Number);
      return { hz, sensitivityDb, horizontalDeg, verticalDeg };
    });
  validateBands(bands);
  return bands;
}
