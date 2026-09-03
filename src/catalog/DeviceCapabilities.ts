/**
 * DeviceCapabilities.ts
 * Infers device capabilities from existing spec data.
 * No category switch statements — uses presence of spec objects.
 * Existing catalog products automatically get capabilities without JSON changes.
 */

import type { EquipmentProduct, EquipmentCatalog } from './EquipmentCatalog';

export interface DeviceCapabilities {
  /** Has display coverage analysis (viewing distance, seat visibility). */
  displayCoverage: boolean;
  /** Has camera FOV coverage analysis. */
  cameraCoverage: boolean;
  /** Has microphone pickup analysis. */
  micCoverage: boolean;
  /** Has speaker dispersion analysis. */
  speakerCoverage: boolean;
  /** Can be rack-mounted. */
  rackMountable: boolean;
  /** Forwards signals (switcher, DSP, extender, amplifier). */
  forwardsSignal: boolean;
  /** Is a signal source (laptop, media player, etc.). */
  signalSource: boolean;
  /** Is a signal endpoint (display, speaker, etc.). */
  signalEndpoint: boolean;
}

/**
 * Derive device capabilities from existing product spec data.
 * Uses presence of spec objects — not hard-coded category checks.
 */
export function inferCapabilities(product: EquipmentProduct): DeviceCapabilities {
  const hasPorts = (product.ports?.length ?? 0) > 0;
  const hasOutputPorts = product.ports?.some(
    (p) => p.direction === 'output' || p.direction === 'bidirectional'
  ) ?? false;
  const hasInputPorts = product.ports?.some(
    (p) => p.direction === 'input' || p.direction === 'bidirectional'
  ) ?? false;

  return {
    displayCoverage: product.display != null,
    cameraCoverage: product.camera != null,
    micCoverage: product.microphone != null,
    speakerCoverage: product.speaker != null,
    rackMountable: (product.rackUnits != null && product.rackUnits > 0) ||
                   product.mounting?.rack === true ||
                   ((product.category === 'dsp' || product.category === 'amplifier' || product.category === 'switcher' || product.category === 'network') &&
                    product.physical?.width >= 0.43 && product.physical?.width <= 0.50),
    forwardsSignal: (product.signalForwarding?.length ?? 0) > 0 ||
                    (hasInputPorts && hasOutputPorts && product.display == null &&
                     product.speaker == null && product.camera == null &&
                     product.microphone == null),
    signalSource: hasOutputPorts && !hasInputPorts && product.display == null,
    signalEndpoint: product.display != null || product.speaker != null
  };
}

/**
 * Check if a product has a specific capability.
 * Returns false if the product is not in the catalog.
 */
export function hasCapability(
  catalog: EquipmentCatalog,
  productId: string,
  cap: keyof DeviceCapabilities
): boolean {
  const product = catalog.get(productId);
  if (!product) return false;
  return inferCapabilities(product)[cap];
}

/**
 * Get all capabilities for a product as a human-readable list.
 */
export function capabilityLabels(product: EquipmentProduct): string[] {
  const caps = inferCapabilities(product);
  const labels: string[] = [];
  if (caps.displayCoverage) labels.push('Display Coverage');
  if (caps.cameraCoverage) labels.push('Camera Coverage');
  if (caps.micCoverage) labels.push('Microphone Coverage');
  if (caps.speakerCoverage) labels.push('Speaker Coverage');
  if (caps.rackMountable) labels.push('Rack Mountable');
  if (caps.forwardsSignal) labels.push('Signal Forwarding');
  if (caps.signalSource) labels.push('Signal Source');
  if (caps.signalEndpoint) labels.push('Signal Endpoint');
  return labels;
}
