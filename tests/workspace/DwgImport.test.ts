import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  LibreDwg,
  type DwgDatabase,
  type DwgEntity,
} from "@mlightcad/libredwg-web";
import { extractDwg, extrudeCad } from "../../src/workspace/DwgImport";
import {
  environmentGroup,
  disposeEnvironment,
} from "../../src/workspace/EnvironmentImport";
import { layoutGraph } from "../../src/workspace/BlueprintTopology";
import { DeviceStore } from "../../src/workspace/DeviceStore";
import * as T from "three";
const line = (layer = "Walls") => ({
  type: "LINE",
  layer,
  startPoint: { x: 0, y: 0, z: 0 },
  endPoint: { x: 4000, y: 0, z: 0 },
});
const database = (entities: unknown[], entries: unknown[] = []) =>
  ({
    entities,
    header: { INSUNITS: 4 },
    tables: { BLOCK_RECORD: { entries } },
  }) as DwgDatabase;
describe("DWG to architecture", () => {
  it("respects millimetres, layer selection and immutable live-store geometry", () => {
    const drawing = extractDwg(
      database([line(), line("Furniture")]),
      "room.dwg",
    );
    const plan = extrudeCad(drawing, ["Walls"], 0.001, 3, 0.2, "walls");
    expect(plan.outlines).toHaveLength(1);
    expect(plan.width).toBeCloseTo(4.5);
    const store = new DeviceStore(),
      devices = store.api.getState().devices;
    store.api.getState().setEnvironment(plan);
    expect(store.api.getState().devices).toBe(devices);
    expect(Object.isFrozen(store.api.getState().environment)).toBe(true);
    const group = environmentGroup(plan),
      mesh = group.children[0] as T.Mesh;
    mesh.geometry.computeBoundingBox();
    expect(mesh.geometry.boundingBox!.max.y).toBeCloseTo(3);
    expect(mesh.geometry.boundingBox!.getSize(new T.Vector3()).x).toBeCloseTo(
      4,
    );
    disposeEnvironment(group);
  });
  it("uses raw DWG closed bit and missing-normal bit correctly", () => {
    const db = database([
      {
        type: "LWPOLYLINE",
        layer: "Walls",
        flag: 512,
        extrusionDirection: { x: 0, y: 0, z: 0 },
        vertices: [
          { x: 0, y: 0 },
          { x: 4000, y: 0 },
          { x: 4000, y: 3000 },
          { x: 0, y: 3000 },
        ],
      },
    ]);
    const drawing = extractDwg(db, "room.dwg"),
      plan = extrudeCad(drawing, ["Walls"], 0.001, 3, 0.2, "walls");
    expect(drawing.paths[0].closed).toBe(true);
    expect(plan.outlines).toHaveLength(4);
    expect(layoutGraph(plan).rooms).toHaveLength(1);
    expect(
      extrudeCad(drawing, ["Walls"], 0.001, 3, 0.2, "footprints").outlines,
    ).toHaveLength(1);
  });
  it("rejects open solid footprints, unknown units and excessive geometry", () => {
    const drawing = extractDwg(database([line()]), "test");
    expect(() =>
      extrudeCad(drawing, ["Walls"], 0.001, 3, 0.2, "footprints"),
    ).toThrow("closed");
    expect(() => extrudeCad(drawing, ["Walls"], 0, 3, 0.2, "walls")).toThrow();
    expect(() => extrudeCad(drawing, [], 1, 3, 0.2, "walls")).toThrow("Select");
    expect(() => extrudeCad(drawing, ["Walls"], 1, 3, 0.2, "walls")).toThrow(
      "500",
    );
    expect(() =>
      extrudeCad(
        {
          ...drawing,
          paths: Array.from({ length: 201 }, (_, i) => ({
            ...drawing.paths[0],
            id: String(i),
          })),
        },
        ["Walls"],
        0.001,
        3,
        0.2,
        "walls",
      ),
    ).toThrow("200");
  });
  it("transforms nested blocks and inherits layer 0", () => {
    const insert = {
      type: "INSERT",
      layer: "Walls",
      name: "block",
      insertionPoint: { x: 100, y: 200 },
      rotation: Math.PI / 2,
      xScale: 2,
      yScale: 2,
    };
    const drawing = extractDwg(
      database(
        [insert],
        [
          {
            name: "block",
            flags: 0,
            basePoint: { x: 10, y: 0 },
            entities: [
              {
                ...line("0"),
                startPoint: { x: 10, y: 0, z: 0 },
                endPoint: { x: 20, y: 0, z: 0 },
              },
            ],
          },
        ],
      ),
      "block",
    );
    expect(drawing.paths[0].layer).toBe("Walls");
    expect(drawing.paths[0].points[0].x).toBeCloseTo(100);
    expect(drawing.paths[0].points[1].y).toBeCloseTo(-220);
  });
  it("reports unsupported entities and excludes paper space", () => {
    const drawing = extractDwg(
      database([
        line(),
        { ...line(), isInPaperSpace: true },
        { type: "CIRCLE", layer: "Walls" },
        {
          type: "LWPOLYLINE",
          flag: 512,
          vertices: [
            { x: 0, y: 0, bulge: 1 },
            { x: 1, y: 1 },
          ],
        },
      ]),
      "test",
      2,
    );
    expect(drawing.paths).toHaveLength(1);
    expect(drawing.warnings.join()).toContain("CIRCLE");
    expect(drawing.warnings.join()).toContain("curved");
    expect(drawing.warnings.join()).toContain("2 entities");
  });
  it("guards cyclic blocks without recursing forever", () => {
    const insert = {
      type: "INSERT",
      layer: "Walls",
      name: "cycle",
      insertionPoint: { x: 0, y: 0 },
      rotation: 0,
      xScale: 1,
      yScale: 1,
    };
    const drawing = extractDwg(
      database(
        [line(), insert],
        [
          {
            name: "cycle",
            flags: 0,
            basePoint: { x: 0, y: 0 },
            entities: [insert],
          },
        ],
      ),
      "cycle",
    );
    expect(drawing.warnings.join()).toContain("cyclic");
  });
});
describe("real LibreDWG decoder fixtures", () => {
  let lib: Awaited<ReturnType<typeof LibreDwg.create>>;
  beforeAll(async () => {
    lib = await LibreDwg.create("./node_modules/@mlightcad/libredwg-web/wasm");
  }, 30000);
  for (const name of ["line", "polygon"])
    it("decodes and extrudes " + name + ".dwg", () => {
      lib.FS.writeFile(
        "fixture.dwg",
        readFileSync("tests/fixtures/libredwg-" + name + ".dwg"),
      );
      const result = lib.dwg_read_file("fixture.dwg");
      expect(result.error).toBe(0);
      try {
        const { database: db, stats } = lib.convertEx(result.data),
          drawing = extractDwg(db, name, stats.unknownEntityCount);
        expect(drawing.metersPerUnit).toBe(0.0254);
        expect(drawing.paths).toHaveLength(1);
        expect(drawing.paths[0].closed).toBe(name === "polygon");
        const plan = extrudeCad(
          drawing,
          ["0"],
          drawing.metersPerUnit!,
          3,
          0.02,
          "walls",
        );
        expect(plan.outlines).toHaveLength(name === "polygon" ? 10 : 1);
        const group = environmentGroup(plan);
        expect(new T.Box3().setFromObject(group).max.y).toBeCloseTo(3);
        disposeEnvironment(group);
      } finally {
        lib.dwg_free(result.data);
        lib.FS.unlink("fixture.dwg");
      }
    });
});
