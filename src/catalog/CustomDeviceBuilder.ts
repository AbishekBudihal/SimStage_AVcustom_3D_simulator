/**
 * CustomDeviceBuilder.ts
 * Constructs valid EquipmentProduct from user-provided partial data.
 * Validates input before building. Never invents engineering values (§4, §15).
 */

import type {
  EquipmentProduct,
  EquipmentCategory,
  PhysicalSpec,
  DisplaySpec,
  CameraSpec,
  MicrophoneSpec,
  SpeakerSpec,
  MountingSpec,
  PowerSpec,
  DataProvenance,
  LibraryTier,
  VisualizationSpec
} from './EquipmentCatalog';
import type { PortDefinition, SignalType } from '../system/SystemTypes';
import { buildDefaultVisualizationSpec } from './UniversalDeviceModel';

export type CustomDeviceType =
  | 'display'
  | 'camera'
  | 'microphone'
  | 'speaker'
  | 'dsp'
  | 'amplifier'
  | 'codec'
  | 'matrix'
  | 'switcher'
  | 'network_switch'
  | 'control_processor'
  | 'av_over_ip'
  | 'converter'
  | 'extender'
  | 'rack'
  | 'other';

export interface CustomDeviceInput {
  manufacturer: string;
  model: string;
  partNumber?: string;
  productName?: string;
  category: EquipmentCategory;
  type?: string;
  description?: string;
  width: number;
  height: number;
  depth: number;
  weightKg?: number;
  powerWatts?: number;
  power?: PowerSpec;
  ports?: PortDefinition[];
  rackUnits?: number;
  rackMountable?: boolean;
  provenance?: DataProvenance;
  source?: string;
  datasheetUrl?: string;
  modelAsset?: string;
  signalForwarding?: SignalType[];
  display?: Partial<DisplaySpec>;
  camera?: Partial<CameraSpec>;
  microphone?: Partial<MicrophoneSpec>;
  speaker?: Partial<SpeakerSpec>;
  mounting?: Partial<MountingSpec>;
  visualization?: Partial<VisualizationSpec>;
  libraryTier?: LibraryTier;
  sku?: string;
  notes?: string;
}

export interface CustomDeviceValidation {
  valid: boolean;
  errors: string[];
}

/**
 * Return purpose-driven smart defaults for a given device type (§4, §15).
 */
