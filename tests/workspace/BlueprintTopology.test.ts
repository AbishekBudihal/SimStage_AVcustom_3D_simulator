import { describe, it, expect } from "vitest";
import {
  wallFootprint,
  wallPanels,
  layoutGraph,
  roomSurfaces,
  snapPlanPoint,
} from "../../src/workspace/BlueprintTopology";
import {
  freezeEnvironment,
  environmentBlocker,
  type ImportedEnvironment,
  type PlanOutline,
} from "../../src/workspace/EnvironmentImport";
import {
  serializeBlueprint,
  parseBlueprint,
  exportBlueprint,
} from "../../src/workspace/BlueprintIO";
const wall = (id: string, a: number[], b: number[]): PlanOutline => {
  const segment = {
    start: { x: a[0], y: a[1] },
    end: { x: b[0], y: b[1] },
    thickness: 0.2,
    openings: [],
  };
  return {
    id,
    kind: "wall",
    segment,
    points: wallFootprint(segment, 1),
    height: 3,
    elevation: 0,
  };
};
const plan: ImportedEnvironment = {
  name: "Room",
  width: 10,
  height: 8,
  metersPerUnit: 1,
  outlines: [
    wall("a", [0, 0], [10, 0]),
    wall("b", [10, 0], [10, 8]),
    wall("c", [10, 8], [0, 8]),
    wall("d", [0, 8], [0, 0]),
  ],
};
describe("blueprint topology and persistence", () => {
  it("detects one bounded room and excludes exterior traversal", () => {
    const graph = layoutGraph(plan);
    expect(graph.nodes).toHaveLength(4);
    expect(graph.edges).toHaveLength(4);
    expect(graph.rooms).toHaveLength(1);
    expect(roomSurfaces(plan, 3).map((s) => s.kind)).toEqual([
      "floor",
      "ceiling",
    ]);
  });
  it("insets floors to inner wall edges and regenerates derived slabs", () => {
    const derived = freezeEnvironment({ ...plan, zoneCeilingHeight: 3 });
    const floor = derived.outlines.find((o) => o.kind === "floor")!;
    expect(Math.min(...floor.points.map((p) => p.x))).toBeCloseTo(0.1);
    expect(Math.max(...floor.points.map((p) => p.x))).toBeCloseTo(9.9);
    const opened = freezeEnvironment({
      ...derived,
      outlines: derived.outlines.filter((o) => o.id !== "a"),
    });
    expect(opened.outlines.some((o) => o.kind === "floor")).toBe(false);
  });
  it("splits T-junctions into shared nodes and two rooms", () => {
    const g = layoutGraph({
      ...plan,
      outlines: [...plan.outlines, wall("divider", [5, 0], [5, 8])],
    });
    expect(g.nodes).toHaveLength(6);
    expect(g.edges).toHaveLength(7);
    expect(g.rooms).toHaveLength(2);
  });
  it("retains dangling walls without losing room loops", () => {
    expect(
      layoutGraph({
        ...plan,
        outlines: [...plan.outlines, wall("branch", [5, 0], [5, 3])],
      }).rooms,
    ).toHaveLength(1);
  });
  it("recognizes crossings and deduplicates coincident segments", () => {
    const g = layoutGraph({
      ...plan,
      outlines: [
        wall("x", [0, 4], [10, 4]),
        wall("y", [5, 0], [5, 8]),
        wall("duplicate", [0, 4], [10, 4]),
      ],
    });
    expect(g.nodes).toHaveLength(5);
    expect(g.edges).toHaveLength(4);
    expect(g.rooms).toHaveLength(0);
  });
  it("snaps endpoints before metre-grid snapping", () => {
    expect(snapPlanPoint({ x: 0.01, y: 0.01 }, plan, 0.5, 0.1)).toEqual({
      x: 0,
      y: 0,
    });
    expect(snapPlanPoint({ x: 4.21, y: 3.31 }, plan, 0.5, 0.1)).toEqual({
      x: 4,
      y: 3.5,
    });
  });
  it("rejects overlapping and out-of-bounds openings", () => {
    const o = wall("opening", [3, 4], [7, 4]);
    o.segment!.openings = [
      { id: "w", kind: "window", offset: 3.5, width: 1, bottom: 1, height: 1 },
    ];
    expect(() => wallPanels(o, 1)).toThrow();
    o.segment!.openings[0].offset = 1;
    o.segment!.openings.push({ ...o.segment!.openings[0], id: "other" });
    expect(() => wallPanels(o, 1)).toThrow();
  });
  it("cuts a true window aperture used by acoustic rays", () => {
    const o = wall("opening", [3, 4], [7, 4]);
    o.segment!.openings = [
      { id: "w", kind: "window", offset: 1, width: 2, bottom: 1, height: 1 },
    ];
    const blocked = environmentBlocker({ ...plan, outlines: [o] });
    expect(blocked({ x: 0, y: 1.5, z: -2 }, { x: 0, y: 1.5, z: 2 })).toBe(
      false,
    );
    expect(blocked({ x: 0, y: 0.5, z: -2 }, { x: 0, y: 0.5, z: 2 })).toBe(true);
  });
  it("round-trips units, metadata and deep immutable wall endpoints", () => {
    const p = parseBlueprint(serializeBlueprint(plan));
    expect(p).toEqual(freezeEnvironment(plan));
    expect(Object.isFrozen(p.outlines[0].segment!.start)).toBe(true);
    expect(() => parseBlueprint('{"version":99}')).toThrow();
  });
  it("exports actual triangulated OBJ geometry", async () => {
    const blob = await exportBlueprint(plan, "obj"),
      text = await blob.text();
    expect(text).toContain("v ");
    expect(text).toContain("vn ");
    expect(text).toContain("f ");
  });
});
