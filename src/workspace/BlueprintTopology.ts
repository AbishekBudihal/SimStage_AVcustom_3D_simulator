import type {
  ImportedEnvironment,
  PlanOutline,
  PlanPoint,
} from "./EnvironmentImport";
export interface WallOpening {
  id: string;
  kind: "door" | "window";
  offset: number;
  width: number;
  bottom: number;
  height: number;
}
export interface WallSegment {
  start: PlanPoint;
  end: PlanPoint;
  thickness: number;
  openings: WallOpening[];
}
const cross = (a: PlanPoint, b: PlanPoint) => a.x * b.y - a.y * b.x;
const sub = (a: PlanPoint, b: PlanPoint) => ({ x: a.x - b.x, y: a.y - b.y });
export function wallLength(s: WallSegment, scale: number) {
  return Math.hypot(s.end.x - s.start.x, s.end.y - s.start.y) * scale;
}
export function wallFootprint(s: WallSegment, scale: number) {
  const dx = s.end.x - s.start.x,
    dy = s.end.y - s.start.y,
    len = Math.hypot(dx, dy);
  if (
    len < 1e-6 ||
    !Number.isFinite(s.thickness) ||
    s.thickness < 0.02 ||
    s.thickness > 2
  )
    throw Error("Wall needs distinct endpoints and 0.02–2 m thickness.");
  const x = ((-dy / len) * s.thickness) / scale / 2,
    y = ((dx / len) * s.thickness) / scale / 2;
  return [
    { x: s.start.x + x, y: s.start.y + y },
    { x: s.end.x + x, y: s.end.y + y },
    { x: s.end.x - x, y: s.end.y - y },
    { x: s.start.x - x, y: s.start.y - y },
  ];
}
export function validateOpenings(o: PlanOutline, scale: number) {
  if (!o.segment) return;
  const s = o.segment,
    len = wallLength(s, scale);
  wallFootprint(s, scale);
  if (!Array.isArray(s.openings) || s.openings.length > 30)
    throw Error("Maximum 30 openings per wall.");
  const ids = new Set<string>();
  const sorted = [...s.openings].sort((a, b) => a.offset - b.offset);
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    if (
      !p.id ||
      ids.has(p.id) ||
      !["door", "window"].includes(p.kind) ||
      ![p.offset, p.width, p.bottom, p.height].every(Number.isFinite) ||
      p.offset < 0 ||
      p.width <= 0 ||
      p.bottom < 0 ||
      p.height <= 0 ||
      p.offset + p.width > len + 1e-6 ||
      p.bottom + p.height > o.height + 1e-6 ||
      (i > 0 && sorted[i - 1].offset + sorted[i - 1].width > p.offset)
    )
      throw Error(
        "Openings must fit inside the wall and must not overlap along its length.",
      );
    ids.add(p.id);
  }
}
/** Disjoint wall rectangles around apertures: exact rectangular cutouts, no CSG tolerance artifacts. */
export function wallPanels(o: PlanOutline, scale: number) {
  validateOpenings(o, scale);
  const s = o.segment!,
    len = wallLength(s, scale),
    panels: Array<{
      offset: number;
      width: number;
      bottom: number;
      height: number;
    }> = [];
  let cursor = 0;
  for (const p of [...s.openings].sort((a, b) => a.offset - b.offset)) {
    if (p.offset > cursor)
      panels.push({
        offset: cursor,
        width: p.offset - cursor,
        bottom: 0,
        height: o.height,
      });
    if (p.bottom > 0)
      panels.push({
        offset: p.offset,
        width: p.width,
        bottom: 0,
        height: p.bottom,
      });
    if (p.bottom + p.height < o.height)
      panels.push({
        offset: p.offset,
        width: p.width,
        bottom: p.bottom + p.height,
        height: o.height - p.bottom - p.height,
      });
    cursor = p.offset + p.width;
  }
  if (cursor < len)
    panels.push({
      offset: cursor,
      width: len - cursor,
      bottom: 0,
      height: o.height,
    });
  return panels;
}
export function snapPlanPoint(
  point: PlanPoint,
  plan: ImportedEnvironment,
  gridMeters: number,
  tolerance: number,
) {
  let best = point,
    nearest = tolerance;
  for (const o of plan.outlines) {
    const pts = o.segment ? [o.segment.start, o.segment.end] : o.points;
    for (const p of pts) {
      const d = Math.hypot(p.x - point.x, p.y - point.y);
      if (d < nearest) {
        best = { ...p };
        nearest = d;
      }
    }
  }
  if (best !== point) return best;
  if (gridMeters > 0) {
    const step = gridMeters / plan.metersPerUnit;
    return {
      x: Math.round(point.x / step) * step,
      y: Math.round(point.y / step) * step,
    };
  }
  return point;
}
export interface LayoutGraph {
  nodes: PlanPoint[];
  edges: Array<[number, number]>;
  rooms: PlanPoint[][];
}
/** Planarize wall centerlines at crossings and T-junctions, then walk bounded half-edge faces. */
export function layoutGraph(plan: ImportedEnvironment): LayoutGraph {
  const segments = plan.outlines
    .filter((o) => o.segment)
    .map((o) => o.segment!);
  const cuts = segments.map(() => [0, 1]);
  const eps = 1e-7;
  for (let i = 0; i < segments.length; i++)
    for (let j = i + 1; j < segments.length; j++) {
      const a = segments[i],
        b = segments[j],
        r = sub(a.end, a.start),
        s = sub(b.end, b.start),
        q = sub(b.start, a.start),
        den = cross(r, s);
      if (Math.abs(den) > eps) {
        const t = cross(q, s) / den,
          u = cross(q, r) / den;
        if (t >= -eps && t <= 1 + eps && u >= -eps && u <= 1 + eps) {
          cuts[i].push(Math.max(0, Math.min(1, t)));
          cuts[j].push(Math.max(0, Math.min(1, u)));
        }
      } else if (Math.abs(cross(q, r)) < eps) {
        for (const [k, other] of [
          [i, b],
          [j, a],
        ] as const) {
          const seg = segments[k],
            v = sub(seg.end, seg.start),
            len = v.x * v.x + v.y * v.y;
          for (const p of [other.start, other.end]) {
            const t =
              ((p.x - seg.start.x) * v.x + (p.y - seg.start.y) * v.y) / len;
            if (t > eps && t < 1 - eps) cuts[k].push(t);
          }
        }
      }
    }
  const nodes: PlanPoint[] = [],
    edges: Array<[number, number]> = [],
    keys = new Set<string>();
  const node = (p: PlanPoint) => {
    const found = nodes.findIndex(
      (n) => Math.hypot(n.x - p.x, n.y - p.y) < 1e-6,
    );
    if (found >= 0) return found;
    nodes.push(p);
    return nodes.length - 1;
  };
  segments.forEach((s, i) => {
    const t = [...new Set(cuts[i])].sort((a, b) => a - b);
    for (let j = 1; j < t.length; j++) {
      if (t[j] - t[j - 1] < eps) continue;
      const at = (n: number) =>
          node({
            x: s.start.x + (s.end.x - s.start.x) * n,
            y: s.start.y + (s.end.y - s.start.y) * n,
          }),
        a = at(t[j - 1]),
        b = at(t[j]);
      const key = [a, b].sort((x, y) => x - y).join(":");
      if (a !== b && !keys.has(key)) {
        keys.add(key);
        edges.push([a, b]);
      }
    }
  });
  const neighbors = nodes.map(() => [] as number[]);
  edges.forEach(([a, b]) => {
    neighbors[a].push(b);
    neighbors[b].push(a);
  });
  // Remove dangling tree edges from face traversal; retain them in the returned graph.
  let changed = true;
  while (changed) {
    changed = false;
    neighbors.forEach((list, i) => {
      if (list.length === 1) {
        const j = list[0];
        neighbors[j] = neighbors[j].filter((n) => n !== i);
        neighbors[i] = [];
        changed = true;
      }
    });
  }
  neighbors.forEach((list, i) =>
    list.sort(
      (a, b) =>
        Math.atan2(nodes[a].y - nodes[i].y, nodes[a].x - nodes[i].x) -
        Math.atan2(nodes[b].y - nodes[i].y, nodes[b].x - nodes[i].x),
    ),
  );
  const visited = new Set<string>(),
    rooms: PlanPoint[][] = [];
  for (const [u, v] of edges)
    for (const [start, next] of [
      [u, v],
      [v, u],
    ]) {
      if (!neighbors[start].includes(next)) continue;
      let a = start,
        b = next;
      const path: number[] = [];
      for (let k = 0; k <= edges.length * 2; k++) {
        const key = `${a}:${b}`;
        if (visited.has(key)) break;
        visited.add(key);
        path.push(a);
        const list = neighbors[b],
          index = list.indexOf(a),
          c = list[(index - 1 + list.length) % list.length];
        a = b;
        b = c;
        if (a === start && b === next) {
          if (new Set(path).size !== path.length) break;
          const points = path.map((n) => nodes[n]);
          const area =
            points.reduce((sum, p, i) => {
              const q = points[(i + 1) % points.length];
              return sum + p.x * q.y - q.x * p.y;
            }, 0) / 2;
          if (area > eps) rooms.push(points);
          break;
        }
      }
    }
  return { nodes, edges, rooms };
}
/** Inset a detected face to wall inner edges. Complex offsets are validated by the caller. */
function innerBoundary(points: PlanPoint[], plan: ImportedEnvironment) {
  const lines = points.map((a, i) => {
    const b = points[(i + 1) % points.length],
      dx = b.x - a.x,
      dy = b.y - a.y,
      len = Math.hypot(dx, dy),
      mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const wall = plan.outlines.find((o) => {
      if (!o.segment) return false;
      const s = o.segment,
        v = sub(s.end, s.start),
        q = sub(mid, s.start),
        length = Math.hypot(v.x, v.y);
      return (
        Math.abs(cross(v, q)) / length < 1e-5 &&
        q.x * v.x + q.y * v.y >= -1e-5 &&
        q.x * v.x + q.y * v.y <= length * length + 1e-5
      );
    });
    const d = (wall?.segment?.thickness ?? 0.2) / plan.metersPerUnit / 2;
    return {
      a: { x: a.x - (dy / len) * d, y: a.y + (dx / len) * d },
      v: { x: dx, y: dy },
    };
  });
  const result = lines.map((line, i) => {
    const prev = lines[(i + lines.length - 1) % lines.length],
      den = cross(prev.v, line.v);
    if (Math.abs(den) < 1e-8) return line.a;
    const t = cross(sub(line.a, prev.a), line.v) / den;
    return { x: prev.a.x + t * prev.v.x, y: prev.a.y + t * prev.v.y };
  });
  const area = (p: PlanPoint[]) =>
    p.reduce((sum, a, i) => {
      const b = p[(i + 1) % p.length];
      return sum + a.x * b.y - b.x * a.y;
    }, 0);
  if (area(result) <= 0 || area(result) >= area(points))
    throw Error("Wall thickness leaves no valid inner floor area.");
  return result;
}
export function roomSurfaces(
  plan: ImportedEnvironment,
  ceilingHeight: number,
): PlanOutline[] {
  if (
    !Number.isFinite(ceilingHeight) ||
    ceilingHeight < 2 ||
    ceilingHeight > 30
  )
    throw Error("Ceiling height must be 2–30 m.");
  return layoutGraph(plan)
    .rooms.map((points) => innerBoundary(points, plan))
    .flatMap((points, i) => [
      {
        id: `zone-floor-${i}`,
        kind: "floor" as const,
        points,
        elevation: 0,
        height: 0.05,
        material: "wood" as const,
      },
      {
        id: `zone-ceiling-${i}`,
        kind: "ceiling" as const,
        points,
        elevation: ceilingHeight,
        height: 0.05,
        material: "plaster" as const,
      },
    ]);
}
