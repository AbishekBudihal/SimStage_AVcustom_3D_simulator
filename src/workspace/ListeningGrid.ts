import type { RoomSize, XYZ } from "./DeviceStore";
import { eyeHeight } from "./RoomLayout";
/** Shared active 0.5 m sample lattice at configured seated mouth/ear height. */
export function sampleListeningPlane(room: RoomSize): XYZ[] {
  const points: XYZ[] = [];
  for (let z = -room.depth / 2 + 0.25; z < room.depth / 2; z += 0.5)
    for (let x = -room.width / 2 + 0.25; x < room.width / 2; x += 0.5)
      points.push({ x, y: eyeHeight(room), z });
  return points;
}
