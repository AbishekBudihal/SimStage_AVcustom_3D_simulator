import { snapToSurface } from "./DeviceStore";
import type {
  DeviceState,
  MountSurface,
  PlacedDevice,
  RoomSize,
} from "./DeviceStore";
import { roomLayout } from "./RoomLayout";
export type PlacementIntent =
  | "mainDisplayWall"
  | "aboveMainDisplay"
  | "ceilingGrid"
  | "table"
  | "rearRoom"
  | "frontWall";
export type Placement = Readonly<{
  mode: "auto" | "manual";
  intent: PlacementIntent;
}>;
export function defaultIntent(
  kind: PlacedDevice["kind"],
  surface: MountSurface,
): PlacementIntent {
  return kind === "display"
    ? "mainDisplayWall"
    : kind === "ptz_camera"
      ? "aboveMainDisplay"
      : surface === "ceiling"
        ? "ceilingGrid"
        : surface === "table"
          ? "table"
          : surface === "floor"
            ? "rearRoom"
            : "frontWall";
}
/** Pure, deterministic placement. Never alters manually positioned equipment. */
export function solvePlacements(
  devices: DeviceState["devices"],
  room: RoomSize,
): DeviceState["devices"] {
  const result = { ...devices },
    groups = new Map<PlacementIntent, PlacedDevice[]>();
  for (const device of Object.values(devices))
    if (device?.placement?.mode === "auto") {
      const intent = device.placement.intent;
      groups.set(intent, [...(groups.get(intent) ?? []), device]);
    }
  const clamp = (v: number, lo: number, hi: number) =>
    Math.max(lo, Math.min(hi, v));
  for (const intent of [
    "mainDisplayWall",
    "frontWall",
    "ceilingGrid",
    "table",
    "rearRoom",
    "aboveMainDisplay",
  ] as const) {
    const group = groups.get(intent) ?? [];
    group.forEach((d, index) => {
      const half = (d.dimensions?.x ?? 0) / 2,
        height = d.dimensions?.y ?? 0,
        depth = d.dimensions?.z ?? 0;
      let surface: MountSurface = d.surface,
        position = { ...d.position };
      if (intent === "mainDisplayWall" || intent === "frontWall") {
        surface = "north";
        position = {
          x: clamp(
            (index - (group.length - 1) / 2) * ((d.dimensions?.x ?? 1) + 0.2),
            -room.width / 2 + half,
            room.width / 2 - half,
          ),
          y: clamp(room.height * 0.52, height / 2, room.height - height / 2),
          z: -room.depth / 2,
        };
      } else if (intent === "ceilingGrid") {
        const columns = Math.ceil(
            Math.sqrt((group.length * room.width) / room.depth),
          ),
          rows = Math.ceil(group.length / columns);
        surface = "ceiling";
        position = {
          x:
            -room.width / 2 +
            (((index % columns) + 0.5) * room.width) / columns,
          y: room.height,
          z:
            -room.depth / 2 +
            ((Math.floor(index / columns) + 0.5) * room.depth) / rows,
        };
      } else if (intent === "rearRoom") {
        surface = "floor";
        position = {
          x: clamp(
            -room.width / 2 +
              0.4 +
              half +
              index * ((d.dimensions?.x ?? 0.6) + 0.2),
            -room.width / 2 + half,
            room.width / 2 - half,
          ),
          y: 0,
          z: room.depth / 2 - depth / 2 - 0.3,
        };
      } else if (intent === "table") {
        const tables = roomLayout(room).tables,
          t = tables[index % tables.length];
        if (t) {
          surface = "table";
          position = { x: t.x, y: t.height, z: t.z };
        } else {
          surface = "floor";
          position = { x: 0, y: 0, z: 0 };
        }
      } else {
        const display = Object.values(result).find(
          (x) => x?.kind === "display",
        );
        surface = display?.surface ?? "north";
        position = display
          ? {
              ...display.position,
              y: clamp(
                display.position.y +
                  (display.dimensions?.y ?? 0) / 2 +
                  0.15 +
                  height / 2,
                height / 2,
                room.height - height / 2,
              ),
            }
          : { x: 0, y: room.height * 0.7, z: -room.depth / 2 };
      }
      position = { ...snapToSurface(position, surface, room) };
      if (
        surface !== d.surface ||
        position.x !== d.position.x ||
        position.y !== d.position.y ||
        position.z !== d.position.z
      )
        result[d.id] = Object.freeze({
          ...d,
          surface,
          position: Object.freeze(position),
        });
    });
  }
  return Object.freeze(result);
}
