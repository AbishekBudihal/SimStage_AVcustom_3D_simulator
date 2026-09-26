export const DEFAULT_EYE_HEIGHT_M = 1.2;
export const eyeHeight = (room: RoomSize) =>
  room.eyeHeightM ?? DEFAULT_EYE_HEIGHT_M;
import type { RoomSize, XYZ } from "./DeviceStore";
export interface TableBounds {
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
}
function generatedLayout(room: RoomSize) {
  if (room.table) return customTableLayout(room);
  if (room.capacity !== undefined) return capacityLayout(room);
  const tableWidth = Math.min(1.6, room.width - 2.2),
    tableDepth = Math.min(
      room.depth - 1.8,
      room.depth * (room.layout === "huddle" ? 0.44 : 0.52),
    ),
    tableHeight = 0.75;
  const tables: TableBounds[] = [],
    seats: { id: string; position: XYZ; rotation: number }[] = [];
  if (room.layout === "training") {
    const columns = Math.max(1, Math.floor((room.width - 0.8) / 3.6)),
      rows = Math.max(1, Math.floor((room.depth - 1.6) / 1.6));
    const deskWidth = Math.min(2.4, room.width - 1.0);
    for (let row = 0; row < rows; row++)
      for (let column = 0; column < columns; column++) {
        const x = (column - (columns - 1) / 2) * 3.6,
          z = (row - (rows - 1) / 2) * 1.6 - 0.25;
        tables.push({
          x,
          z,
          width: deskWidth,
          depth: 0.6,
          height: tableHeight,
        });
        for (const [seat, offset] of [-0.6, 0.6].entries())
          seats.push({
            id: `T${row + 1}-${column + 1}${seat ? "B" : "A"}`,
            position: { x: x + offset, y: eyeHeight(room), z: z + 0.65 },
            rotation: Math.PI,
          });
      }
  } else {
    tables.push({
      x: 0,
      z: 0,
      width: tableWidth,
      depth: tableDepth,
      height: tableHeight,
    });
    const perSide = Math.max(1, Math.floor(tableDepth / 0.85));
    for (let i = 0; i < perSide; i++) {
      const z = (i - (perSide - 1) / 2) * 0.85;
      seats.push({
        id: `L${i + 1}`,
        position: { x: -tableWidth / 2 - 0.55, y: eyeHeight(room), z },
        rotation: Math.PI / 2,
      });
      seats.push({
        id: `R${i + 1}`,
        position: { x: tableWidth / 2 + 0.55, y: eyeHeight(room), z },
        rotation: -Math.PI / 2,
      });
    }
    seats.push({
      id: "Back",
      position: {
        x: 0,
        y: eyeHeight(room),
        z: Math.min(room.depth / 2 - 0.3, tableDepth / 2 + 0.6),
      },
      rotation: Math.PI,
    });
    if (room.layout === "huddle")
      seats.push({
        id: "Front",
        position: { x: 0, y: eyeHeight(room), z: -tableDepth / 2 - 0.55 },
        rotation: 0,
      });
  }
  return { tableWidth, tableDepth, tableHeight, tables, seats };
}

export const ROOM_TYPES = [
  "Boardroom",
  "Conference Room",
  "Huddle Room",
  "Training Room",
  "Classroom",
  "Executive Meeting Room",
  "Multipurpose",
  "Custom",
] as const;
export type RoomType = (typeof ROOM_TYPES)[number];
export function layoutForType(type: RoomType): NonNullable<RoomSize["layout"]> {
  return type === "Training Room" ||
    type === "Classroom" ||
    type === "Multipurpose"
    ? "training"
    : type === "Huddle Room"
      ? "huddle"
      : "conference";
}
function capacityLayout(room: RoomSize) {
  const requested = room.capacity ?? 0,
    training =
      (room.roomType ? layoutForType(room.roomType) : room.layout) ===
      "training";
  const tables: TableBounds[] = [],
    seats: { id: string; position: XYZ; rotation: number }[] = [];
  const tableHeight = 0.75;
  let tableWidth = Math.min(1.6, room.width - 2.2),
    tableDepth = Math.min(
      room.depth - 1.8,
      Math.max(0.85, Math.ceil(Math.max(0, requested - 2) / 2) * 0.85),
    );
  if (training) {
    const columns = Math.max(1, Math.floor((room.width - 0.8) / 3.6)),
      rows = Math.max(1, Math.floor((room.depth - 1.6) / 1.6));
    const count = Math.min(requested, rows * columns * 2),
      deskCount = Math.ceil(count / 2),
      usedRows = Math.ceil(deskCount / columns);
    for (let i = 0; i < deskCount; i++) {
      const row = Math.floor(i / columns),
        col = i % columns,
        columnsThisRow = Math.min(columns, deskCount - row * columns);
      const x = (col - (columnsThisRow - 1) / 2) * 3.6,
        z = (row - (usedRows - 1) / 2) * 1.6 - 0.25;
      tables.push({
        x,
        z,
        width: Math.min(2.4, room.width - 1),
        depth: 0.6,
        height: tableHeight,
      });
      for (let j = 0; j < 2 && seats.length < count; j++)
        seats.push({
          id: `Seat ${seats.length + 1}`,
          position: {
            x: x + (j ? 0.6 : -0.6),
            y: eyeHeight(room),
            z: z + 0.65,
          },
          rotation: Math.PI,
        });
    }
  } else {
    const maxSide = Math.floor(tableDepth / 0.85),
      count = Math.min(requested, 2 * maxSide + 2);
    if (count)
      tables.push({
        x: 0,
        z: 0,
        width: tableWidth,
        depth: tableDepth,
        height: tableHeight,
      });
    const sides = Math.max(0, count - 2),
      perSide = Math.ceil(sides / 2);
    for (let i = 0; i < sides; i++)
      seats.push({
        id: `Seat ${i + 1}`,
        position: {
          x: (i % 2 ? 1 : -1) * (tableWidth / 2 + 0.55),
          y: eyeHeight(room),
          z: (Math.floor(i / 2) - (perSide - 1) / 2) * 0.85,
        },
        rotation: i % 2 ? -Math.PI / 2 : Math.PI / 2,
      });
    for (let i = 0; i < Math.min(2, count); i++)
      seats.push({
        id: i ? "Front" : "Back",
        position: {
          x: 0,
          y: eyeHeight(room),
          z: (i ? -1 : 1) * (tableDepth / 2 + 0.55),
        },
        rotation: i ? 0 : Math.PI,
      });
  }
  return { tables, seats, tableWidth, tableDepth, tableHeight };
}

