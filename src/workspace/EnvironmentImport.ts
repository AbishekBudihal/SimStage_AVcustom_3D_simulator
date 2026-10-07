import {
  roomSurfaces,
  wallFootprint,
  wallPanels,
  validateOpenings,
  type WallSegment,
} from "./BlueprintTopology";
import * as T from "three";
export interface PlanPoint {
  x: number;
  y: number;
}
export interface PlanOutline {
  id: string;
  kind: "wall" | "ceiling" | "audience" | "floor";
  segment?: WallSegment;
  layer?: string;
  material?: "plaster" | "concrete" | "wood";
  points: PlanPoint[];
  elevation: number;
  height: number;
}
export interface ImportedEnvironment {
  name: string;
  image?: string;
  width: number;
  height: number;
  metersPerUnit: number;
  zoneCeilingHeight?: number;
  outlines: PlanOutline[];
}
export function calibration(a: PlanPoint, b: PlanPoint, meters: number) {
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  if (!Number.isFinite(meters) || meters <= 0 || d < 1e-6)
    throw Error("Choose two distinct points and a positive known distance.");
  return meters / d;
}
export function validateOutline(p: PlanOutline) {
  if (
    p.points.length < 3 ||
    p.points.length > 2000 ||
    !p.points.every((v) => Number.isFinite(v.x) && Number.isFinite(v.y))
  )
    throw Error("An outline needs 3–2000 finite vertices.");
  if (
    !["wall", "ceiling", "audience", "floor"].includes(p.kind) ||
    !Number.isFinite(p.elevation) ||
    p.elevation < 0 ||
    !Number.isFinite(p.height) ||
    p.height <= 0 ||
    p.height > 30
  )
    throw Error("Invalid surface height or type.");
  if (
    p.layer !== undefined &&
    (typeof p.layer !== "string" || p.layer.length > 255)
  )
    throw Error("Invalid CAD layer metadata.");
  const pts = p.points,
    cross = (a: PlanPoint, b: PlanPoint, c: PlanPoint) =>
      (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i],
      b = pts[(i + 1) % pts.length];
    if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-8)
      throw Error("Duplicate outline vertices.");
    area += a.x * b.y - b.x * a.y;
    for (let j = i + 1; j < pts.length; j++) {
      if (j === i + 1 || (i === 0 && j === pts.length - 1)) continue;
      const c = pts[j],
        d = pts[(j + 1) % pts.length];
      if (
        cross(a, b, c) * cross(a, b, d) <= 0 &&
        cross(c, d, a) * cross(c, d, b) <= 0 &&
        Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <=
          Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) &&
        Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) <=
          Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y))
      )
        throw Error("Outline intersects itself.");
    }
  }
  if (Math.abs(area) < 1e-8) throw Error("Outline has no area.");
}
export function freezeEnvironment(
  value: ImportedEnvironment,
): ImportedEnvironment {
  if (
    !value.name ||
    ![value.width, value.height, value.metersPerUnit].every(
      (n) => Number.isFinite(n) && n > 0,
    ) ||
    Math.max(value.width, value.height) * value.metersPerUnit > 500 ||
    value.outlines.length > 200
  )
    throw Error("Invalid plan dimensions (maximum 500 m / 200 outlines).");
  if (value.image && !/^data:image\/(png|jpeg);base64,/.test(value.image))
    throw Error("Only local PNG/JPEG images are supported.");
  if (value.outlines.reduce((sum, o) => sum + o.points.length, 0) > 10000)
    throw Error("Maximum 10,000 outline vertices per plan.");
  const copy = structuredClone(value);
  if (copy.zoneCeilingHeight !== undefined) {
    copy.outlines = copy.outlines.filter(
      (o) =>
        !o.id.startsWith("zone-floor-") && !o.id.startsWith("zone-ceiling-"),
    );
    copy.outlines.push(...roomSurfaces(copy, copy.zoneCeilingHeight));
    if (copy.outlines.length > 200)
      throw Error("Generated surfaces exceed 200 outlines.");
  }
  if (copy.outlines.reduce((n, o) => n + o.points.length, 0) > 10000)
    throw Error("Generated geometry exceeds 10,000 vertices.");
  const ids = new Set<string>();
  for (const p of copy.outlines) {
    if (p.material && !["plaster", "concrete", "wood"].includes(p.material))
      throw Error("Unknown material.");
    if (p.segment) {
      if (p.kind !== "wall")
        throw Error("Only walls can have centerline metadata.");
      p.points = wallFootprint(p.segment, copy.metersPerUnit);
      validateOpenings(p, copy.metersPerUnit);
      Object.freeze(p.segment.start);
      Object.freeze(p.segment.end);
      p.segment.openings.forEach(Object.freeze);
      Object.freeze(p.segment.openings);
      Object.freeze(p.segment);
    }
    validateOutline(p);
    if (ids.has(p.id)) throw Error("Duplicate outline ID.");
    ids.add(p.id);
    p.points.forEach(Object.freeze);
    Object.freeze(p.points);
    Object.freeze(p);
  }
  Object.freeze(copy.outlines);
  return Object.freeze(copy);
}
/** ASCII DXF model-space straight, closed LWPOLYLINE footprints. Unsupported entities are reported. */
export function parseDxf(text: string): {
  plan: ImportedEnvironment;
  warnings: string[];
} {
  if (text.length > 10_000_000 || text.startsWith("AutoCAD Binary"))
    throw Error("Use an ASCII DXF under 10 MB.");
  const lines = text.replace(/\r/g, "").trimEnd().split("\n");
  if (lines.length % 2) throw Error("Malformed DXF code/value pairs.");
  const pairs: Array<[number, string]> = [];
  for (let i = 0; i < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    if (!Number.isInteger(code)) throw Error("Invalid DXF group code.");
    pairs.push([code, lines[i + 1].trim()]);
  }
  let section = "";
  const outlines: PlanOutline[] = [],
    warnings = new Set<string>();
  for (let i = 0; i < pairs.length; i++) {
    const [code, value] = pairs[i];
    if (code === 0 && value === "SECTION") {
      section = pairs[i + 1]?.[1] ?? "";
      continue;
    }
    if (code === 0 && value === "ENDSEC") {
      section = "";
      continue;
    }
    if (section !== "ENTITIES" || code !== 0) continue;
    let end = i + 1;
    while (end < pairs.length && pairs[end][0] !== 0) end++;
    const data = pairs.slice(i + 1, end),
      num = (c: number, f = 0) =>
        Number(data.find((p) => p[0] === c)?.[1] ?? f);
    if (value !== "LWPOLYLINE") {
      warnings.add(
        `Skipped ${value}: export closed straight LWPOLYLINE footprints.`,
      );
      continue;
    }
    if (
      num(67) !== 0 ||
      !(num(70) & 1) ||
      data.some(([c, v]) => c === 42 && Number(v) !== 0) ||
      num(210) !== 0 ||
      num(220) !== 0 ||
      num(230, 1) !== 1
    ) {
      warnings.add("Skipped open, curved, paper-space or tilted polyline.");
      continue;
    }
    const points: PlanPoint[] = [];
    for (let j = 0; j < data.length; j++)
      if (data[j][0] === 10) {
        const y = data.slice(j + 1).find((p) => p[0] === 20 || p[0] === 10);
        if (y?.[0] !== 20) throw Error("DXF vertex missing Y.");
        points.push({ x: Number(data[j][1]), y: -Number(y[1]) });
      }
    if (
      points.length > 3 &&
      points[0].x === points[points.length - 1].x &&
      points[0].y === points[points.length - 1].y
    )
      points.pop();
    const outline: PlanOutline = {
      id: `dxf-${outlines.length}`,
      kind: "wall",
      points,
      elevation: 0,
      height: 3,
    };
    validateOutline(outline);
    if (
      outlines.reduce((n, o) => n + o.points.length, 0) + points.length >
      10000
    )
      throw Error("Maximum 10,000 outline vertices per plan.");
    outlines.push(outline);
    if (outlines.length > 200)
      throw Error("Maximum 200 footprints per import.");
  }
  if (!outlines.length)
    throw Error(
      "No supported closed LWPOLYLINE footprints. Export straight model-space footprints to ASCII DXF.",
    );
  const all = outlines.flatMap((o) => o.points),
    minX = Math.min(...all.map((p) => p.x)),
    minY = Math.min(...all.map((p) => p.y)),
    width = Math.max(...all.map((p) => p.x)) - minX,
    height = Math.max(...all.map((p) => p.y)) - minY;
  outlines.forEach((o) =>
    o.points.forEach((p) => {
      p.x -= minX;
      p.y -= minY;
    }),
  );
  return {
    plan: { name: "DXF plan", width, height, metersPerUnit: 1, outlines },
    warnings: [
      ...warnings,
      "Calibrate a known distance before applying. DXF units are not assumed.",
    ],
  };
}
export function environmentGroup(
  plan: ImportedEnvironment,
  invalidate: () => void = () => {},
) {
  const group = new T.Group();
  group.name = "Imported environment";
  for (const outline of plan.outlines) {
    const color =
      outline.material === "wood"
        ? 0xa87943
        : outline.material === "concrete"
          ? 0x8f969c
          : outline.kind === "audience"
            ? 0x458ca8
            : 0xcbd5e1;
    if (outline.segment) {
      const seg = outline.segment,
        dx = seg.end.x - seg.start.x,
        dy = seg.end.y - seg.start.y,
        angle = -Math.atan2(dy, dx);
      for (const panel of wallPanels(outline, plan.metersPerUnit)) {
        const geometry = new T.BoxGeometry(
          panel.width,
          panel.height,
          seg.thickness,
        );
        geometry.translate(
          panel.offset + panel.width / 2,
          outline.elevation + panel.bottom + panel.height / 2,
          0,
        );
        geometry.rotateY(angle);
        geometry.translate(
          (seg.start.x - plan.width / 2) * plan.metersPerUnit,
          0,
          (seg.start.y - plan.height / 2) * plan.metersPerUnit,
        );
        const mesh = new T.Mesh(
          geometry,
          new T.MeshStandardMaterial({ color, roughness: 0.85 }),
        );
        mesh.name = outline.id;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
      }
      continue;
    }
    const shape = new T.Shape(
      outline.points.map(
        (p) =>
          new T.Vector2(
            (p.x - plan.width / 2) * plan.metersPerUnit,
            -(p.y - plan.height / 2) * plan.metersPerUnit,
          ),
      ),
    );
    const geometry = new T.ExtrudeGeometry(shape, {
      depth: outline.height,
      bevelEnabled: false,
      steps: 1,
    });
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, outline.elevation, 0);
    const material = new T.MeshStandardMaterial({
      color,
      transparent: outline.kind === "ceiling",
      opacity: outline.kind === "ceiling" ? 0.25 : 1,
      side: T.DoubleSide,
    });
    const mesh = new T.Mesh(geometry, material);
    mesh.name = outline.id;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  if (plan.image) {
    const texture = new T.TextureLoader().load(plan.image, () => {
      if (group.userData.disposed) texture.dispose();
      else invalidate();
    });
    texture.colorSpace = T.SRGBColorSpace;
    const mesh = new T.Mesh(
      new T.PlaneGeometry(
        plan.width * plan.metersPerUnit,
        plan.height * plan.metersPerUnit,
      ),
      new T.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
        side: T.DoubleSide,
      }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.012;
    mesh.name = "Calibrated plan underlay";
    group.add(mesh);
  }
  return group;
}
export function disposeEnvironment(group: T.Group) {
  group.userData.disposed = true;
  group.traverse((o) => {
    if (o instanceof T.Mesh) {
      o.geometry.dispose();
      const materials = Array.isArray(o.material) ? o.material : [o.material];
      materials.forEach((m) => {
        if ("map" in m) (m.map as T.Texture | null)?.dispose();
        m.dispose();
      });
    }
  });
  group.removeFromParent();
}

