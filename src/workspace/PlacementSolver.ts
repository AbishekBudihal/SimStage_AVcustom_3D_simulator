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
      const occupied = Object.values(result).filter(
        (other): other is PlacedDevice =>
          !!other &&
          other.id !== d.id &&
          (other.placement?.mode !== "auto" ||
            other.kind === "display" ||
            group.slice(0, index).some((p) => p.id === other.id)),
      );
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
        if (intent === "frontWall") {
          // Search the actual free wall intervals, including display envelopes.
          const candidates = Array.from(
            { length: Math.floor(room.width * 2) + 1 },
            (_, i) => Math.ceil((-room.width / 2 + half) * 2) / 2 + i * 0.5,
          )
            .filter((x) => x + half <= room.width / 2)
            .sort((a, b) => Math.abs(a) - Math.abs(b) || a - b);
          const free = candidates.find((x) =>
            occupied.every(
              (o) =>
                o.surface !== "north" ||
                Math.abs(x - o.position.x) >=
                  half + (o.dimensions?.x ?? 0.5) / 2 + 0.15,
            ),
          );
          if (free !== undefined) position.x = free;
        }
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
          // Place separate devices on free 0.5 m anchors within the table bounds.
          const anchors: { x: number; y: number; z: number }[] = [];
          for (
            let z = Math.ceil((t.z - t.depth / 2 + depth / 2) * 2) / 2;
            z <= t.z + t.depth / 2 - depth / 2;
            z += 0.5
          )
            for (
              let x = Math.ceil((t.x - t.width / 2 + half) * 2) / 2;
              x <= t.x + t.width / 2 - half;
              x += 0.5
            )
              anchors.push({ x, y: t.height, z });
          anchors.sort(
            (a, b) =>
              Math.hypot(a.x - t.x, a.z - t.z) -
              Math.hypot(b.x - t.x, b.z - t.z),
          );
          const free = anchors.find((p) =>
            occupied.every(
              (o) =>
                o.surface !== "table" ||
                Math.abs(p.x - o.position.x) >=
                  half + (o.dimensions?.x ?? 0.3) / 2 + 0.1 ||
                Math.abs(p.z - o.position.z) >=
                  depth / 2 + (o.dimensions?.z ?? 0.3) / 2 + 0.1,
            ),
          );
          if (free) position = free;
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
