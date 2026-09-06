/**
 * UniversalDeviceModel.ts
 * Core utilities for the Universal AV Device Metadata Model.
 * Enforces engineering honesty: never fabricates specs, handles explicit
 * provenance states, optical FOV conversion rules, and visualization fallbacks.
 */

import type {
  EquipmentProduct,
  CameraSpec,
  ProvenancedField,
  ProvenanceTier,
  SpecValueState,
  VisualizationSpec,
  FallbackGeometryKind
} from './EquipmentCatalog';

/**
 * Construct a strongly-typed provenanced field.
 */
export function createProvenanced<T>(
  value: T,
  provenance: ProvenanceTier = 'unknown',
  state: SpecValueState = 'known',
  source?: string,
  notes?: string
): ProvenancedField<T> {
  return {
    value,
    state,
    provenance,
    source,
    notes
  };
}

export interface FovResolutionResult {
  /** Effective horizontal FOV in degrees (null if unknown) */
  fovDeg: number | null;
  /** State of this value (known, estimated, unknown) */
  state: SpecValueState;
  /** Human-readable engineering explanation */
  note: string;
}

/**
 * Resolve effective horizontal FOV for a camera product.
 *
 * ENGINEERING RULE (§7):
 * - Never assume diagonal FOV is horizontal FOV.
 * - If only diagonal FOV is provided, convert ONLY when an optical sensor
 *   aspect ratio is mathematically justified. Otherwise, report state 'unknown'.
 */
export function resolveEffectiveHorizontalFov(
  camera?: CameraSpec,
  sensorAspectRatio?: number
): FovResolutionResult {
  if (!camera) {
    return {
      fovDeg: null,
      state: 'unknown',
      note: 'No camera specifications declared.'
    };
  }

  // 1. Direct horizontal FOV declared
  if (camera.horizontalFovDeg != null && camera.horizontalFovDeg > 0) {
    return {
      fovDeg: camera.horizontalFovDeg,
      state: 'known',
      note: 'Manufacturer-declared horizontal FOV.'
    };
  }

  // 2. Only diagonal FOV declared
  if (camera.diagonalFovDeg != null && camera.diagonalFovDeg > 0) {
    if (sensorAspectRatio != null && sensorAspectRatio > 0) {
      // theta_h = 2 * atan( (aspect / sqrt(aspect^2 + 1)) * tan(theta_d / 2) )
      const dRad = (camera.diagonalFovDeg * Math.PI) / 180;
      const aspectFactor = sensorAspectRatio / Math.sqrt(sensorAspectRatio * sensorAspectRatio + 1);
      const hRad = 2 * Math.atan(aspectFactor * Math.tan(dRad / 2));
      const hDeg = (hRad * 180) / Math.PI;
      const rounded = Math.round(hDeg * 10) / 10;
      return {
        fovDeg: rounded,
        state: 'estimated',
        note: `Mathematically converted from ${camera.diagonalFovDeg}° diagonal FOV using aspect ratio ${sensorAspectRatio.toFixed(2)}.`
      };
    }

    return {
      fovDeg: null,
      state: 'unknown',
      note: `Manufacturer only declared ${camera.diagonalFovDeg}° diagonal FOV. Horizontal FOV is unknown without optical sensor aspect ratio.`
    };
  }

  return {
    fovDeg: null,
    state: 'unknown',
    note: 'No horizontal or diagonal FOV declared by manufacturer.'
  };
}

/**
 * Determine the appropriate fallback geometric representation for 3D visualization.
 */
export function inferFallbackGeometry(product: EquipmentProduct): FallbackGeometryKind {
  const cat = product.category;

  if (cat === 'display' || cat === 'projector' || cat === 'video_wall') {
    return 'display';
  }

  if (cat === 'camera') {
    if (product.camera?.ptz || (product.physical.height > product.physical.width * 0.7)) {
      return 'camera_ptz';
    }
    return 'camera_bar';
  }

  if (cat === 'speaker') {
    if (product.mounting?.ceiling || product.speaker?.mount === 'ceiling') {
      return 'speaker_ceiling';
    }
    return 'speaker_surface';
  }

  if (cat === 'microphone') {
    if (product.mounting?.ceiling || product.microphone?.mount === 'ceiling') {
      return 'mic_ceiling';
    }
    return 'mic_table';
  }

  if (product.rackUnits != null && product.rackUnits > 0) {
    return 'rack_unit';
  }

  if (cat === 'dsp' || cat === 'amplifier' || cat === 'switcher' || cat === 'codec' || cat === 'network') {
    return 'rack_unit';
  }

  return 'box';
}

/**
 * Build default VisualizationSpec from product physical and mounting specs.
 * Guarantees every product has visualization parameters even without a .glb asset.
 */
export function buildDefaultVisualizationSpec(product: EquipmentProduct): VisualizationSpec {
  if (product.visualization) {
    return product.visualization;
  }

  const fallback = inferFallbackGeometry(product);
  let frontDirection: VisualizationSpec['frontDirection'] = 'front';
  let connectionSide: VisualizationSpec['connectionSide'] = 'rear';
  let defaultInstallationHeightM: number | undefined;

  switch (fallback) {
    case 'display':
      frontDirection = 'front';
      connectionSide = 'rear';
      defaultInstallationHeightM = 1.2; // typical center AFF
      break;
    case 'camera_ptz':
    case 'camera_bar':
      frontDirection = 'front';
      connectionSide = 'rear';
      defaultInstallationHeightM = 1.4;
      break;
    case 'speaker_ceiling':
    case 'mic_ceiling':
      frontDirection = 'bottom';
      connectionSide = 'top';
      break;
    case 'mic_table':
      frontDirection = 'top';
      connectionSide = 'bottom';
      defaultInstallationHeightM = 0.74; // typical conference table height
      break;
    case 'rack_unit':
      frontDirection = 'front';
      connectionSide = 'rear';
      break;
    default:
      frontDirection = 'front';
      connectionSide = 'rear';
      break;
  }

  return {
    modelAsset: product.modelAsset,
    fallbackGeometry: fallback,
    frontDirection,
    connectionSide,
    clearanceM: product.rackUnits ? 0.05 : 0.02,
    defaultInstallationHeightM
  };
}

/**
 * Format a provenanced spec for human-facing engineering UI.
 */
export function formatSpecValue<T>(field?: ProvenancedField<T> | T, fallback = 'Unknown'): string {
  if (field === null || field === undefined) return fallback;

  if (typeof field === 'object' && 'state' in (field as Record<string, unknown>)) {
    const pf = field as ProvenancedField<T>;
    if (pf.state === 'unknown') return 'Unknown';
    if (pf.state === 'not_applicable') return 'N/A';
    if (pf.state === 'estimated') return `${String(pf.value)} (Est.)`;
    return String(pf.value);
  }

  return String(field);
}