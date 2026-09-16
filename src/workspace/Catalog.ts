import type {
  DeviceKind,
  DevicePort,
  MountSurface,
  NewDevice,
  RoomSize,
  XYZ,
} from "./DeviceStore";
import { snapToSurface } from "./DeviceStore";
export const ROOM: RoomSize = Object.freeze({ width: 8, depth: 6, height: 3 });
export interface CatalogItem {
  kind: DeviceKind;
  label: string;
  surface: MountSurface;
  icon: string;
  ports: readonly DevicePort[];
}
const port = (
  id: string,
  signal: string,
  direction: DevicePort["direction"],
): DevicePort => ({ id, label: id, signal, direction });
const power = port("Power in", "Power", "input");
export const CATALOG: readonly CatalogItem[] = [
  {
    kind: "display",
    label: "Display",
    surface: "north",
    icon: "▣",
    ports: [
      port("HDMI in", "HDMI", "input"),
      port("USB-C in", "USB-C", "input"),
      power,
    ],
  },
  {
    kind: "ptz_camera",
    label: "PTZ camera",
    surface: "table",
    icon: "◉",
    ports: [
      port("HDMI out", "HDMI", "output"),
      port("USB-C out", "USB-C", "output"),
      power,
    ],
  },
  {
    kind: "ceiling_mic",
    label: "Ceiling microphone",
    surface: "ceiling",
    icon: "⊙",
    ports: [port("Dante out", "Dante", "output"), power],
  },
  {
    kind: "speaker",
    label: "Active speaker",
    surface: "north",
    icon: "◖",
    ports: [port("Dante in", "Dante", "input"), power],
  },
  {
    kind: "rack",
    label: "Equipment rack",
    surface: "floor",
    icon: "▤",
    ports: [],
  },
  {
    kind: "source",
    label: "Presentation source",
    surface: "table",
    icon: "▱",
    ports: [
      port("HDMI out", "HDMI", "output"),
      port("USB-C out", "USB-C", "output"),
      power,
    ],
  },
  {
    kind: "matrix",
    label: "HDMI matrix",
    surface: "table",
    icon: "⊞",
    ports: [
      port("HDMI in 1", "HDMI", "input"),
      port("HDMI in 2", "HDMI", "input"),
      port("HDMI out 1", "HDMI", "output"),
      port("HDMI out 2", "HDMI", "output"),
      power,
    ],
  },
  {
    kind: "dsp",
    label: "Audio DSP",
    surface: "table",
    icon: "≋",
    ports: [
      port("Dante in 1", "Dante", "input"),
      port("Dante in 2", "Dante", "input"),
      port("Dante out 1", "Dante", "output"),
      port("Dante out 2", "Dante", "output"),
      power,
    ],
  },
  {
    kind: "power",
    label: "Power distribution",
    surface: "floor",
    icon: "ϟ",
    ports: Array.from({ length: 8 }, (_, i) =>
      port(`Power out ${i + 1}`, "Power", "output"),
    ),
  },
];
export const allowedSurfaces = (kind: DeviceKind): readonly MountSurface[] =>
  kind === "ceiling_mic"
    ? ["ceiling"]
    : kind === "rack" || kind === "power"
      ? ["floor"]
      : kind === "display" || kind === "speaker"
        ? ["north", "south", "east", "west"]
        : ["table", "north", "south", "east", "west"];
export function catalogDevice(
  kind: DeviceKind,
  index: number,
  point?: XYZ,
): NewDevice {
  const item = CATALOG.find((item) => item.kind === kind)!;
  return {
    catalogId: `generic-${kind}`,
    kind,
    surface: item.surface,
    position: snapToSurface(
      point ?? {
        x: kind === "display" ? 0 : -1 + (index % 3),
        y: 1.5,
        z: (Math.floor(index / 3) % 3) - 1,
      },
      item.surface,
      ROOM,
    ),
    rotation: { x: 0, y: 0, z: 0 },
    ports: item.ports,
    metadata: {
      label: `${item.label} ${index + 1}`,
      powerWatts: null,
      heatBtuPerHour: null,
      rackUnits: null,
      imageHeightM: kind === "display" ? 0.8 : undefined,
      splAt1m: null,
    },
  };
}
