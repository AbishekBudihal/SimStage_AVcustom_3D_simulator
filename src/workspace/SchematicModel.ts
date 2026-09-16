import type { Connection, DeviceState, PlacedDevice } from "./DeviceStore";
export const NODE_WIDTH = 236;
export const nodeHeight = (device: PlacedDevice) =>
  90 + device.ports.length * 24;
export function nodePosition(state: DeviceState, id: string, index: number) {
  return (
    state.nodePositions[id] ?? {
      x: 50 + (index % 3) * 340,
      y: 50 + Math.floor(index / 3) * 360,
    }
  );
}
export function portPoint(
  device: PlacedDevice,
  portId: string,
  position: { x: number; y: number },
) {
  const index = device.ports.findIndex((p) => p.id === portId);
  const port = device.ports[index];
  return {
    x: position.x + (port?.direction === "input" ? 0 : NODE_WIDTH),
    y: position.y + 76 + index * 24,
  };
}
/** Orthogonal trunks with cubic rounded elbows, including a return lane for backward edges. */
export function wirePath(
  a: { x: number; y: number },
  b: { x: number; y: number },
) {
  const points =
    b.x - a.x >= 60
      ? [a, { x: (a.x + b.x) / 2, y: a.y }, { x: (a.x + b.x) / 2, y: b.y }, b]
      : [
          a,
          { x: a.x + 35, y: a.y },
          { x: a.x + 35, y: Math.max(a.y, b.y) + 45 },
          { x: b.x - 35, y: Math.max(a.y, b.y) + 45 },
          { x: b.x - 35, y: b.y },
          b,
        ];
  let path = `M ${a.x} ${a.y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const before = points[i - 1],
      p = points[i],
      after = points[i + 1];
    const l1 = Math.hypot(p.x - before.x, p.y - before.y),
      l2 = Math.hypot(after.x - p.x, after.y - p.y);
    if (l1 === 0 || l2 === 0) {
      path += ` L ${p.x} ${p.y}`;
      continue;
    }
    const radius = Math.min(10, l1 / 2, l2 / 2);
    const enter = {
      x: p.x - ((p.x - before.x) / l1) * radius,
      y: p.y - ((p.y - before.y) / l1) * radius,
    };
    const exit = {
      x: p.x + ((after.x - p.x) / l2) * radius,
      y: p.y + ((after.y - p.y) / l2) * radius,
    };
    path += ` L ${enter.x} ${enter.y} C ${p.x} ${p.y} ${p.x} ${p.y} ${exit.x} ${exit.y}`;
  }
  return path + ` L ${b.x} ${b.y}`;
}
export function connectionDistance(
  connection: Connection,
  state: DeviceState,
): number | null {
  const a = state.devices[connection.from.deviceId]?.position,
    b = state.devices[connection.to.deviceId]?.position;
  return a && b ? Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) : null;
}
