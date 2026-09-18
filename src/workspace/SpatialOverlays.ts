import type { OpticalResult } from "./OpticalEngineering";
import * as T from "three";
import type { DeviceState, RoomSize, XYZ } from "./DeviceStore";
export type WorkspaceMode =
  | "overview"
  | "measurements"
  | "cables"
  | "camera"
  | "microphone"
  | "speaker"
  | "display";
export function measurements(room: RoomSize) {
  const { width: w, depth: d, height: h } = room;
  return [
    {
      label: `Width ${w.toFixed(2)} m`,
      a: { x: -w / 2, y: 0.12, z: d / 2 + 0.45 },
      b: { x: w / 2, y: 0.12, z: d / 2 + 0.45 },
    },
    {
      label: `Length ${d.toFixed(2)} m`,
      a: { x: w / 2 + 0.45, y: 0.12, z: -d / 2 },
      b: { x: w / 2 + 0.45, y: 0.12, z: d / 2 },
    },
    {
      label: `Height ${h.toFixed(2)} m`,
      a: { x: w / 2 + 0.45, y: 0, z: -d / 2 },
      b: { x: w / 2 + 0.45, y: h, z: -d / 2 },
    },
  ];
}
export function cableCategory(signal: string): string {
  const s = signal.toLowerCase();
  return /power|mains|dc supply/.test(s)
    ? "Power"
    : /ethernet|dante|network|avb|aes67/.test(s)
      ? "Network"
      : /hdmi|displayport|sdi|video/.test(s)
        ? "HDMI / Video"
        : /usb/.test(s)
          ? "USB"
          : /audio|speaker|analog/.test(s)
            ? "Audio"
            : /rs232|rs422|gpio|control|ir/.test(s)
              ? "Control"
              : "Other";
}
export function cableRoutes(
  state: Pick<DeviceState, "devices" | "connections" | "room">,
) {
  return state.connections.flatMap((c) => {
    const from = state.devices[c.from.deviceId],
      to = state.devices[c.to.deviceId];
    if (!from || !to) return [];
    const y = Math.max(
      from.position.y,
      to.position.y,
      state.room.height - 0.15,
    );
    const points = [
      from.position,
      { x: from.position.x, y, z: from.position.z },
      { x: to.position.x, y, z: from.position.z },
      { x: to.position.x, y, z: to.position.z },
      to.position,
    ];
    const length = points
      .slice(1)
      .reduce(
        (sum, p, i) =>
          sum +
          Math.hypot(p.x - points[i].x, p.y - points[i].y, p.z - points[i].z),
        0,
      );
    return [
      {
        ...c,
        category: cableCategory(c.signal),
        points,
        length,
        source: from.metadata.label,
        destination: to.metadata.label,
      },
    ];
  });
}
const vector = (p: XYZ) => new T.Vector3(p.x, p.y, p.z);
/** One disposable scene layer. All graphics derive from current state, never screenshots. */
export class SpatialOverlays {
  readonly group = new T.Group();
  readonly cables: T.Object3D[] = [];
  constructor(private scene: T.Scene) {
    this.group.name = "Engineering overlays";
    scene.add(this.group);
  }
  private line(points: XYZ[], color: number, id?: string) {
    const line = new T.Line(
      new T.BufferGeometry().setFromPoints(points.map(vector)),
      new T.LineBasicMaterial({
        color,
        depthTest: false,
        transparent: true,
        opacity: 0.9,
      }),
    );
    line.renderOrder = 10;
    if (id) {
      line.userData.cableId = id;
      this.cables.push(line);
    }
    this.group.add(line);
    return line;
  }
  private label(text: string, position: XYZ) {
    const canvas = document.createElement("canvas");
    canvas.width = 768;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#142332";
    ctx.fillRect(0, 0, 768, 128);
    ctx.font = "48px sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "#e8f4ff";
    ctx.fillText(text, 384, 82);
    const texture = new T.CanvasTexture(canvas);
    texture.colorSpace = T.SRGBColorSpace;
    const sprite = new T.Sprite(
      new T.SpriteMaterial({
        map: texture,
        depthTest: false,
        transparent: true,
      }),
    );
    sprite.position.copy(vector(position));
    sprite.scale.set(2, 0.34, 1);
    sprite.renderOrder = 11;
    this.group.add(sprite);
  }
  update(
    mode: WorkspaceMode,
    state: DeviceState,
    filter: string,
    selected: string | null,
    optical?: OpticalResult,
    selectedSeat?: string | null,
  ) {
    this.clear();
    if ((mode === "camera" || mode === "display") && optical) {
      for (const points of optical.segments) this.line(points, 0x6dd9ff);
      this.line(
        [
          optical.origin,
          {
            x: optical.origin.x + optical.direction.x,
            y: optical.origin.y + optical.direction.y,
            z: optical.origin.z + optical.direction.z,
          },
        ],
        0xffffff,
      );
      for (const face of optical.faces) {
        const vertices: number[] = [];
        for (let i = 1; i + 1 < face.length; i++)
          for (const p of [face[0], face[i], face[i + 1]])
            vertices.push(p.x, p.y, p.z);
        const geometry = new T.BufferGeometry();
        geometry.setAttribute(
          "position",
          new T.Float32BufferAttribute(vertices, 3),
        );
        this.group.add(
          new T.Mesh(
            geometry,
            new T.MeshBasicMaterial({
              color: 0x48b7ee,
              transparent: true,
              opacity: 0.08,
              side: T.DoubleSide,
              depthWrite: false,
            }),
          ),
        );
      }
      for (const seat of optical.seats) {
        const color = {
          inside: 0x26d99a,
          outside: 0xf45363,
          unknown: 0x718096,
          warning: 0xffc857,
        }[seat.status];
        const marker = new T.Mesh(
          new T.SphereGeometry(seat.id === selectedSeat ? 0.13 : 0.08, 12, 8),
          new T.MeshBasicMaterial({ color, depthTest: false }),
        );
        marker.position.set(seat.position.x, seat.position.y, seat.position.z);
        marker.renderOrder = 12;
        this.group.add(marker);
        if (mode === "display" || seat.id === selectedSeat)
          this.line(
            [optical.origin, seat.position],
            seat.id === selectedSeat ? 0xffffff : color,
          );
      }
      return;
    }
    if (mode === "measurements")
      for (const m of measurements(state.room)) {
        this.line([m.a, m.b], 0x70d9f4);
        for (const p of [m.a, m.b])
          this.line(
            m.a.y !== m.b.y
              ? [
                  { ...p, x: p.x - 0.12 },
                  { ...p, x: p.x + 0.12 },
                ]
              : [
                  { ...p, y: p.y - 0.12 },
                  { ...p, y: p.y + 0.12 },
                ],
            0x70d9f4,
          );
        this.label(m.label, {
          x: (m.a.x + m.b.x) / 2,
          y: (m.a.y + m.b.y) / 2 + 0.25,
          z: (m.a.z + m.b.z) / 2,
        });
      }
    if (mode === "cables")
      for (const c of cableRoutes(state))
        if (filter === "All" || filter === c.category) {
          const colors: Record<string, number> = {
            "HDMI / Video": 0x65adff,
            Network: 0x61d7af,
            USB: 0xba9bff,
            Power: 0xf0b876,
            Audio: 0xee87b7,
            Control: 0xf8e479,
            Other: 0xbbccdd,
          };
          this.line(
            c.points,
            c.id === selected ? 0xffffff : colors[c.category],
            c.id,
          );
        }
    if (mode === "microphone")
      for (const d of Object.values(state.devices)) {
        if (!d || d.kind !== "ceiling_mic") continue;
        const raw = state.catalog.find((p) => p.id === d.catalogId)?.raw
          .microphone as Record<string, unknown> | undefined;
        const radius = raw?.pickupRadiusM;
        if (
          typeof radius !== "number" ||
          !Number.isFinite(radius) ||
          radius <= 0
        )
          continue;
        const y = Math.min(1.2, state.room.height);
        this.line(
          Array.from({ length: 65 }, (_, i) => ({
            x: d.position.x + radius * Math.cos((i * Math.PI) / 32),
            y,
            z: d.position.z + radius * Math.sin((i * Math.PI) / 32),
          })),
          0x77e6bc,
        );
        this.line(
          [d.position, { x: d.position.x, y, z: d.position.z }],
          0x77e6bc,
        );
      }
  }
  private clear() {
    this.group.traverse((o) => {
      if (o instanceof T.Line || o instanceof T.Mesh || o instanceof T.Sprite) {
        if ("geometry" in o) o.geometry.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if ("map" in m) (m.map as T.Texture | null)?.dispose();
          m.dispose();
        }
      }
    });
    this.group.clear();
    this.cables.length = 0;
  }
  dispose() {
    this.clear();
    this.scene.remove(this.group);
  }
}
