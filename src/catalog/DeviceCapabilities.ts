/**
 * DeviceCapabilities.ts
 * Capability-Based Engineering Model (§13).
 * Infers and manages device capabilities from engineering specifications
 * rather than brittle category string checks.
 *
 * Supports multi-function devices (e.g. videobars, touch panels with mics)
 * and guarantees 100% backward compatibility with existing tests.
 */

import type { EquipmentProduct, EquipmentCatalog } from './EquipmentCatalog';
import type { PortDefinition, SignalType } from '../system/SystemTypes';

/* ============================================================
   1. Structured Capability Interfaces (§13)
   ============================================================ */

export interface DisplayCapability {
  diagonalInches: number;
  resolution?: string;
  aspectRatio?: string;
  brightnessNits?: number;
  orientation?: 'landscape' | 'portrait';
  vesa?: string;
  viewingDistanceMinM?: number;
  viewingDistanceMaxM?: number;
}

export interface CameraCapability {
  horizontalFovDeg?: number;
  verticalFovDeg?: number;
  diagonalFovDeg?: number;
  ptz?: boolean;
  panRangeDeg?: number;
  tiltRangeDeg?: number;
  zoomMultiplier?: number;
  tracking?: boolean;
}

export interface MicrophoneCapability {
  pickupRadiusM: number;
  pattern: string;
  channels: number;
  coverageModel?: 'omni' | 'directional_sector';
  beamWidthDeg?: number;
  pickupAngleDeg?: number;
  directionality?: string;
}

export interface SpeakerCapability {
  mount: 'ceiling' | 'wall' | 'pendant' | 'integrated';
  dispersionDeg?: number;
  horizontalDispersionDeg?: number;
  verticalDispersionDeg?: number;
  coverageAngleDeg?: number;
  maxSplAt1m?: number;
  sensitivityDb?: number;
  powerClass?: 'active' | 'passive';
}

export interface ConnectivityCapability {
  ports: PortDefinition[];
  forwardsSignal: boolean;
  signalSource: boolean;
  signalEndpoint: boolean;
  signalForwarding?: SignalType[];
}

export interface RackCapability {
  rackMountable: boolean;
  rackUnits?: number;
  widthM?: number;
  serviceClearanceM?: number;
}

export interface PowerCapability {
  powerWatts?: number;
  poeClass?: string;
  voltage?: number;
  currentAmps?: number;
}

export interface CoverageCapability {
  kinds: Array<'display' | 'camera' | 'microphone' | 'speaker'>;
}

export interface MountingCapability {
  wall: boolean;
  floor: boolean;
  ceiling: boolean;
  table: boolean;
  rack: boolean;
  freestanding?: boolean;
  vesa?: string;
}

/* ============================================================
   2. Aggregated DeviceCapabilities Model
   ============================================================ */

export interface DeviceCapabilities {
  // Legacy boolean flags for 100% backward compatibility
  displayCoverage: boolean;
  cameraCoverage: boolean;
  micCoverage: boolean;
  speakerCoverage: boolean;
  rackMountable: boolean;
  forwardsSignal: boolean;
  signalSource: boolean;
  signalEndpoint: boolean;

  // New boolean capability flags (§13)
  hasDisplay: boolean;
  hasCamera: boolean;
  hasMicrophone: boolean;
  hasSpeaker: boolean;
  hasConnectivity: boolean;
  hasRack: boolean;
  hasPower: boolean;
  hasMounting: boolean;

  // Structured capability payloads
  display?: DisplayCapability;
  camera?: CameraCapability;
  microphone?: MicrophoneCapability;
  speaker?: SpeakerCapability;
  connectivity?: ConnectivityCapability;
  rack?: RackCapability;
  power?: PowerCapability;
  coverage?: CoverageCapability;
  mounting?: MountingCapability;
  customProperties?: Record<string, unknown>;
}

/* ============================================================
   3. Capability Inference Function
   ============================================================ */

/**
 * Derive comprehensive capabilities from product metadata.
 * Uses presence of specifications — never category string switches alone.
 */
