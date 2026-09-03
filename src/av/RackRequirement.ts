/**
 * RackRequirement.ts
 * Pure deterministic engineering evaluation of AV rack requirements.
 * Avoids placing unnecessary racks in huddle/small spaces with only room peripherals.
 */

import type { EquipmentInstance, EquipmentCatalog } from '../catalog/EquipmentCatalog';

export interface RackEquipmentItem {
  instanceId: string;
  name: string;
  ru: number;
  category: string;
}

export interface RackRequirementEvaluation {
  /** Authoritative engineering verdict on whether an equipment rack is required. */
  required: boolean;
  /** Human-readable engineering justification. */
  reason: string;
  /** Total rack units demanded by backend devices in the design. */
  totalRU: number;
  /** Number of devices requiring rack installation. */
  rackDeviceCount: number;
  /** List of devices contributing to the rack requirement. */
  devices: RackEquipmentItem[];
  /** Suggested rack form factor based on scale. */
  suggestedRackType: 'none' | 'wall' | 'floor';
}

/**
 * Categories that are inherently room-mounted unless explicitly declared otherwise.
 * Peripheral devices (displays, webcams, soundbars, table mics) do NOT trigger racks.
 */
const ROOM_MOUNTED_CATEGORIES = new Set(['display', 'camera', 'microphone', 'speaker']);

/**
 * Evaluates whether the current equipment lineup warrants an AV equipment rack.
 */
export function evaluateRackRequirement(
  equipment: EquipmentInstance[],
  catalog: EquipmentCatalog
): RackRequirementEvaluation {
  const rackDevices: RackEquipmentItem[] = [];

  for (const inst of equipment) {
    const product = catalog.get(inst.productId);
    if (!product) continue;

    // Explicit mountingKind override
    if (inst.mountingKind === 'rack' || inst.rackId) {
      const ru = inst.rackUnits ?? product.rackUnits ?? 1;
      rackDevices.push({
        instanceId: inst.instanceId,
        name: inst.name || `${product.manufacturer} ${product.model}`,
        ru,
        category: product.category
      });
      continue;
    }

    // Room mounted peripherals do not trigger racks
    if (ROOM_MOUNTED_CATEGORIES.has(product.category) && inst.mountingKind !== 'rack') {
      continue;
    }

    // Centralized infrastructure categories (DSP, amplifier, matrix switch, network, codec)
    const isCentralizedCat =
      product.category === 'dsp' ||
      product.category === 'amplifier' ||
      product.category === 'switcher' ||
      product.category === 'network';

    const is19Inch = product.physical?.width >= 0.43 && product.physical?.width <= 0.50;
    const hasRackSpec = (product.rackUnits != null && product.rackUnits > 0) || product.mounting?.rack === true || is19Inch;

    if (isCentralizedCat && hasRackSpec) {
      const derivedRU = product.physical?.height > 0 ? Math.max(1, Math.round(product.physical.height / 0.04445)) : 1;
      const ru = inst.rackUnits ?? product.rackUnits ?? derivedRU;
      rackDevices.push({
        instanceId: inst.instanceId,
        name: inst.name || `${product.manufacturer} ${product.model}`,
        ru,
        category: product.category
      });
    }
  }

  const totalRU = rackDevices.reduce((sum, d) => sum + d.ru, 0);
  const rackDeviceCount = rackDevices.length;

  if (rackDeviceCount === 0) {
    return {
      required: false,
      reason: 'No rack-mounted backend equipment in design (all devices are room-mounted peripherals)',
      totalRU: 0,
      rackDeviceCount: 0,
      devices: [],
      suggestedRackType: 'none'
    };
  }

  if (totalRU >= 4 || rackDeviceCount >= 2) {
    return {
      required: true,
      reason: `${rackDeviceCount} centralized equipment item(s) require ${totalRU} RU total (floor equipment cabinet recommended)`,
      totalRU,
      rackDeviceCount,
      devices: rackDevices,
      suggestedRackType: 'floor'
    };
  }

  return {
    required: true,
    reason: `1 centralized equipment item requires ${totalRU} RU (compact wall-mount rack recommended)`,
    totalRU,
    rackDeviceCount,
    devices: rackDevices,
    suggestedRackType: 'wall'
  };
}
