import type { RoomSize, XYZ } from "./DeviceStore";
export interface TableBounds {
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
}
export function roomLayout(room: RoomSize) {
  const tableWidth = Math.min(1.6, room.width * 0.3),
    tableDepth = room.depth * (room.layout === "huddle" ? 0.44 : 0.52),
    tableHeight = 0.75;
  const tables: TableBounds[] = [],
    seats: { id: string; position: XYZ; rotation: number }[] = [];
  if (room.layout === "training") {
    for (let row = 0; row < 4; row++)
      for (let column = 0; column < 3; column++) {
        const x = (column - 1) * room.width * 0.28,
          z = (row - 1.5) * room.depth * 0.19;
        tables.push({ x, z, width: 2.4, depth: 0.6, height: tableHeight });
        for (const [seat, offset] of [-0.6, 0.6].entries())
          seats.push({
            id: `T${row + 1}-${column + 1}${seat ? "B" : "A"}`,
            position: { x: x + offset, y: 1.2, z: z + 0.65 },
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
        position: { x: -tableWidth / 2 - 0.55, y: 1.2, z },
        rotation: Math.PI / 2,
      });
      seats.push({
        id: `R${i + 1}`,
        position: { x: tableWidth / 2 + 0.55, y: 1.2, z },
        rotation: -Math.PI / 2,
      });
    }
    seats.push({
      id: "Back",
      position: {
        x: 0,
        y: 1.2,
        z: Math.min(room.depth / 2 - 0.3, tableDepth / 2 + 0.6),
      },
      rotation: Math.PI,
    });
    if (room.layout === "huddle")
      seats.push({
        id: "Front",
        position: { x: 0, y: 1.2, z: -tableDepth / 2 - 0.55 },
        rotation: 0,
      });
  }
  return { tableWidth, tableDepth, tableHeight, tables, seats };
}