export function inferCapabilities(product: EquipmentProduct): DeviceCapabilities {
  const ports = product.ports ?? [];
  const hasPorts = ports.length > 0;
  const hasOutputPorts = ports.some(
    (p) => p.direction === 'output' || p.direction === 'bidirectional'
  );
  const hasInputPorts = ports.some(
    (p) => p.direction === 'input' || p.direction === 'bidirectional'
  );

  // 1. Display
  const hasDisplay = product.display != null;
  const display: DisplayCapability | undefined = product.display
    ? {
        diagonalInches: product.display.diagonalInches,
        resolution: product.display.resolution,
        aspectRatio: product.display.aspectRatio,
        brightnessNits: product.display.brightnessNits,
        orientation: product.display.orientation,
        vesa: product.display.vesa ?? product.mounting?.vesa,
        viewingDistanceMinM: product.display.viewingDistanceMinM,
        viewingDistanceMaxM: product.display.viewingDistanceMaxM
      }
    : undefined;

  // 2. Camera
  const hasCamera = product.camera != null;
  const camera: CameraCapability | undefined = product.camera
    ? {
        horizontalFovDeg: product.camera.horizontalFovDeg,
        verticalFovDeg: product.camera.verticalFovDeg,
        diagonalFovDeg: product.camera.diagonalFovDeg,
        ptz: product.camera.ptz,
        panRangeDeg: product.camera.panRangeDeg,
        tiltRangeDeg: product.camera.tiltRangeDeg,
        zoomMultiplier: product.camera.zoomMultiplier,
        tracking: product.camera.tracking
      }
    : undefined;

  // 3. Microphone
  const hasMicrophone = product.microphone != null;
  const microphone: MicrophoneCapability | undefined = product.microphone
    ? {
        pickupRadiusM: product.microphone.pickupRadiusM,
        pattern: product.microphone.pattern,
        channels: product.microphone.channels,
        coverageModel: product.microphone.coverageModel,
        beamWidthDeg: product.microphone.beamWidthDeg,
        pickupAngleDeg: product.microphone.pickupAngleDeg,
        directionality: product.microphone.directionality
      }
    : undefined;

  // 4. Speaker
  const hasSpeaker = product.speaker != null;
  const speaker: SpeakerCapability | undefined = product.speaker
    ? {
        mount: product.speaker.mount,
        dispersionDeg: product.speaker.dispersionDeg,
        horizontalDispersionDeg: product.speaker.horizontalDispersionDeg,
        verticalDispersionDeg: product.speaker.verticalDispersionDeg,
        coverageAngleDeg: product.speaker.coverageAngleDeg,
        maxSplAt1m: product.speaker.maxSplAt1m,
        sensitivityDb: product.speaker.sensitivityDb,
        powerClass: product.speaker.powerClass
      }
    : undefined;

  // 5. Connectivity & Signal Flow
  const forwardsSignal =
    (product.signalForwarding?.length ?? 0) > 0 ||
    (hasInputPorts &&
      hasOutputPorts &&
      product.display == null &&
      product.speaker == null &&
      product.camera == null &&
      product.microphone == null);

  const signalSource = hasOutputPorts && !hasInputPorts && product.display == null;
  const signalEndpoint = product.display != null || product.speaker != null;

  const connectivity: ConnectivityCapability = {
    ports,
    forwardsSignal,
    signalSource,
    signalEndpoint,
    signalForwarding: product.signalForwarding
  };

  // 6. Rack Capability
  const is19Inch =
    product.physical?.width != null &&
    product.physical.width >= 0.43 &&
    product.physical.width <= 0.50;

  const rackMountable =
    (product.rackUnits != null && product.rackUnits > 0) ||
    product.mounting?.rack === true ||
    ((product.category === 'dsp' ||
      product.category === 'amplifier' ||
      product.category === 'switcher' ||
      product.category === 'network') &&
      is19Inch);

  const rack: RackCapability | undefined = rackMountable
    ? {
        rackMountable: true,
        rackUnits: product.rackUnits,
        widthM: product.physical?.width,
        serviceClearanceM: 0.05
      }
    : undefined;

  // 7. Power Capability
  const hasPower = product.power != null || product.physical?.powerWatts != null;
  const power: PowerCapability | undefined = hasPower
    ? {
        powerWatts: product.power?.powerWatts ?? product.physical?.powerWatts,
        poeClass: product.power?.poeClass,
        voltage: product.power?.voltage,
        currentAmps: product.power?.currentAmps
      }
    : undefined;

  // 8. Coverage Capability
  const coverageKinds: Array<'display' | 'camera' | 'microphone' | 'speaker'> = [];
  if (hasDisplay) coverageKinds.push('display');
  if (hasCamera) coverageKinds.push('camera');
  if (hasMicrophone) coverageKinds.push('microphone');
  if (hasSpeaker) coverageKinds.push('speaker');

  const coverage: CoverageCapability | undefined =
    coverageKinds.length > 0 ? { kinds: coverageKinds } : undefined;

  // 9. Mounting Capability
  const mounting: MountingCapability = {
    wall: product.mounting?.wall ?? false,
    floor: product.mounting?.floor ?? false,
    ceiling: product.mounting?.ceiling ?? false,
    table: product.mounting?.table ?? false,
    rack: product.mounting?.rack ?? rackMountable,
    freestanding: product.mounting?.freestanding,
    vesa: product.mounting?.vesa ?? product.display?.vesa
  };

  return {
    displayCoverage: hasDisplay,
    cameraCoverage: hasCamera,
    micCoverage: hasMicrophone,
    speakerCoverage: hasSpeaker,
    rackMountable,
    forwardsSignal,
    signalSource,
    signalEndpoint,

    hasDisplay,
    hasCamera,
    hasMicrophone,
    hasSpeaker,
    hasConnectivity: hasPorts || forwardsSignal,
    hasRack: rackMountable,
    hasPower,
    hasMounting: true,

    display,
    camera,
    microphone,
    speaker,
    connectivity,
    rack,
    power,
    coverage,
    mounting,
    customProperties: {}
  };
}

