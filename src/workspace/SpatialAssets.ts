import * as T from "three";
import type {
  DeviceKind,
  MountSurface,
  PlacedDevice,
  RoomSize,
} from "./DeviceStore";
import { roomLayout } from "./RoomLayout";
/** Shared procedural geometry/materials, disposed once by the owning canvas. */
export class SpatialAssets {
  private geometries = new Map<string, T.BufferGeometry>();
  private materials = new Map<string, T.MeshStandardMaterial>();
  material(color: number, selected = false) {
    const key = `${color}:${selected}`;
    let m = this.materials.get(key);
    if (!m) {
      m = new T.MeshStandardMaterial({
        color: selected ? 0x65b5ed : color,
        roughness: 0.72,
        metalness: 0.12,
        emissive: selected ? 0x102a45 : 0,
      });
      this.materials.set(key, m);
    }
    return m;
  }
  box(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0) {
    const key = `b:${w}:${h}:${d}`;
    let g = this.geometries.get(key);
    if (!g) {
      g = new T.BoxGeometry(w, h, d);
      this.geometries.set(key, g);
    }
    const mesh = new T.Mesh(g, this.material(color));
    mesh.position.set(x, y, z);
    return mesh;
  }
  cylinder(r: number, h: number, color: number, x = 0, y = 0, z = 0) {
    const key = `c:${r}:${h}`;
    let g = this.geometries.get(key);
    if (!g) {
      g = new T.CylinderGeometry(r, r, h, 24);
      this.geometries.set(key, g);
    }
    const mesh = new T.Mesh(g, this.material(color));
    mesh.position.set(x, y, z);
    return mesh;
  }
  device(device: PlacedDevice) {
    const root = this.box(...dimensions(device.kind), 0x263343);
    const details = new T.Group();
    root.add(details);
    if (device.kind === "display") {
      details.add(this.box(1.36, 0.8, 0.015, 0x102334, 0, 0, 0.046));
      details.add(this.box(1.25, 0.008, 0.008, 0x4a91bd, 0, -0.32, 0.057));
      details.add(this.box(0.018, 0.006, 0.008, 0x64caa0, 0.65, -0.39, 0.045));
    } else if (device.kind === "ptz_camera") {
      details.add(this.cylinder(0.11, 0.17, 0xd1d9dd, 0, 0.07, 0));
      const lens = this.cylinder(0.062, 0.075, 0x0b1723, 0, 0.08, 0.11);
      lens.rotation.x = Math.PI / 2;
      details.add(lens);
      const glass = this.cylinder(0.038, 0.078, 0x28567b, 0, 0.08, 0.115);
      glass.rotation.x = Math.PI / 2;
      details.add(glass);
    } else if (device.kind === "ceiling_mic" || device.kind === "speaker") {
      for (let i = -3; i <= 3; i++)
        details.add(
          this.box(
            device.kind === "speaker" ? 0.2 : 0.3,
            0.007,
            0.01,
            0x8698a8,
            0,
            i * 0.035,
            device.kind === "speaker" ? 0.132 : 0.18,
          ),
        );
    } else if (device.kind === "rack") {
      for (let i = 0; i < 12; i++) {
        details.add(
          this.box(0.51, 0.07, 0.02, 0x344759, 0, -0.7 + i * 0.125, 0.415),
        );
        details.add(
          this.box(0.02, 0.015, 0.024, 0x59be9b, 0.21, -0.7 + i * 0.125, 0.43),
        );
      }
    } else if (device.kind === "source") {
      const screen = this.box(0.35, 0.22, 0.018, 0x14283a, 0, 0.12, -0.12);
      screen.rotation.x = -0.15;
      details.add(screen);
      details.add(this.box(0.32, 0.008, 0.18, 0x61758a, 0, 0.025, 0));
    } else {
      for (let i = 0; i < 5; i++)
        details.add(
          this.box(
            0.025,
            0.012,
            0.01,
            i === 0 ? 0x64caa0 : 0x65859e,
            -0.15 + i * 0.07,
            0,
            0.16,
          ),
        );
    }
    // Translate geometry/details so root position remains the mounting anchor.
    const [, height, depth] = dimensions(device.kind);
    const offset =
      device.surface === "floor" || device.surface === "table"
        ? new T.Vector3(0, height / 2, 0)
        : device.surface === "ceiling"
          ? new T.Vector3(0, -height / 2, 0)
          : new T.Vector3(0, 0, depth / 2);
    const key = `anchor:${device.kind}:${device.surface}`;
    let anchor = this.geometries.get(key);
    if (!anchor) {
      anchor = root.geometry.clone();
      anchor.translate(offset.x, offset.y, offset.z);
      anchor.rotateY(surfaceYaw(device.surface));
      this.geometries.set(key, anchor);
    }
    root.geometry = anchor;
    details.position.copy(offset);
    details.rotation.y = surfaceYaw(device.surface);
    if (surfaceYaw(device.surface))
      details.position.applyAxisAngle(
        new T.Vector3(0, 1, 0),
        surfaceYaw(device.surface),
      );
    root.userData.baseColor = 0x263343;
    root.traverse((object) => {
      object.userData.deviceId = device.id;
    });
    return root;
  }
  room(room: RoomSize) {
    const group = new T.Group();
    group.name = "Architectural room";
    const { width: w, depth: d, height: h } = room;
    group.add(this.box(w + 0.16, 0.16, d + 0.16, 0x53606c, 0, -0.09, 0));
    group.add(this.box(w, 0.025, d, 0xbfc4c2, 0, -0.005, 0));
    group.add(this.box(w, h, 0.12, 0xd3d7d7, 0, h / 2, -d / 2 - 0.06));
    group.add(this.box(0.12, h, d, 0x9aa8ad, -w / 2 - 0.06, h / 2, 0));
    group.add(this.box(w, 0.09, 0.04, 0x8a989e, 0, 0.045, -d / 2 + 0.025));
    for (let i = 0; i < 5; i++)
      group.add(
        this.box(
          0.55,
          h * 0.65,
          0.045,
          0x85979e,
          -w / 2 + 0.6 + i * 0.7,
          h * 0.54,
          -d / 2 + 0.04,
        ),
      );
    for (let i = 0; i < 3; i++)
      group.add(
        this.box(
          0.025,
          h * 0.68,
          d / 4 - 0.12,
          0x73909b,
          -w / 2 + 0.025,
          h * 0.56,
          ((i - 1) * d) / 3.5,
        ),
      );
    const layout = roomLayout(room);
    group.add(
      this.box(
        layout.tableWidth + 1.6,
        0.012,
        layout.tableDepth + 1.35,
        0x87979c,
        0,
        0.014,
        0,
      ),
    );
    group.add(
      this.box(
        layout.tableWidth,
        0.09,
        layout.tableDepth,
        0xc0a17a,
        0,
        layout.tableHeight - 0.045,
        0,
      ),
    );
    for (const z of [-layout.tableDepth * 0.3, layout.tableDepth * 0.3])
      group.add(this.box(0.7, 0.67, 0.18, 0x414f5a, 0, 0.335, z));
    for (const seat of layout.seats) {
      const chair = new T.Group();
      chair.position.set(seat.position.x, 0, seat.position.z);
      chair.rotation.y = seat.rotation;
      chair.add(this.box(0.48, 0.09, 0.48, 0x405764, 0, 0.46, 0));
      chair.add(this.box(0.48, 0.48, 0.08, 0x405764, 0, 0.71, -0.22));
      for (const x of [-0.18, 0.18])
        for (const z of [-0.18, 0.18])
          chair.add(this.box(0.025, 0.43, 0.025, 0x6a7983, x, 0.215, z));
      group.add(chair);
    }
    return group;
  }
  dispose() {
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
    this.geometries.clear();
    this.materials.clear();
  }
}
export function surfaceYaw(surface: MountSurface): number {
  return surface === "south"
    ? Math.PI
    : surface === "east"
      ? -Math.PI / 2
      : surface === "west"
        ? Math.PI / 2
        : 0;
}
export function dimensions(kind: DeviceKind): [number, number, number] {
  return (
    {
      display: [1.44, 0.84, 0.08],
      ptz_camera: [0.23, 0.08, 0.22],
      ceiling_mic: [0.38, 0.055, 0.38],
      speaker: [0.26, 0.42, 0.25],
      rack: [0.6, 1.8, 0.8],
      source: [0.38, 0.04, 0.26],
      matrix: [0.44, 0.08, 0.3],
      dsp: [0.44, 0.08, 0.3],
      power: [0.45, 0.1, 0.3],
    } as const
  )[kind].slice() as [number, number, number];
}
