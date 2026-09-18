import type { CatalogCategory } from "./CatalogQuery";
import { defaultIntent } from "./PlacementSolver";
import displays from "../../data/displays.json";
import cameras from "../../data/cameras.json";
import microphones from "../../data/microphones.json";
import speakers from "../../data/speakers.json";
import systems from "../../data/system-devices.json";
import {
  snapToSurface,
  type DeviceKind,
  type DevicePort,
  type MountSurface,
  type NewDevice,
  type RoomSize,
  type XYZ,
} from "./DeviceStore";

type RecordData = Record<string, unknown>;
export interface CatalogProfile {
  readonly id: string;
  readonly manufacturer: string;
  readonly model: string;
  readonly category: CatalogCategory | "source";
  readonly kind: DeviceKind;
  readonly dimensions: XYZ;
  readonly surface: MountSurface;
  readonly surfaces: readonly MountSurface[];
  readonly ports: readonly DevicePort[];
  readonly metadata: NewDevice["metadata"];
  readonly provenance: string;
  readonly source: string;
  readonly sourceFile: string;
  readonly notes: string;
  readonly raw: Readonly<RecordData>;
}
const record = (value: unknown, name: string): RecordData => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${name}: expected an object`);
  return value as RecordData;
};
const optionalRecord = (value: unknown): RecordData =>
  value === undefined ? {} : record(value, "specification");
const string = (v: unknown, name: string): string => {
  if (typeof v !== "string" || !v.trim())
    throw new Error(`${name}: expected text`);
  return v;
};
const number = (v: unknown, name: string): number | undefined => {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0)
    throw new Error(`${name}: expected a nonnegative finite number`);
  return v;
};
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
const kinds: Record<string, DeviceKind> = {
  projector: "source",
  av_over_ip: "extender",
  custom: "source",
  display: "display",
  camera: "ptz_camera",
  microphone: "ceiling_mic",
  speaker: "speaker",
  rack: "rack",
  source: "source",
  switcher: "matrix",
  extender: "extender",
  dsp: "dsp",
  amplifier: "amplifier",
  network: "network",
  control: "control",
  codec: "codec",
};
const walls: MountSurface[] = ["north", "south", "east", "west"];

/** Validate uploaded JSON before publishing it. Keep original records and provenance intact. */
export function parseCatalog(
  input: unknown,
  sourceFile = "uploaded JSON",
): readonly CatalogProfile[] {
  if (!Array.isArray(input) || input.length > 5000)
    throw new Error("Catalog must be an array of at most 5000 records");
  const ids = new Set<string>();
  return Object.freeze(
    input.map((value, index) => {
      const raw = record(structuredClone(value), `record ${index + 1}`),
        id = string(raw.id, "id");
      if (ids.has(id)) throw new Error(`Duplicate catalog ID: ${id}`);
      ids.add(id);
      const category = string(raw.category, "category") as
          CatalogCategory | "source",
        kind = kinds[category];
      if (!Object.prototype.hasOwnProperty.call(kinds, category))
        throw new Error(`${id}: unsupported category ${category}`);
      const physical = record(raw.physical, `${id}.physical`);
      const dimensions = {
        x: number(physical.width, "width") ?? 0,
        y: number(physical.height, "height") ?? 0,
        z: number(physical.depth, "depth") ?? 0,
      };
      if (Object.values(dimensions).some((n) => n <= 0 || n > 100))
        throw new Error(`${id}: dimensions must be in metres, >0 and <=100`);
      const mounting = optionalRecord(raw.mounting),
        speaker = optionalRecord(raw.speaker),
        mic = optionalRecord(raw.microphone),
        camera = optionalRecord(raw.camera),
        display = optionalRecord(raw.display);
      for (const field of [
        "horizontalFovDeg",
        "verticalFovDeg",
        "diagonalFovDeg",
      ]) {
        const value = number(camera[field], field);
        if (value !== undefined && (value <= 0 || value >= 180))
          throw new Error(`${id}: invalid ${field}`);
      }
      const declared = speaker.mount ?? mic.mount ?? camera.mount;
      const surfaces: MountSurface[] = [];
      if (mounting.wall === true || declared === "wall")
        surfaces.push(...walls);
      if (mounting.ceiling === true || declared === "ceiling")
        surfaces.push("ceiling");
      if (
        mounting.floor === true ||
        mounting.freestanding === true ||
        declared === "floor"
      )
        surfaces.push("floor");
      if (mounting.table === true || declared === "table")
        surfaces.push("table");
      const fallback: MountSurface =
        kind === "rack" ? "floor" : kind === "display" ? "north" : "table";
      if (!surfaces.length) surfaces.push(fallback);
      const surface: MountSurface =
        declared === "wall"
          ? "north"
          : declared === "ceiling"
            ? "ceiling"
            : declared === "table"
              ? "table"
              : surfaces[0];
      const ports: DevicePort[] = [];
      if (raw.ports !== undefined) {
        if (!Array.isArray(raw.ports) || raw.ports.length > 256)
          throw new Error(`${id}: invalid ports array`);
        for (const item of raw.ports) {
          const p = record(item, "port");
          if (
            !["input", "output", "bidirectional"].includes(String(p.direction))
          )
            throw new Error(`${id}: invalid port direction`);
          if (
            p.signalTypes !== undefined &&
            (!Array.isArray(p.signalTypes) ||
              p.signalTypes.some((x) => typeof x !== "string"))
          )
            throw new Error(`${id}: invalid signalTypes`);
          ports.push({
            id: string(p.id, "port.id"),
            label: string(p.label, "port.label"),
            direction: p.direction as DevicePort["direction"],
            connector: string(p.connector, "connector"),
            signal: string(p.transport, "transport").toLowerCase(),
            transport: p.transport as string,
            signalTypes: p.signalTypes as string[] | undefined,
            required: p.required === true,
            notes:
              "Declared in uploaded catalog; protocol interoperability is not verified",
          });
        }
      } else {
        const connectivity = optionalRecord(raw.connectivity);
        for (const [key, signal] of [
          ["hdmi", "hdmi"],
          ["displayPort", "displayport"],
          ["usb", "usb"],
          ["ethernet", "ethernet"],
        ] as const) {
          const count =
            connectivity[key] === true
              ? 1
              : (number(
                  connectivity[key] === false ? 0 : connectivity[key],
                  key,
                ) ?? 0);
          if (!Number.isInteger(count) || count > 64)
            throw new Error(`${id}: invalid ${key} count`);
          for (let i = 1; i <= count; i++)
            ports.push({
              id: `${key}-${i}`,
              label: `${key} ${i}`,
              signal,
              transport: signal,
              direction:
                kind === "display" && (key === "hdmi" || key === "displayPort")
                  ? "input"
                  : "bidirectional",
              connector: key,
              notes:
                "Expanded from declared connectivity count; connector subtype/role may be unspecified",
            });
        }
      }
      if (new Set(ports.map((p) => p.id)).size !== ports.length)
        throw new Error(`${id}: duplicate port ID`);
      const electrical = optionalRecord(raw.electrical),
        thermal = optionalRecord(raw.thermal);
      const watts =
        number(raw.powerWatts ?? electrical.powerWatts, "powerWatts") ?? null;
      const heat =
        number(
          raw.heatBtuPerHour ?? thermal.heatBtuPerHour,
          "heatBtuPerHour",
        ) ?? null;
      let imageHeightM = number(display.imageHeightM, "imageHeightM");
      const diagonal = number(display.diagonalInches, "diagonalInches");
      if (imageHeightM !== undefined && imageHeightM <= 0)
        throw new Error(`${id}: image height must be positive`);
      if (
        imageHeightM === undefined &&
        diagonal &&
        typeof display.aspectRatio === "string"
      ) {
        const ratio = display.aspectRatio.split(":").map(Number);
        if (
          ratio.length === 2 &&
          ratio.every((n) => Number.isFinite(n) && n > 0)
        )
          imageHeightM = (diagonal * 0.0254 * ratio[1]) / Math.hypot(...ratio);
      }
      const sensitivityDb = number(speaker.sensitivityDb, "sensitivityDb");
      const coverageDegrees = number(speaker.dispersionDeg, "dispersionDeg");
      if (
        coverageDegrees !== undefined &&
        (coverageDegrees <= 0 || coverageDegrees > 360)
      )
        throw new Error(`${id}: invalid dispersion`);
      const manufacturer = string(raw.manufacturer, "manufacturer"),
        model = string(raw.model, "model");
      const notes = [
        !surfaces.length
          ? ""
          : mounting.rack === true
            ? "Rack device: table anchor represents shelf placement; rack containment is not simulated."
            : "",
        ports.length ? "" : "Ports not specified; no sockets invented.",
        imageHeightM
          ? "Image height uses provided value or diagonal/aspect-ratio geometry."
          : "Image height unspecified.",
        sensitivityDb !== undefined
          ? "SPL assumes 1 W drive initially; reference impedance/taps require verification."
          : "",
      ]
        .filter(Boolean)
        .join(" ");
      return freeze({
        id,
        manufacturer,
        model,
        category,
        kind,
        dimensions,
        surface,
        surfaces,
        ports,
        metadata: {
          label: `${manufacturer} ${model}`,
          powerWatts: watts,
          heatBtuPerHour: heat,
          rackUnits: number(raw.rackUnits, "rackUnits") ?? null,
          horizontalFovDeg: number(camera.horizontalFovDeg, "HFOV"),
          verticalFovDeg: number(camera.verticalFovDeg, "VFOV"),
          imageHeightM,
          sensitivityDb,
          coverageDegrees,
          maxSpl: number(speaker.maxSplAt1m, "maxSplAt1m"),
          speakerWatts: sensitivityDb !== undefined ? 1 : undefined,
          splAt1m: null,
          powerBasis:
            watts === null
              ? "Not supplied in source catalog"
              : "Declared in source catalog",
          heatBasis:
            heat === null
              ? "Not supplied in source catalog"
              : "Declared in source catalog",
        },
        provenance:
          typeof raw.provenance === "string" ? raw.provenance : "unspecified",
        source:
          typeof raw.source === "string" ? raw.source : "No source supplied",
        sourceFile,
        notes,
        raw: structuredClone(raw),
      });
    }),
  );
}
export const INITIAL_CATALOG = Object.freeze([
  ...parseCatalog(displays, "data/displays.json"),
  ...parseCatalog(cameras, "data/cameras.json"),
  ...parseCatalog(microphones, "data/microphones.json"),
  ...parseCatalog(speakers, "data/speakers.json"),
  ...parseCatalog(systems, "data/system-devices.json"),
]);
export function deviceFromProfile(
  profile: CatalogProfile,
  index: number,
  room: RoomSize,
  point?: XYZ,
): NewDevice {
  return {
    placement: {
      mode: point ? "manual" : "auto",
      intent: defaultIntent(profile.kind, profile.surface),
    },
    catalogId: profile.id,
    kind: profile.kind,
    surface: profile.surface,
    dimensions: profile.dimensions,
    ports: profile.ports,
    position: snapToSurface(
      point ?? { x: (index % 3) * 0.5, y: 1.5, z: 0 },
      profile.surface,
      room,
    ),
    rotation: { x: 0, y: 0, z: 0 },
    metadata: {
      ...profile.metadata,
      label: `${profile.metadata.label} ${index + 1}`,
    },
  };
}
