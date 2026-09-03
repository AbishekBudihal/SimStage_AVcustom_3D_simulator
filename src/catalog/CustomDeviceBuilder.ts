/**
 * CustomDeviceBuilder.ts
 * Constructs valid EquipmentProduct from user-provided partial data.
 * Validates input before building. Never invents engineering values.
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
  DataProvenance
} from './EquipmentCatalog';
import type { PortDefinition, SignalType } from '../system/SystemTypes';

export interface CustomDeviceInput {
  manufacturer: string;
  model: string;
  partNumber?: string;
  productName?: string;
  category: EquipmentCategory;
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
}

export interface CustomDeviceValidation {
  valid: boolean;
  errors: string[];
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
    wall: false,
    floor: false,
    ceiling: false,
    rack: input.rackMountable ?? (input.rackUnits != null && input.rackUnits > 0)
  };

  const product: EquipmentProduct = {
    id,
    manufacturer: input.manufacturer.trim(),
    model: input.model.trim(),
    category: input.category,
    type: input.category,
    description: input.description?.trim(),
    physical,
    mounting,
    provenance: input.provenance ?? 'user_defined',
    source: input.source?.trim() || (input.provenance === 'verified' ? 'Manufacturer datasheet' : 'User-created device')
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

  // Category-specific specs — only include if provided and meaningful
  if (input.display?.diagonalInches) {
    product.display = {
      diagonalInches: input.display.diagonalInches,
      resolution: input.display.resolution ?? 'unknown',
      aspectRatio: input.display.aspectRatio ?? '16:9',
      brightnessNits: input.display.brightnessNits ?? 0
    };
  }
  if (input.camera?.mount) {
    product.camera = {
      mount: input.camera.mount,
      horizontalFovDeg: input.camera.horizontalFovDeg,
      verticalFovDeg: input.camera.verticalFovDeg
    };
  }
  if (input.microphone?.mount && input.microphone?.pickupRadiusM) {
    product.microphone = {
      mount: input.microphone.mount,
      pickupRadiusM: input.microphone.pickupRadiusM,
      pattern: input.microphone.pattern ?? 'unknown',
      channels: input.microphone.channels ?? 1,
      connection: input.microphone.connection ?? 'unknown',
      coverageModel: input.microphone.coverageModel,
      beamWidthDeg: input.microphone.beamWidthDeg
    };
  }
  if (input.speaker?.mount) {
    product.speaker = {
      mount: input.speaker.mount,
      dispersionDeg: input.speaker.dispersionDeg,
      horizontalDispersionDeg: input.speaker.horizontalDispersionDeg,
      verticalDispersionDeg: input.speaker.verticalDispersionDeg,
      maxSplAt1m: input.speaker.maxSplAt1m,
      sensitivityDb: input.speaker.sensitivityDb,
      powerClass: input.speaker.powerClass
    };
  }

  return product;
}
