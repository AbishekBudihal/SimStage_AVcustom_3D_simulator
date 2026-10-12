import type { DeviceMetadata, PlacedDevice } from "./DeviceStore";
export const SPEC_FIELDS = ["horizontalFovDeg", "verticalFovDeg", "imageHeightM", "sensitivityDb", "coverageDegrees", "horizontalDispersionDeg", "verticalDispersionDeg", "speakerWatts", "maxSpeakerWatts", "maxSpl", "referenceSplDb", "splAt1m", "referenceDistanceM", "micRadiusM", "micAngleDeg", "powerWatts", "heatBtuPerHour", "weightKg", "rackUnits", "widthM", "heightM", "depthM"] as const;
export type SpecField = typeof SPEC_FIELDS[number];
export type SpecBasis = "manufacturer" | "user_measured" | "user_entered" | "derived" | "estimated";
export interface SpecEvidence { value: number; basis: SpecBasis; source: string; checkedOn: string; conditions: string }
export type SpecificationEvidence = Partial<Record<SpecField, SpecEvidence>>;
export function parseEvidence(input: unknown): SpecificationEvidence {
  if (input === undefined) return {};
  if (!input || typeof input !== "object" || Array.isArray(input)) throw Error("Invalid specification evidence");
  const result: SpecificationEvidence = {};
  for (const [key, raw] of Object.entries(input)) {
    if (!SPEC_FIELDS.includes(key as SpecField) || !raw || typeof raw !== "object") throw Error("Unknown specification evidence field");
    const e = raw as SpecEvidence;
    if (!Number.isFinite(e.value) || e.value < 0 || !["manufacturer", "user_measured", "user_entered", "derived", "estimated"].includes(e.basis) ||
      typeof e.source !== "string" || !e.source.trim() || e.source.length > 2000 ||
      typeof e.conditions !== "string" || e.conditions.length > 2000 ||
      typeof e.checkedOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(e.checkedOn) || !Number.isFinite(Date.parse(e.checkedOn)) || new Date(e.checkedOn).toISOString().slice(0, 10) !== e.checkedOn)
      throw Error(`Invalid evidence for ${key}`);
    result[key as SpecField] = Object.freeze({ ...e });
  }
  return Object.freeze(result);
}
export function specValue(device: Pick<PlacedDevice, "metadata" | "dimensions">, field: SpecField): number | null {
  const v = field === "widthM" ? device.dimensions?.x : field === "heightM" ? device.dimensions?.y : field === "depthM" ? device.dimensions?.z : device.metadata[field as keyof DeviceMetadata];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
export function specStatus(device: Pick<PlacedDevice, "metadata" | "dimensions">, field: SpecField) {
  const value = specValue(device, field), evidence = device.metadata.specificationEvidence?.[field];
  return { value, evidence, basis: value === null ? "unknown" : evidence?.value === value ? evidence.basis : "unverified" };
}
export type SimulationLayer = "camera" | "display" | "microphone" | "speaker" | "pressure";
export function simulationAccuracy(devices: readonly PlacedDevice[], layer: SimulationLayer) {
  const fields: SpecField[] = layer === "camera" ? ["horizontalFovDeg", "verticalFovDeg"] : layer === "display" ? ["imageHeightM"] : layer === "microphone" ? ["micRadiusM"] : ["speakerWatts"];
  const missing: string[] = [], unverified: string[] = [];
  let supported = 0, total = 0;
  for (const d of devices) {
    const required = [...fields];
    if (layer === "microphone" && (d.metadata.micModel === "cone" || d.metadata.micModel === "horizontal_sector")) required.push("micAngleDeg");
    if (layer === "speaker" || layer === "pressure") {
      if (layer === "pressure" && d.metadata.acousticBands?.length) {
        total++; unverified.push(`${d.metadata.label}: user-entered frequency/beamwidth curves (not measured angular polar files)`);
      } else if (layer === "pressure") required.push("sensitivityDb");
      else required.push(d.metadata.referenceSplDb !== undefined ? "referenceSplDb" : d.metadata.splAt1m != null ? "splAt1m" : "sensitivityDb");
      if (d.metadata.referenceSplDb !== undefined) required.push("referenceDistanceM");
      if (!(layer === "pressure" && d.metadata.acousticBands?.length)) {
      if (d.metadata.horizontalDispersionDeg !== undefined || d.metadata.verticalDispersionDeg !== undefined) required.push("horizontalDispersionDeg", "verticalDispersionDeg");
      else required.push("coverageDegrees");
      }
    }
    for (const field of required) {
      total++;
      const status = specStatus(d, field);
      if (status.basis === "unknown") missing.push(`${d.metadata.label}: ${field}`);
      else if (status.basis === "unverified" || status.basis === "estimated" || status.basis === "user_entered") unverified.push(`${d.metadata.label}: ${field}`);
      else supported++;
    }
    if (layer === "microphone" && !d.metadata.micModel) missing.push(`${d.metadata.label}: pickup model`);
  }
  if (!devices.length) missing.push("No applicable devices");
  return { label: missing.length ? "Incomplete inputs" : "Parametric estimate", missing, unverified, supported, total,
    limitation: layer === "speaker" || layer === "pressure" ? "Assumed polar response; no measured polar-file engine or field acoustic validation." : layer === "microphone" ? "Geometric pickup estimate; steering and intelligibility require room measurements." : layer === "camera" ? "Pinhole geometry; verify active zoom, lens position and pixels on target." : "Content-dependent viewing planning; full DISCAS certification unverified." };
}
