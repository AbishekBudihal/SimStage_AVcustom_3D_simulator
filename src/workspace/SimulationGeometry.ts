import { environmentBlocker, type ImportedEnvironment } from "./EnvironmentImport";
import type { XYZ } from "./DeviceStore";
export type PathBlocker = (a: XYZ, b: XYZ) => boolean;
const cache = new WeakMap<ImportedEnvironment, PathBlocker>();
const clear: PathBlocker = () => false;
/** Immutable DeviceStore environments share one compiled obstruction test per snapshot. */
export function simulationBlocker(environment?: ImportedEnvironment | null): PathBlocker {
  if (!environment) return clear;
  let blocked = cache.get(environment);
  if (!blocked) { blocked = environmentBlocker(environment); cache.set(environment, blocked); }
  return blocked;
}
