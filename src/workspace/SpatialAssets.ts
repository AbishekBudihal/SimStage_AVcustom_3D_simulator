import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mountYaw as surfaceYaw } from "./OpticalTransform";
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
  private textures = new Map<string, T.DataTexture>();
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
  rounded(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0) {
    const key = `rounded:${w}:${h}:${d}`;
    let geometry = this.geometries.get(key);
    if (!geometry) {
      geometry = new RoundedBoxGeometry(
        w,
        h,
        d,
        3,
        Math.min(0.06, w / 6, h / 3, d / 6),
      );
      this.geometries.set(key, geometry);
    }
    const mesh = new T.Mesh(geometry, this.material(color));
    mesh.position.set(x, y, z);
    return mesh;
  }
  finish(kind: "wood" | "fabric", color: number) {
    const material = this.material(color);
    if (material.map) return material;
    const size = 128,
      data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const noise = ((x * 73 + y * 151 + x * y * 17) % 97) / 97;
        const value =
          kind === "wood"
            ? 220 +
              18 * Math.sin(y * 0.53 + Math.sin(x * 0.035) * 1.5) +
              noise * 12
            : 210 + noise * 35;
        const i = (y * size + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = value;
        data[i + 3] = 255;
      }
    const texture = new T.DataTexture(data, size, size, T.RGBAFormat);
    texture.wrapS = texture.wrapT = T.RepeatWrapping;
    texture.repeat.set(kind === "wood" ? 2 : 12, kind === "wood" ? 8 : 12);
    texture.magFilter = T.LinearFilter;
    texture.minFilter = T.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    this.textures.set(`${kind}:${color}`, texture);
    material.map = texture;
    material.roughness = kind === "wood" ? 0.55 : 0.95;
    material.metalness = 0;
    return material;
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
    } else if (
      (device.kind === "ceiling_mic" || device.kind === "speaker") &&
      device.surface === "ceiling"
    ) {
      const bottom = -dimensions(device.kind)[1] / 2 - 0.005;
      for (let i = -3; i <= 3; i++)
        details.add(
          this.box(
            device.kind === "speaker" ? 0.2 : 0.3,
            0.006,
            0.008,
            0x8698a8,
            0,
            bottom,
            i * 0.025,
          ),
        );
      if (device.kind === "speaker")
        details.add(this.cylinder(0.08, 0.008, 0x16222c, 0, bottom - 0.005, 0));
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
    // Normalize all procedural details to the physical manufacturer's outer envelope.
    root.updateMatrixWorld(true);
    const bounds = new T.Box3().setFromObject(root);
    const size = bounds.getSize(new T.Vector3());
    const centre = bounds.getCenter(new T.Vector3());
    const target = device.dimensions;
    const scale = target
      ? new T.Vector3(target.x / size.x, target.y / size.y, target.z / size.z)
      : new T.Vector3(1, 1, 1);
    const height = size.y * scale.y,
      depth = size.z * scale.z;
    const offset =
      device.surface === "floor" || device.surface === "table"
        ? new T.Vector3(0, height / 2, 0)
        : device.surface === "ceiling"
          ? new T.Vector3(0, -height / 2, 0)
          : new T.Vector3(0, 0, depth / 2);
    const matrix = new T.Matrix4()
      .makeRotationY(surfaceYaw(device.surface))
      .multiply(new T.Matrix4().makeTranslation(offset.x, offset.y, offset.z))
      .multiply(new T.Matrix4().makeScale(scale.x, scale.y, scale.z))
      .multiply(
        new T.Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z),
      );
    const key = `anchor:${device.kind}:${device.surface}:${JSON.stringify(target)}`;
    let anchor = this.geometries.get(key);
    if (!anchor) {
      anchor = root.geometry.clone().applyMatrix4(matrix);
      this.geometries.set(key, anchor);
    }
    root.geometry = anchor;
    details.applyMatrix4(matrix);
    root.userData.baseColor = 0x263343;
    root.traverse((object) => {
      object.userData.deviceId = device.id;
      if (object instanceof T.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
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
    // Low wainscot keeps the presentation wall clear of mounted equipment.
    const trim = this.box(w, 0.65, 0.018, 0x8c7157, 0, 0.325, -d / 2 + 0.01);
    trim.material = this.finish("wood", 0x8c7157);
    group.add(trim);
    for (let z = -d / 2 + 0.6; z < d / 2 - 0.5; z += 1.4) {
      const pane = this.box(
        0.015,
        h * 0.58,
        1.15,
        0xa6c0c9,
        -w / 2 + 0.015,
        h * 0.58,
        z,
      );
      pane.material.roughness = 0.24;
      pane.material.metalness = 0.35;
      group.add(pane);
      for (const dz of [-0.59, 0.59])
        group.add(
          this.box(
            0.05,
            h * 0.62,
            0.04,
            0x45515a,
            -w / 2 + 0.04,
            h * 0.58,
            z + dz,
          ),
        );
      group.add(
        this.box(0.12, 0.045, 1.24, 0xe0dfd9, -w / 2 + 0.06, h * 0.27, z),
      );
    }
    // Downward-facing ceiling: visible from inside, open from the overview.
    const ceiling = this.box(w, 0.035, d, 0xe3e7e5, 0, h + 0.025, 0);
    const ceilingMaterial = this.material(0xe3e7e5);
    // Hide only the upper face by using a downward-facing plane.
    const ceilingKey = `ceiling:${w}:${d}`;
    let ceilingGeometry = this.geometries.get(ceilingKey);
    if (!ceilingGeometry) {
      ceilingGeometry = new T.PlaneGeometry(w, d);
      ceilingGeometry.rotateX(Math.PI / 2);
      this.geometries.set(ceilingKey, ceilingGeometry);
    }
    ceiling.geometry = ceilingGeometry;
    ceiling.material = ceilingMaterial;
    ceiling.name = "Ceiling";
    group.add(ceiling);
    const lightMaterial = this.material(0xf8f3df);
    lightMaterial.emissive.setHex(0xffeac5);
    lightMaterial.emissiveIntensity = 0.5;
    const nx = Math.max(1, Math.floor(w / 2.4)),
      nz = Math.max(1, Math.floor(d / 2.4));
    for (let x = 0; x < nx; x++)
      for (let z = 0; z < nz; z++) {
        const fixture = this.box(
          0.08,
          0.035,
          1.0,
          0xf8f3df,
          -w / 2 + ((x + 0.5) * w) / nx,
          h - 0.04,
          -d / 2 + ((z + 0.5) * d) / nz,
        );
        const fixtureKey = "fixture-plane";
        let fixtureGeometry = this.geometries.get(fixtureKey);
        if (!fixtureGeometry) {
          fixtureGeometry = new T.PlaneGeometry(0.08, 1);
          fixtureGeometry.rotateX(Math.PI / 2);
          this.geometries.set(fixtureKey, fixtureGeometry);
        }
        fixture.geometry = fixtureGeometry;
        fixture.name = "Office light";
        group.add(fixture);
      }
    // Architectural seams scale with the room, not a texture of a fixed room.
    for (let x = -w / 2 + 0.6; x < w / 2; x += 0.6)
      group.add(this.box(0.008, 0.004, d, 0xaeb8b8, x, 0.013, 0));
    const furniture = new T.Group();
    furniture.name = "Furniture";
    group.add(furniture);
    const layout = roomLayout(room);
    const carpet = this.rounded(
      w * 0.85,
      0.012,
      d * 0.83,
      0x78858a,
      0,
      0.014,
      0,
    );
    carpet.material = this.finish("fabric", 0x78858a);
    group.add(carpet);
    for (const table of layout.tables) {
      const top = this.rounded(
        table.width,
        0.075,
        table.depth,
        0xb18a5f,
        table.x,
        table.height - 0.0375,
        table.z,
      );
      top.material = this.finish("wood", 0xb18a5f);
      furniture.add(top);
      furniture.add(
        this.rounded(
          0.16,
          0.008,
          0.36,
          0x303b43,
          table.x,
          table.height + 0.004,
          table.z,
        ),
      );
      for (const x of [-table.width * 0.3, table.width * 0.3])
        furniture.add(
          this.box(
            0.09,
            table.height - 0.09,
            table.depth * 0.7,
            0x414f5a,
            table.x + x,
            (table.height - 0.09) / 2,
            table.z,
          ),
        );
    }
    for (const seat of layout.seats) {
      const chair = new T.Group();
      chair.position.set(seat.position.x, 0, seat.position.z);
      chair.rotation.y = seat.rotation;
      const cushion = this.rounded(0.49, 0.11, 0.49, 0x394951, 0, 0.46, 0);
      cushion.material = this.finish("fabric", 0x394951);
      chair.add(cushion);
      const back = this.rounded(0.49, 0.52, 0.085, 0x394951, 0, 0.74, -0.22);
      back.rotation.x = -0.1;
      chair.add(back);
      for (const x of [-0.27, 0.27]) {
        chair.add(this.rounded(0.045, 0.035, 0.32, 0x27333b, x, 0.65, 0));
        chair.add(this.box(0.025, 0.18, 0.025, 0x79858a, x, 0.55, 0.1));
      }
      for (const x of [-0.18, 0.18])
        for (const z of [-0.18, 0.18])
          chair.add(this.box(0.025, 0.43, 0.025, 0x6a7983, x, 0.215, z));
      furniture.add(chair);
    }
    const stage = this.box(
      Math.max(100, w * 5),
      0.06,
      Math.max(100, d * 5),
      0x3f4c57,
      0,
      -0.23,
      0,
    );
    stage.name = "Studio ground";
    group.add(stage);
    group.traverse((o) => {
      if (o instanceof T.Mesh) {
        o.receiveShadow = true;
        o.castShadow =
          o.name !== "Ceiling" &&
          o.name !== "Office light" &&
          o.name !== "Studio ground";
      }
    });
    return group;
  }
  dispose() {
    this.textures.forEach((t) => t.dispose());
    this.textures.clear();
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
    this.geometries.clear();
    this.materials.clear();
  }
}
export { mountYaw as surfaceYaw } from "./OpticalTransform";
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
      extender: [0.2, 0.04, 0.15],
      amplifier: [0.44, 0.09, 0.3],
      network: [0.44, 0.04, 0.2],
      control: [0.2, 0.1, 0.1],
      codec: [0.3, 0.1, 0.2],
    } as const
  )[kind].slice() as [number, number, number];
}
