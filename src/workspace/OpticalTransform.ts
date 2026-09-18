import * as T from "three";
import type { PlacedDevice, XYZ } from "./DeviceStore";
export function mountYaw(surface: PlacedDevice["surface"]) {
  return surface === "south"
    ? Math.PI
    : surface === "east"
      ? -Math.PI / 2
      : surface === "west"
        ? Math.PI / 2
        : 0;
}
export function orientation(device: PlacedDevice) {
  return new T.Quaternion()
    .setFromEuler(
      new T.Euler(
        device.rotation.x,
        device.rotation.y,
        device.rotation.z,
        "XYZ",
      ),
    )
    .multiply(
      new T.Quaternion().setFromAxisAngle(
        new T.Vector3(0, 1, 0),
        mountYaw(device.surface),
      ),
    );
}
export const vector = (p: XYZ) => new T.Vector3(p.x, p.y, p.z);
/** Screen is the front face of the supplied physical envelope; bezel thickness is unknown. */
export function screenOrigin(device: PlacedDevice): T.Vector3 {
  const size = device.dimensions;
  if (!size) return vector(device.position);
  const floor = device.surface === "table" || device.surface === "floor",
    ceiling = device.surface === "ceiling";
  const offset = new T.Vector3(
    0,
    floor ? size.y / 2 : ceiling ? -size.y / 2 : 0,
    floor || ceiling ? size.z / 2 : size.z,
  );
  return offset
    .applyQuaternion(orientation(device))
    .add(vector(device.position));
}
