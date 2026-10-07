import { describe, expect, it } from "vitest";
import { dwgReadWarnings } from "../../src/workspace/DwgReadPolicy";
describe("DWG decoder warning policy", () => {
  it("accepts clean drawings and explicitly reports unsupported entities/classes", () => {
    expect(dwgReadWarnings(0)).toEqual([]);
    for (const code of [2, 4, 6]) expect(dwgReadWarnings(code)[0]).toContain("unsupported");
  });
  it("rejects corruption, invalid handles, missing sections and mixed fatal flags", () => {
    for (const code of [1, 3, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, -1, 1.5])
      expect(() => dwgReadWarnings(code)).toThrow("rejected");
  });
});