/** User-authored dimensions; reserve chair/perimeter clearance before laying out seats. */
function customTableLayout(room: RoomSize) {
  const spec = room.table!,
    training = room.layout === "training";
  const tableWidth = Math.min(spec.width, room.width - (training ? 1.2 : 2.2)),
    tableDepth = Math.min(spec.depth, room.depth - 1.8),
    tableHeight = spec.height;
  const tables: TableBounds[] = [],
    seats: { id: string; position: XYZ; rotation: number }[] = [];
  const requested = room.capacity ?? 200;
  if (training) {
    const columns = Math.max(
        1,
        Math.floor((room.width - 0.6) / (tableWidth + 1.2)),
      ),
      rows = Math.max(1, Math.floor((room.depth - 0.8) / (tableDepth + 1.2)));
    const perDesk = Math.max(1, Math.floor(tableWidth / 0.85)),
      count = Math.min(requested, columns * rows * perDesk),
      deskCount = Math.ceil(count / perDesk),
      usedRows = Math.ceil(deskCount / columns);
    for (let i = 0; i < deskCount; i++) {
      const row = Math.floor(i / columns),
        col = i % columns,
        cols = Math.min(columns, deskCount - row * columns),
        x = (col - (cols - 1) / 2) * (tableWidth + 1.2),
        z = (row - (usedRows - 1) / 2) * (tableDepth + 1.2) - 0.25;
      tables.push({
        x,
        z,
        width: tableWidth,
        depth: tableDepth,
        height: tableHeight,
      });
      for (let j = 0; j < perDesk && seats.length < count; j++)
        seats.push({
          id: `Seat ${seats.length + 1}`,
          position: {
            x: x + (j - (perDesk - 1) / 2) * 0.85,
            y: eyeHeight(room),
            z: z + tableDepth / 2 + 0.55,
          },
          rotation: Math.PI,
        });
    }
  } else {
    const perSide = Math.floor(tableDepth / 0.85),
      count = Math.min(requested, perSide * 2 + 2);
    if (count)
      tables.push({
        x: 0,
        z: 0,
        width: tableWidth,
        depth: tableDepth,
        height: tableHeight,
      });
    const sides = Math.max(0, count - 2),
      rows = Math.ceil(sides / 2);
    for (let i = 0; i < sides; i++)
      seats.push({
        id: `Seat ${i + 1}`,
        position: {
          x: (i % 2 ? 1 : -1) * (tableWidth / 2 + 0.55),
          y: eyeHeight(room),
          z: (Math.floor(i / 2) - (rows - 1) / 2) * 0.85,
        },
        rotation: i % 2 ? -Math.PI / 2 : Math.PI / 2,
      });
    for (let i = 0; i < Math.min(2, count); i++)
      seats.push({
        id: i ? "Front" : "Back",
        position: {
          x: 0,
          y: eyeHeight(room),
          z: (i ? -1 : 1) * (tableDepth / 2 + 0.55),
        },
        rotation: i ? 0 : Math.PI,
      });
  }
  return { tables, seats, tableWidth, tableDepth, tableHeight };
}

/** Furniture edits are room data, shared by rendering, placement and analysis. */
export function roomLayout(room: RoomSize) {
  const base = generatedLayout(room);
  const clamp = (v: number, half: number, size: number) =>
    Math.max(-size / 2 + half, Math.min(size / 2 - half, v));
  const tables = base.tables.map((t, i) => {
    const e = room.furniture?.[`table:${i}`];
    const width = Math.min(e?.width ?? t.width, room.width - 0.6);
    const depth = Math.min(e?.depth ?? t.depth, room.depth - 0.6);
    return {
      ...t,
      width,
      depth,
      height: e?.height ?? t.height,
      x: clamp(e?.x ?? t.x, width / 2, room.width),
      z: clamp(e?.z ?? t.z, depth / 2, room.depth),
    };
  });
  const seats = base.seats.map((s) => {
    const e = room.furniture?.[`seat:${s.id}`];
    // Unedited seats follow their closest generated table. Explicit seat positions win.
    const nearest = base.tables.reduce(
      (best, t, i) =>
        Math.hypot(s.position.x - t.x, s.position.z - t.z) <
        Math.hypot(
          s.position.x - base.tables[best]!.x,
          s.position.z - base.tables[best]!.z,
        )
          ? i
          : best,
      0,
    );
    const before = base.tables[nearest],
      after = tables[nearest];
    const x =
      before && after
        ? after.x + ((s.position.x - before.x) * after.width) / before.width
        : s.position.x;
    const z =
      before && after
        ? after.z + ((s.position.z - before.z) * after.depth) / before.depth
        : s.position.z;
    return {
      ...s,
      rotation: e?.rotation ?? s.rotation,
      position: {
        ...s.position,
        x: clamp(e?.x ?? x, 0.3, room.width),
        z: clamp(e?.z ?? z, 0.3, room.depth),
      },
    };
  });
  return { ...base, tables, seats };
}