export function getDeviceTypeDefaults(type: CustomDeviceType): Partial<CustomDeviceInput> {
  switch (type) {
    case 'display':
      return {
        category: 'display',
        width: 1.23,
        height: 0.71,
        depth: 0.05,
        weightKg: 15,
        powerWatts: 130,
        mounting: { wall: true, floor: false, ceiling: false, rack: false, vesa: '400x400' },
        display: { diagonalInches: 55, resolution: '3840x2160', aspectRatio: '16:9', brightnessNits: 500, orientation: 'landscape' },
        ports: [
          { id: 'hdmi-in-1', label: 'HDMI IN 1', direction: 'input', signalTypes: ['VIDEO', 'AUDIO'], connector: 'hdmi' },
          { id: 'hdmi-in-2', label: 'HDMI IN 2', direction: 'input', signalTypes: ['VIDEO', 'AUDIO'], connector: 'hdmi' },
          { id: 'lan', label: 'CONTROL LAN', direction: 'bidirectional', signalTypes: ['NETWORK', 'CONTROL'], connector: 'rj45' }
        ]
      };

    case 'camera':
      return {
        category: 'camera',
        width: 0.16,
        height: 0.18,
        depth: 0.16,
        weightKg: 1.8,
        powerWatts: 18,
        mounting: { wall: true, ceiling: true, table: false, rack: false },
        camera: { mount: 'wall', horizontalFovDeg: 80, verticalFovDeg: 50, ptz: true },
        ports: [
          { id: 'hdmi-out', label: 'HDMI OUT', direction: 'output', signalTypes: ['VIDEO'], connector: 'hdmi' },
          { id: 'lan-poe', label: 'LAN (PoE)', direction: 'bidirectional', signalTypes: ['NETWORK', 'CONTROL'], connector: 'rj45', poeRequirementWatts: 15 }
        ]
      };

    case 'microphone':
      return {
        category: 'microphone',
        width: 0.6,
        height: 0.05,
        depth: 0.6,
        weightKg: 4.5,
        powerWatts: 12,
        mounting: { wall: false, ceiling: true, table: false, rack: false },
        microphone: { mount: 'ceiling', pickupRadiusM: 4.0, pattern: 'steerable array', channels: 8, coverageModel: 'omni' },
        ports: [
          { id: 'dante-out', label: 'DANTE / LAN', direction: 'output', signalTypes: ['DANTE', 'AUDIO'], connector: 'rj45', protocol: 'Dante', poeRequirementWatts: 12 }
        ]
      };

    case 'speaker':
      return {
        category: 'speaker',
        width: 0.25,
        height: 0.25,
        depth: 0.2,
        weightKg: 3.2,
        powerWatts: 30,
        mounting: { wall: false, ceiling: true, floor: false, rack: false },
        speaker: { mount: 'ceiling', dispersionDeg: 110, maxSplAt1m: 102, sensitivityDb: 89, powerClass: 'passive' },
        ports: [
          { id: 'spk-in', label: 'SPEAKER IN', direction: 'input', signalTypes: ['AUDIO'], connector: 'phoenix', transport: 'analog-speaker' }
        ]
      };

    case 'dsp':
      return {
        category: 'dsp',
        width: 0.483,
        height: 0.044,
        depth: 0.3,
        weightKg: 3.5,
        powerWatts: 45,
        rackUnits: 1,
        rackMountable: true,
        mounting: { wall: false, ceiling: false, floor: false, rack: true },
        signalForwarding: ['AUDIO', 'DANTE'],
        ports: [
          { id: 'mic-in-1', label: 'MIC IN 1', direction: 'input', signalTypes: ['AUDIO'], connector: 'phoenix' },
          { id: 'line-out-1', label: 'LINE OUT 1', direction: 'output', signalTypes: ['AUDIO'], connector: 'phoenix' },
          { id: 'dante-primary', label: 'DANTE PRIMARY', direction: 'bidirectional', signalTypes: ['DANTE', 'AUDIO'], connector: 'rj45', protocol: 'Dante' }
        ]
      };

    case 'amplifier':
      return {
        category: 'amplifier',
        width: 0.483,
        height: 0.088,
        depth: 0.35,
        weightKg: 8.0,
        powerWatts: 400,
        rackUnits: 2,
        rackMountable: true,
        mounting: { wall: false, ceiling: false, floor: false, rack: true },
        ports: [
          { id: 'line-in-1', label: 'INPUT CH 1', direction: 'input', signalTypes: ['AUDIO'], connector: 'phoenix' },
          { id: 'spk-out-1', label: 'SPEAKER OUT 1', direction: 'output', signalTypes: ['AUDIO'], connector: 'speakon', transport: 'analog-speaker' }
        ]
      };

    case 'codec':
      return {
        category: 'codec',
        width: 0.3,
        height: 0.044,
        depth: 0.2,
        weightKg: 2.0,
        powerWatts: 35,
        rackMountable: false,
        mounting: { wall: true, table: true, ceiling: false, rack: false },
        ports: [
          { id: 'hdmi-in', label: 'CONTENT HDMI IN', direction: 'input', signalTypes: ['VIDEO', 'AUDIO'], connector: 'hdmi' },
          { id: 'hdmi-out-1', label: 'DISPLAY 1 OUT', direction: 'output', signalTypes: ['VIDEO', 'AUDIO'], connector: 'hdmi' },
          { id: 'lan', label: 'NETWORK', direction: 'bidirectional', signalTypes: ['NETWORK'], connector: 'rj45' }
        ]
      };

    case 'matrix':
    case 'switcher':
      return {
        category: 'switcher',
        width: 0.483,
        height: 0.088,
        depth: 0.3,
        weightKg: 5.0,
        powerWatts: 75,
        rackUnits: 2,
        rackMountable: true,
        mounting: { wall: false, ceiling: false, floor: false, rack: true },
        signalForwarding: ['VIDEO', 'AUDIO'],
        ports: [
          { id: 'hdmi-in-1', label: 'HDMI IN 1', direction: 'input', signalTypes: ['VIDEO', 'AUDIO'], connector: 'hdmi' },
          { id: 'hdmi-in-2', label: 'HDMI IN 2', direction: 'input', signalTypes: ['VIDEO', 'AUDIO'], connector: 'hdmi' },
          { id: 'hdmi-out-1', label: 'HDMI OUT 1', direction: 'output', signalTypes: ['VIDEO', 'AUDIO'], connector: 'hdmi' },
          { id: 'hdmi-out-2', label: 'HDMI OUT 2', direction: 'output', signalTypes: ['VIDEO', 'AUDIO'], connector: 'hdmi' }
        ]
      };

    case 'network_switch':
      return {
        category: 'network',
        width: 0.483,
        height: 0.044,
        depth: 0.28,
        weightKg: 3.8,
        powerWatts: 370,
        rackUnits: 1,
        rackMountable: true,
        mounting: { wall: false, ceiling: false, floor: false, rack: true },
        ports: [
          { id: 'port-1', label: 'GE Port 1 (PoE+)', direction: 'bidirectional', signalTypes: ['NETWORK', 'CONTROL'], connector: 'rj45', poeBudgetWatts: 30 },
          { id: 'port-2', label: 'GE Port 2 (PoE+)', direction: 'bidirectional', signalTypes: ['NETWORK', 'CONTROL'], connector: 'rj45', poeBudgetWatts: 30 }
        ]
      };

    case 'extender':
    case 'converter':
    case 'av_over_ip':
      return {
        category: 'extender',
        width: 0.12,
        height: 0.03,
        depth: 0.09,
        weightKg: 0.4,
        powerWatts: 10,
        rackMountable: false,
        mounting: { wall: true, table: true, ceiling: false, rack: false },
        signalForwarding: ['VIDEO', 'AUDIO'],
        ports: [
          { id: 'hdmi-in', label: 'HDMI IN', direction: 'input', signalTypes: ['VIDEO', 'AUDIO'], connector: 'hdmi' },
          { id: 'cat-out', label: 'CAT OUT', direction: 'output', signalTypes: ['VIDEO', 'AUDIO'], connector: 'rj45', transport: 'hdmi-over-cat' }
        ]
      };

    case 'rack':
      return {
        category: 'rack',
        width: 0.6,
        height: 1.8,
        depth: 0.8,
        weightKg: 65,
        rackUnits: 42,
        rackMountable: false,
        mounting: { wall: false, ceiling: false, floor: true, rack: false }
      };

    default:
      return {
        category: 'source',
        width: 0.3,
        height: 0.044,
        depth: 0.2,
        weightKg: 1.5,
        powerWatts: 25,
        mounting: { wall: false, ceiling: false, table: true, rack: false }
      };
  }
}

