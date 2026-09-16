import type { RoomSize, XYZ } from "./DeviceStore";
export function roomLayout(room: RoomSize) {
  const tableWidth = Math.min(1.6, room.width * 0.3),
    tableDepth = room.depth * 0.52,
    tableHeight = 0.75;
  const perSide = Math.max(1, Math.floor(tableDepth / 0.85));
  const seats: { id: string; position: XYZ; rotation: number }[] = [];
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
    position: { x: 0, y: 1.2, z: tableDepth / 2 + 0.6 },
    rotation: Math.PI,
  });
  return { tableWidth, tableDepth, tableHeight, seats };
}
