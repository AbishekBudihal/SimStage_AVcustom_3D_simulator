import type {
  DwgDatabase,
  DwgEntity,
  DwgLineEntity,
  DwgLWPolylineEntity,
  DwgPolyline2dEntity,
  DwgInsertEntity,
} from "@mlightcad/libredwg-web";
import {
  freezeEnvironment,
  type ImportedEnvironment,
  type PlanPoint,
  type PlanOutline,
} from "./EnvironmentImport";
import { wallFootprint } from "./BlueprintTopology";

export interface CadPath {
  id: string;
  layer: string;
  points: PlanPoint[];
  closed: boolean;
}
export interface CadDrawing {
  name: string;
  paths: CadPath[];
  metersPerUnit?: number;
  warnings: string[];
}
export const cadUnits = [
  { name: "Millimetres", scale: 0.001 },
  { name: "Centimetres", scale: 0.01 },
  { name: "Metres", scale: 1 },
  { name: "Inches", scale: 0.0254 },
  { name: "Feet", scale: 0.3048 },
];
const unitScales: Record<number, number> = {
  1: 0.0254,
  2: 0.3048,
  4: 0.001,
  5: 0.01,
  6: 1,
};
type Matrix = [number, number, number, number, number, number];
const identity: Matrix = [1, 0, 0, 1, 0, 0];
function transform(p: PlanPoint, m: Matrix): PlanPoint {
  return {
    x: m[0] * p.x + m[2] * p.y + m[4],
    y: m[1] * p.x + m[3] * p.y + m[5],
  };
}
function multiply(a: Matrix, b: Matrix): Matrix {
  const p = transform({ x: b[4], y: b[5] }, a);
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    p.x,
    p.y,
  ];
}
function upright(n?: { x: number; y: number; z: number }) {
  return (
    !n ||
    (Math.abs(n.x) < 1e-8 && Math.abs(n.y) < 1e-8 && Math.abs(n.z - 1) < 1e-8)
  );
}
/** Extracts only supported planar linework. Classification is explicitly left to the user. */
export function extractDwg(
  db: DwgDatabase,
  name: string,
  unknownEntities = 0,
): CadDrawing {
  const paths: CadPath[] = [],
    skipped = new Map<string, number>();
  let visited = 0,
    vertices = 0;
  const skip = (why: string) => skipped.set(why, (skipped.get(why) ?? 0) + 1);
  const blocks = new Map(
    db.tables.BLOCK_RECORD.entries.map((b) => [b.name, b]),
  );
  function visit(
    entities: DwgEntity[],
    matrix: Matrix,
    inherited: string,
    chain: string[],
  ) {
    for (const entity of entities) {
      if (++visited > 50000)
        throw Error(
          "Drawing exceeds 50,000 expanded entities. Isolate architectural layers in CAD first.",
        );
      if (entity.isInPaperSpace) continue;
      if (entity.isVisible === false) {
        skip("invisible entity");
        continue;
      }
      const layer =
        entity.layer === "0" && inherited ? inherited : entity.layer || "0";
      let points: PlanPoint[],
        closed = false;
      if (entity.type === "INSERT") {
        const e = entity as DwgInsertEntity,
          b = blocks.get(e.name);
        if (
          !b ||
          b.flags & 12 ||
          chain.includes(e.name) ||
          chain.length >= 12 ||
          !upright(e.extrusionDirection) ||
          (e.columnCount || 1) > 1 ||
          (e.rowCount || 1) > 1
        ) {
          skip("unresolved, external, cyclic or array block");
          continue;
        }
        const c = Math.cos(e.rotation || 0),
          s = Math.sin(e.rotation || 0),
          sx = e.xScale ?? 1,
          sy = e.yScale ?? 1;
        const local: Matrix = [c * sx, s * sx, -s * sy, c * sy, 0, 0];
        local[4] =
          e.insertionPoint.x -
          local[0] * b.basePoint.x -
          local[2] * b.basePoint.y;
        local[5] =
          e.insertionPoint.y -
          local[1] * b.basePoint.x -
          local[3] * b.basePoint.y;
        visit(b.entities, multiply(matrix, local), layer, [...chain, e.name]);
        continue;
      } else if (entity.type === "LINE") {
        const e = entity as DwgLineEntity;
        if (Math.abs(e.startPoint.z - e.endPoint.z) > 1e-8) {
          skip("non-planar LINE");
          continue;
        }
        points = [e.startPoint, e.endPoint];
      } else if (entity.type === "LWPOLYLINE" || entity.type === "POLYLINE2D") {
        const e = entity as DwgLWPolylineEntity | DwgPolyline2dEntity;
        // LibreDWG exposes raw DWG LWPOLYLINE bits, not DXF group-70 flags.
        const lw = entity.type === "LWPOLYLINE";
        const normal = lw && !(e.flag & 1) ? undefined : e.extrusionDirection;
        if (
          !upright(normal) ||
          (!lw && !!(e.flag & 126)) ||
          e.vertices.some((v) => Math.abs(v.bulge || 0) > 1e-8)
        ) {
          skip("curved, fitted or tilted polyline");
          continue;
        }
        points = e.vertices;
        closed = !!(e.flag & (lw ? 512 : 1));
      } else {
        skip(entity.type);
        continue;
      }
      points = points
        .map((p) => transform(p, matrix))
        .map((p) => ({ x: p.x, y: -p.y }));
      if (points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
        skip("invalid coordinates");
        continue;
      }
      points = points.filter(
        (p, i) =>
          !i || Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y) > 1e-8,
      );
      if (
        closed &&
        points.length > 2 &&
        Math.hypot(
          points[0].x - points[points.length - 1].x,
          points[0].y - points[points.length - 1].y,
        ) < 1e-8
      )
        points.pop();
      if (points.length < (closed ? 3 : 2)) {
        skip("degenerate geometry");
        continue;
      }
      vertices += points.length;
      if (vertices > 20000 || paths.length >= 5000)
        throw Error(
          "Drawing exceeds 5,000 paths / 20,000 vertices. Isolate architecture in CAD first.",
        );
      paths.push({ id: "dwg-" + paths.length, layer, points, closed });
    }
  }
  visit(db.entities, identity, "", []);
  if (!paths.length)
    throw Error(
      "No supported planar LINE or straight polyline geometry found. Explode architectural objects/blocks to lines or straight polylines in CAD.",
    );
  const metersPerUnit = unitScales[db.header.INSUNITS ?? 0];
  return {
    name,
    paths,
    metersPerUnit,
    warnings: [
      ...[...skipped].map(([why, n]) => `Skipped ${n} × ${why}.`),
      ...(unknownEntities
        ? [`LibreDWG could not convert ${unknownEntities} entities.`]
        : []),
      "2D architectural projection: CAD elevations are flattened. Set extrusion height and base elevation in the editor.",
      ...(!metersPerUnit
        ? [
            "Drawing units are unspecified or unsupported. Confirm units before extrusion.",
          ]
        : []),
    ],
  };
}
export function extrudeCad(
  drawing: CadDrawing,
  layers: string[],
  metersPerUnit: number,
  height: number,
  thickness: number,
  mode: "walls" | "footprints",
): ImportedEnvironment {
  if (
    ![metersPerUnit, height, thickness].every(Number.isFinite) ||
    metersPerUnit <= 0 ||
    height <= 0 ||
    height > 30 ||
    thickness < 0.02 ||
    thickness > 2
  )
    throw Error(
      "Use positive units, height up to 30 m and thickness 0.02–2 m.",
    );
  const paths = drawing.paths.filter((p) => layers.includes(p.layer));
  if (!paths.length) throw Error("Select at least one architectural layer.");
  if (mode === "footprints" && paths.some((p) => !p.closed))
    throw Error(
      "Solid footprints require closed polylines. Use wall centerlines for open linework.",
    );
  const outlines: PlanOutline[] = [];
  for (const path of paths) {
    const pts = path.points.map((p) => ({
      x: p.x * metersPerUnit,
      y: p.y * metersPerUnit,
    }));
    if (mode === "footprints")
      outlines.push({
        id: path.id,
        layer: path.layer,
        kind: "wall",
        points: pts,
        elevation: 0,
        height,
      });
    else
      for (let i = 0; i < pts.length - (path.closed ? 0 : 1); i++) {
        const segment = {
          start: pts[i],
          end: pts[(i + 1) % pts.length],
          thickness,
          openings: [],
        };
        outlines.push({
          id: path.id + "-" + i,
          layer: path.layer,
          kind: "wall",
          points: wallFootprint(segment, 1),
          segment,
          elevation: 0,
          height,
        });
      }
    if (outlines.length > 200)
      throw Error(
        "More than 200 walls selected. Select fewer layers or use closed wall footprints.",
      );
  }
  const all = outlines.flatMap((o) => o.points),
    minX = Math.min(...all.map((p) => p.x)) - 0.25,
    minY = Math.min(...all.map((p) => p.y)) - 0.25;
  const width = Math.max(...all.map((p) => p.x)) - minX + 0.25,
    depth = Math.max(...all.map((p) => p.y)) - minY + 0.25;
  const shift = (p: PlanPoint) => ({ x: p.x - minX, y: p.y - minY });
  outlines.forEach((o) => {
    o.points = o.points.map(shift);
    if (o.segment)
      o.segment = {
        ...o.segment,
        start: shift(o.segment.start),
        end: shift(o.segment.end),
      };
  });
  return freezeEnvironment({
    name: drawing.name,
    width,
    height: depth,
    metersPerUnit: 1,
    outlines,
  });
}
