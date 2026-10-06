import { describe, it, expect, vi } from "vitest";
import * as T from "three";
import { DeviceStore } from "../../src/workspace/DeviceStore";
import {
  calibration,
  parseDxf,
  validateOutline,
  freezeEnvironment,
  environmentGroup,
  disposeEnvironment,
  environmentBlocker,
  type ImportedEnvironment,
} from "../../src/workspace/EnvironmentImport";
const plan: ImportedEnvironment = {
  name: "test",
  width: 10,
  height: 8,
  metersPerUnit: 1,
  outlines: [
    {
      id: "wall",
      kind: "wall",
      elevation: 0,
      height: 3,
      points: [
        { x: 4.9, y: 0 },
        { x: 5.1, y: 0 },
        { x: 5.1, y: 8 },
        { x: 4.9, y: 8 },
      ],
    },
  ],
};
const dxf = (entity: string) =>
  `0\nSECTION\n2\nENTITIES\n${entity}0\nENDSEC\n0\nEOF\n`;
const poly = `0\nLWPOLYLINE\n70\n1\n10\n0\n20\n0\n10\n10\n20\n0\n10\n10\n20\n8\n10\n0\n20\n8\n`;
describe("calibrated environment import", () => {
  it("converts known image distance to metres and rejects bad calibration", () => {
    expect(calibration({ x: 0, y: 0 }, { x: 300, y: 400 }, 10)).toBe(0.02);
    expect(() => calibration({ x: 0, y: 0 }, { x: 0, y: 0 }, 1)).toThrow();
    expect(() => calibration({ x: 0, y: 0 }, { x: 1, y: 0 }, NaN)).toThrow();
  });
  it("parses and normalizes closed model-space DXF footprints", () => {
    const { plan: p } = parseDxf(dxf(poly));
    expect(p.width).toBe(10);
    expect(p.height).toBe(8);
    expect(p.outlines[0].points[0]).toEqual({ x: 0, y: 8 });
  });
  it("rejects open or curved geometry instead of inventing closed surfaces", () => {
    expect(() => parseDxf(dxf(poly.replace("70\n1", "70\n0")))).toThrow();
    expect(() => parseDxf(dxf(poly + "42\n0.5\n"))).toThrow();
    expect(() => parseDxf("AutoCAD Binary DXF")).toThrow();
  });
  it("ignores block definitions and reports unsupported entity types", () => {
    const result = parseDxf(dxf(poly + "0\nCIRCLE\n10\n1\n20\n1\n40\n2\n"));
    expect(result.plan.outlines).toHaveLength(1);
    expect(result.warnings.join()).toContain("CIRCLE");
  });
  it("rejects self-intersecting, degenerate and duplicate outlines", () => {
    const outline = plan.outlines[0];
    expect(() =>
      validateOutline({
        ...outline,
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
          { x: 0, y: 1 },
          { x: 1, y: 0 },
        ],
      }),
    ).toThrow();
    expect(() =>
      validateOutline({
        ...outline,
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 2, y: 0 },
        ],
      }),
    ).toThrow();
    expect(() =>
      freezeEnvironment({ ...plan, outlines: [outline, outline] }),
    ).toThrow();
  });
  it("keeps immutable imported data in the active store without changing devices", () => {
    const store = new DeviceStore(),
      before = store.api.getState().devices,
      source = structuredClone(plan);
    store.api.getState().setEnvironment(source);
    source.outlines[0].points[0].x = 100;
    expect(store.api.getState().environment?.outlines[0].points[0].x).toBe(4.9);
    expect(store.api.getState().devices).toBe(before);
    expect(
      Object.isFrozen(store.api.getState().environment?.outlines[0].points),
    ).toBe(true);
    store.api.getState().setEnvironment(null);
    expect(store.api.getState().environment).toBeNull();
  });
  it("extrudes calibrated vertices into Y-up geometry and disposes GPU resources", () => {
    const group = environmentGroup(plan),
      mesh = group.children[0] as T.Mesh;
    mesh.geometry.computeBoundingBox();
    expect(mesh.geometry.boundingBox?.min.x).toBeCloseTo(-0.1);
    expect(mesh.geometry.boundingBox?.max.y).toBeCloseTo(3);
    const dispose = vi.spyOn(mesh.geometry, "dispose");
    disposeEnvironment(group);
    expect(dispose).toHaveBeenCalledOnce();
  });
  it("blocks paths through meshes but leaves paths above and outside clear", () => {
    const blocked = environmentBlocker(plan);
    expect(blocked({ x: -2, y: 1, z: 0 }, { x: 2, y: 1, z: 0 })).toBe(true);
    expect(blocked({ x: -2, y: 4, z: 0 }, { x: 2, y: 4, z: 0 })).toBe(false);
    expect(blocked({ x: -2, y: 1, z: 5 }, { x: 2, y: 1, z: 5 })).toBe(false);
  });
});