/* ============================================================
   4. Capability Query Utilities
   ============================================================ */

/**
 * Check if a product has a specific capability.
 * Returns false if the product is not found in the catalog.
 */
export function hasCapability(
  catalog: EquipmentCatalog,
  productId: string,
  cap: keyof DeviceCapabilities
): boolean {
  const product = catalog.get(productId);
  if (!product) return false;
  return Boolean(inferCapabilities(product)[cap]);
}

/**
 * Check if a product satisfies ANY of the specified capabilities.
 */
export function hasAnyCapability(
  catalog: EquipmentCatalog,
  productId: string,
  caps: Array<keyof DeviceCapabilities>
): boolean {
  const product = catalog.get(productId);
  if (!product) return false;
  const inferred = inferCapabilities(product);
  return caps.some((cap) => Boolean(inferred[cap]));
}

/**
 * Check if a product satisfies ALL of the specified capabilities.
 */
export function hasAllCapabilities(
  catalog: EquipmentCatalog,
  productId: string,
  caps: Array<keyof DeviceCapabilities>
): boolean {
  const product = catalog.get(productId);
  if (!product) return false;
  const inferred = inferCapabilities(product);
  return caps.every((cap) => Boolean(inferred[cap]));
}

export function getDisplayCapability(product: EquipmentProduct): DisplayCapability | null {
  return inferCapabilities(product).display ?? null;
}

export function getCameraCapability(product: EquipmentProduct): CameraCapability | null {
  return inferCapabilities(product).camera ?? null;
}

export function getMicrophoneCapability(product: EquipmentProduct): MicrophoneCapability | null {
  return inferCapabilities(product).microphone ?? null;
}

export function getSpeakerCapability(product: EquipmentProduct): SpeakerCapability | null {
  return inferCapabilities(product).speaker ?? null;
}

export function getRackCapability(product: EquipmentProduct): RackCapability | null {
  return inferCapabilities(product).rack ?? null;
}

export function getPowerCapability(product: EquipmentProduct): PowerCapability | null {
  return inferCapabilities(product).power ?? null;
}

export function getConnectivityCapability(product: EquipmentProduct): ConnectivityCapability | null {
  return inferCapabilities(product).connectivity ?? null;
}

export function getMountingCapability(product: EquipmentProduct): MountingCapability | null {
  return inferCapabilities(product).mounting ?? null;
}

/**
 * Get all capabilities for a product as a human-readable list.
 */
export function capabilityLabels(product: EquipmentProduct): string[] {
  const caps = inferCapabilities(product);
  const labels: string[] = [];
  if (caps.hasDisplay) labels.push('Display Coverage');
  if (caps.hasCamera) labels.push('Camera Coverage');
  if (caps.hasMicrophone) labels.push('Microphone Coverage');
  if (caps.hasSpeaker) labels.push('Speaker Coverage');
  if (caps.hasRack) labels.push('Rack Mountable');
  if (caps.forwardsSignal) labels.push('Signal Forwarding');
  if (caps.signalSource) labels.push('Signal Source');
  if (caps.signalEndpoint) labels.push('Signal Endpoint');
  if (caps.hasPower) labels.push('Power Specified');
  return labels;
}