/** Exact intersection with extruded imported polygons, compiled once per calculation. */
export function environmentBlocker(
  plan: ImportedEnvironment | null | undefined,
) {
  const triangles: Array<[T.Vector3, T.Vector3, T.Vector3]> = [];
  if (plan) {
    const group = environmentGroup({ ...plan, image: undefined });
    group.traverse((o) => {
      if (!(o instanceof T.Mesh)) return;
      const p = o.geometry.getAttribute("position"),
        index = o.geometry.getIndex();
      for (let i = 0; i < (index?.count ?? p.count); i += 3) {
        const vertex = (j: number) =>
          new T.Vector3().fromBufferAttribute(p, index ? index.getX(j) : j);
        triangles.push([vertex(i), vertex(i + 1), vertex(i + 2)]);
      }
    });
    disposeEnvironment(group);
  }
  const ray = new T.Ray(),
    target = new T.Vector3();
  return (
    a: { x: number; y: number; z: number },
    b: { x: number; y: number; z: number },
  ) => {
    ray.origin.set(a.x, a.y, a.z);
    ray.direction.set(b.x - a.x, b.y - a.y, b.z - a.z);
    const length = ray.direction.length();
    if (length < 1e-8) return false;
    ray.direction.divideScalar(length);
    return triangles.some((t) => {
      const hit = ray.intersectTriangle(t[0], t[1], t[2], false, target);
      if (!hit) return false;
      const distance = hit.distanceTo(ray.origin);
      return distance > 1e-5 && distance < length - 1e-5;
    });
  };
}
