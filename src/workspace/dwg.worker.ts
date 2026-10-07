/// <reference lib="webworker" />
import { createModule, LibreDwg } from "@mlightcad/libredwg-web";
import wasmUrl from "../../node_modules/@mlightcad/libredwg-web/wasm/libredwg-web.wasm?url";
import { dwgReadWarnings } from "./DwgReadPolicy";
import { extractDwg } from "./DwgImport";
self.onmessage = async (
  event: MessageEvent<{ data: ArrayBuffer; name: string }>,
) => {
  try {
    const data = event.data.data;
    if (
      data.byteLength > 10_000_000 ||
      !/^AC10[0-9]{2}$/.test(new TextDecoder().decode(data.slice(0, 6)))
    )
      throw Error("Not a supported DWG file header, or file exceeds 10 MB.");
    const module = await createModule({ locateFile: () => wasmUrl });
    module.FS.writeFile("input.dwg", new Uint8Array(data));
    const result = module.dwg_read_file("input.dwg");
    module.FS.unlink("input.dwg");
    const warnings = dwgReadWarnings(result.error);
    if (!result.data) throw Error("LibreDWG returned no drawing data. Recover/resave the drawing or export DXF.");
    const lib = LibreDwg.createByWasmInstance(module);
    try {
      const { database, stats } = lib.convertEx(result.data);
      const drawing = extractDwg(database, event.data.name, stats.unknownEntityCount);
      drawing.warnings.push(...warnings);
      self.postMessage({ drawing });
    } finally {
      lib.dwg_free(result.data);
    }
  } catch (e) {
    self.postMessage({ error: e instanceof Error ? e.message : String(e) });
  }
};
