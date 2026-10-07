/** Only unsupported entities/classes are recoverable; corrupt geometry is rejected. */
export function dwgReadWarnings(error: number): string[] {
  if (!Number.isInteger(error) || error < 0 || (error & ~6) !== 0)
    throw Error(`LibreDWG rejected this drawing (code ${error}). Recover/resave it in CAD or export DXF.`);
  return error ? ["LibreDWG reported unsupported entities/classes. Only supported linework is imported; review layers and missing objects before extrusion."] : [];
}