/**
 * Validate custom device input before building.
 */
export function validateCustomDeviceInput(input: Partial<CustomDeviceInput>): CustomDeviceValidation {
  const errors: string[] = [];

  if (!input.manufacturer?.trim()) errors.push('Manufacturer is required.');
  if (!input.model?.trim()) errors.push('Model is required.');
  if (!input.category) errors.push('Category is required.');
  if (input.width == null || input.width <= 0) errors.push('Width must be positive.');
  if (input.height == null || input.height <= 0) errors.push('Height must be positive.');
  if (input.depth == null || input.depth <= 0) errors.push('Depth must be positive.');
  if (input.rackUnits != null && input.rackUnits < 0) errors.push('Rack units cannot be negative.');
  if (input.powerWatts != null && input.powerWatts < 0) errors.push('Power cannot be negative.');

  if (input.ports) {
    for (let i = 0; i < input.ports.length; i++) {
      const p = input.ports[i];
      if (!p.id?.trim()) errors.push(`Port ${i + 1}: ID is required.`);
      if (!p.label?.trim()) errors.push(`Port ${i + 1}: Label is required.`);
      if (!p.direction) errors.push(`Port ${i + 1}: Direction is required.`);
      if (!p.signalTypes?.length) errors.push(`Port ${i + 1}: At least one signal type is required.`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Build a valid EquipmentProduct from custom device input.
 * Throws if validation fails.
 */
export function buildCustomDevice(input: CustomDeviceInput): EquipmentProduct {
  const validation = validateCustomDeviceInput(input);
  if (!validation.valid) {
    throw new Error(`Invalid custom device: ${validation.errors.join(' ')}`);
  }

  const id = `custom-${input.manufacturer.toLowerCase().replace(/\s+/g, '-')}-${input.model.toLowerCase().replace(/\s+/g, '-')}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const physical: PhysicalSpec = {
    width: input.width,
    height: input.height,
    depth: input.depth
  };
  if (input.weightKg != null) physical.weightKg = input.weightKg;
  if (input.powerWatts != null) physical.powerWatts = input.powerWatts;

  const mounting: MountingSpec = {
    wall: input.mounting?.wall ?? false,
    floor: input.mounting?.floor ?? false,
    ceiling: input.mounting?.ceiling ?? false,
    table: input.mounting?.table ?? false,
    rack: input.mounting?.rack ?? input.rackMountable ?? (input.rackUnits != null && input.rackUnits > 0),
    freestanding: input.mounting?.freestanding,
    vesa: input.mounting?.vesa ?? input.display?.vesa
  };

  const product: EquipmentProduct = {
    id,
    manufacturer: input.manufacturer.trim(),
    model: input.model.trim(),
    category: input.category,
    type: input.type ?? input.category,
    description: input.description?.trim(),
    physical,
    mounting,
    provenance: input.provenance ?? 'user_defined',
    source: input.source?.trim() || (input.provenance === 'verified' ? 'Manufacturer datasheet' : 'User-created device'),
    libraryTier: input.libraryTier ?? 'user',
    sku: input.sku?.trim() || input.partNumber?.trim(),
    notes: input.notes?.trim()
  };

  if (input.partNumber?.trim()) product.partNumber = input.partNumber.trim();
  if (input.productName?.trim()) product.productName = input.productName.trim();
  if (input.datasheetUrl?.trim()) product.datasheetUrl = input.datasheetUrl.trim();
  if (input.modelAsset?.trim()) product.modelAsset = input.modelAsset.trim();
  if (input.power) product.power = input.power;
  else if (input.powerWatts != null) product.power = { powerWatts: input.powerWatts };

  if (input.ports?.length) product.ports = input.ports;
  if (input.rackUnits != null && input.rackUnits > 0) product.rackUnits = input.rackUnits;
  if (input.signalForwarding?.length) product.signalForwarding = input.signalForwarding;

  // Category-specific specs
  if (input.display?.diagonalInches) {
    product.display = {
      diagonalInches: input.display.diagonalInches,
      resolution: input.display.resolution ?? 'unknown',
      aspectRatio: input.display.aspectRatio ?? '16:9',
      brightnessNits: input.display.brightnessNits ?? 0,
      orientation: input.display.orientation ?? 'landscape',
      vesa: input.display.vesa ?? mounting.vesa,
      bezelWidthM: input.display.bezelWidthM,
      viewingDistanceMinM: input.display.viewingDistanceMinM,
      viewingDistanceMaxM: input.display.viewingDistanceMaxM
    };
  }

  if (input.camera?.mount || input.camera?.horizontalFovDeg != null || input.camera?.diagonalFovDeg != null) {
    product.camera = {
      mount: input.camera?.mount ?? 'wall',
      horizontalFovDeg: input.camera?.horizontalFovDeg,
      verticalFovDeg: input.camera?.verticalFovDeg,
      diagonalFovDeg: input.camera?.diagonalFovDeg,
      ptz: input.camera?.ptz,
      panRangeDeg: input.camera?.panRangeDeg,
      tiltRangeDeg: input.camera?.tiltRangeDeg,
      zoomMultiplier: input.camera?.zoomMultiplier,
      tracking: input.camera?.tracking
    };
  }

  if (input.microphone?.mount || input.microphone?.pickupRadiusM != null) {
    product.microphone = {
      mount: input.microphone?.mount ?? 'ceiling',
      pickupRadiusM: input.microphone?.pickupRadiusM ?? 3.0,
      pattern: input.microphone?.pattern ?? 'unknown',
      channels: input.microphone?.channels ?? 1,
      connection: input.microphone?.connection ?? 'unknown',
      coverageModel: input.microphone?.coverageModel,
      beamWidthDeg: input.microphone?.beamWidthDeg,
      pickupAngleDeg: input.microphone?.pickupAngleDeg,
      directionality: input.microphone?.directionality,
      frequencyResponse: input.microphone?.frequencyResponse
    };
  }

  if (input.speaker?.mount || input.speaker?.dispersionDeg != null) {
    product.speaker = {
      mount: input.speaker?.mount ?? 'ceiling',
      dispersionDeg: input.speaker?.dispersionDeg,
      horizontalDispersionDeg: input.speaker?.horizontalDispersionDeg,
      verticalDispersionDeg: input.speaker?.verticalDispersionDeg,
      coverageAngleDeg: input.speaker?.coverageAngleDeg,
      maxSplAt1m: input.speaker?.maxSplAt1m,
      sensitivityDb: input.speaker?.sensitivityDb,
      powerClass: input.speaker?.powerClass,
      powerHandlingWatts: input.speaker?.powerHandlingWatts
    };
  }

  // Visualization metadata
  if (input.visualization) {
    product.visualization = {
      ...buildDefaultVisualizationSpec(product),
      ...input.visualization
    };
  } else {
    product.visualization = buildDefaultVisualizationSpec(product);
  }

  return product;
}