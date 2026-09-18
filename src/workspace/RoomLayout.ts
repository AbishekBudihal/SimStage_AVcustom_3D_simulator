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
export function roomLayout(room: RoomSize) {
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
