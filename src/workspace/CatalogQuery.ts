import type { CatalogProfile } from "./catalog";
export const CATEGORIES = {
  display: "Displays",
  projector: "Projectors",
  camera: "Cameras",
  microphone: "Microphones",
  speaker: "Speakers",
  dsp: "DSP",
  amplifier: "Amplifiers",
  codec: "Codecs",
  switcher: "Switchers / Matrices",
  network: "Network",
  control: "Control",
  av_over_ip: "AV-over-IP",
  extender: "Extenders / Converters",
  rack: "Racks",
  custom: "Custom",
} as const;
export type CatalogCategory = keyof typeof CATEGORIES;
export function catalogCategory(p: CatalogProfile): CatalogCategory {
  if (p.category === "source") return "custom";
  return Object.prototype.hasOwnProperty.call(CATEGORIES, p.category)
    ? (p.category as CatalogCategory)
    : "custom";
}
export function filterCatalog(
  catalog: readonly CatalogProfile[],
  filter: {
    category: CatalogCategory | "All";
    manufacturer: string;
    query: string;
  },
) {
  const terms = filter.query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return catalog.filter(
    (p) =>
      (filter.category === "All" || catalogCategory(p) === filter.category) &&
      (filter.manufacturer === "All" ||
        p.manufacturer === filter.manufacturer) &&
      terms.every((term) =>
        `${p.manufacturer} ${p.model} ${CATEGORIES[catalogCategory(p)]}`
          .toLowerCase()
          .includes(term),
      ),
  );
}
export interface OpticalMetadata {
  hfov: number | null;
  vfov: number | null;
  diagonalFov: number | null;
  ptz: boolean | null;
  pan: unknown;
  tilt: unknown;
  zoom: unknown;
  diagonal: unknown;
  aspect: unknown;
  resolution: unknown;
  orientation: unknown;
}
export function opticalMetadata(p: CatalogProfile): OpticalMetadata {
  const c = (p.raw.camera ?? {}) as Record<string, unknown>,
    d = (p.raw.display ?? {}) as Record<string, unknown>;
  const num = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  return {
    hfov: num(c.horizontalFovDeg),
    vfov: num(c.verticalFovDeg),
    diagonalFov: num(c.diagonalFovDeg),
    ptz:
      typeof c.ptz === "boolean"
        ? c.ptz
        : typeof c.ptzCapable === "boolean"
          ? c.ptzCapable
          : p.raw.type === "ptz_camera"
            ? true
            : null,
    pan: c.panRangeDeg,
    tilt: c.tiltRangeDeg,
    zoom: c.zoom ?? c.opticalZoom,
    diagonal: d.diagonalInches,
    aspect: d.aspectRatio,
    resolution: d.resolution,
    orientation: d.orientation,
  };
}
export const specificationText = (v: unknown): string =>
  v === undefined || v === null
    ? "Unknown"
    : typeof v === "object"
      ? JSON.stringify(v)
      : String(v);
