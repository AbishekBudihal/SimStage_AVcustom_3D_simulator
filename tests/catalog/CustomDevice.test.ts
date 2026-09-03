import { describe, it, expect } from 'vitest';
import { loadDefaultCatalog } from '../../src/catalog/loadCatalog';
import { inferCapabilities, hasCapability, capabilityLabels } from '../../src/catalog/DeviceCapabilities';
import { buildCustomDevice, validateCustomDeviceInput, type CustomDeviceInput } from '../../src/catalog/CustomDeviceBuilder';
import type { EquipmentProduct } from '../../src/catalog/EquipmentCatalog';

const catalog = loadDefaultCatalog();

describe('Device capabilities inference', () => {
  it('infers displayCoverage from display spec', () => {
    const product = catalog.get('lg-86uh5j')!;
    const caps = inferCapabilities(product);
    expect(caps.displayCoverage).toBe(true);
    expect(caps.cameraCoverage).toBe(false);
    expect(caps.signalEndpoint).toBe(true);
  });

  it('infers cameraCoverage from camera spec', () => {
    const product = catalog.get('yealink-uvc84')!;
    const caps = inferCapabilities(product);
    expect(caps.cameraCoverage).toBe(true);
    expect(caps.displayCoverage).toBe(false);
  });

  it('infers rackMountable from rackUnits', () => {
    const product = catalog.get('biamp-tesiraforte-vt4')!;
    const caps = inferCapabilities(product);
    expect(caps.rackMountable).toBe(true);
  });

  it('infers forwardsSignal from signalForwarding', () => {
    const product = catalog.get('user-hdmi-switcher-2x1')!;
    const caps = inferCapabilities(product);
    expect(caps.forwardsSignal).toBe(true);
  });

  it('infers signalSource for output-only devices', () => {
    const product = catalog.get('user-laptop-source')!;
    const caps = inferCapabilities(product);
    expect(caps.signalSource).toBe(true);
    expect(caps.signalEndpoint).toBe(false);
  });

  it('hasCapability works with catalog', () => {
    expect(hasCapability(catalog, 'lg-86uh5j', 'displayCoverage')).toBe(true);
    expect(hasCapability(catalog, 'lg-86uh5j', 'cameraCoverage')).toBe(false);
    expect(hasCapability(catalog, 'nonexistent', 'displayCoverage')).toBe(false);
  });

  it('capabilityLabels returns human-readable list', () => {
    const product = catalog.get('lg-86uh5j')!;
    const labels = capabilityLabels(product);
    expect(labels).toContain('Display Coverage');
    expect(labels).toContain('Signal Endpoint');
    expect(labels).not.toContain('Camera Coverage');
  });
});

describe('Custom device builder', () => {
  const validInput: CustomDeviceInput = {
    manufacturer: 'TestCo',
    model: 'Widget-X1',
    category: 'dsp',
    width: 0.48,
    height: 0.044,
    depth: 0.3,
    rackUnits: 1,
    rackMountable: true,
    ports: [
      { id: 'in-1', label: 'IN 1', direction: 'input', signalTypes: ['AUDIO'], connector: 'xlr' },
      { id: 'out-1', label: 'OUT 1', direction: 'output', signalTypes: ['AUDIO'], connector: 'xlr' }
    ]
  };

  it('validates required fields', () => {
    expect(validateCustomDeviceInput({}).valid).toBe(false);
    expect(validateCustomDeviceInput({}).errors.length).toBeGreaterThan(0);
  });

  it('validates port fields', () => {
    const result = validateCustomDeviceInput({
      ...validInput,
      ports: [{ id: '', label: '', direction: 'input' as const, signalTypes: [], connector: 'hdmi' as const }]
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Port 1'))).toBe(true);
  });

  it('accepts valid input', () => {
    const result = validateCustomDeviceInput(validInput);
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  it('builds a valid EquipmentProduct', () => {
    const product = buildCustomDevice(validInput);
    expect(product.id).toContain('custom-');
    expect(product.manufacturer).toBe('TestCo');
    expect(product.model).toBe('Widget-X1');
    expect(product.category).toBe('dsp');
    expect(product.physical.width).toBe(0.48);
    expect(product.ports?.length).toBe(2);
    expect(product.rackUnits).toBe(1);
    expect(product.provenance).toBe('user_defined');
  });

  it('throws on invalid input', () => {
    expect(() => buildCustomDevice({ ...validInput, manufacturer: '' })).toThrow();
  });

  it('built device has correct capabilities', () => {
    const product = buildCustomDevice(validInput);
    const caps = inferCapabilities(product);
    expect(caps.rackMountable).toBe(true);
    expect(caps.forwardsSignal).toBe(true); // has input + output ports, no display/speaker/etc
    expect(caps.displayCoverage).toBe(false);
  });

  it('optional specs are included when provided', () => {
    const product = buildCustomDevice({
      ...validInput,
      powerWatts: 35,
      weightKg: 2.5
    });
    expect(product.physical.powerWatts).toBe(35);
    expect(product.physical.weightKg).toBe(2.5);
  });

  it('generates unique IDs for different builds', () => {
    const p1 = buildCustomDevice(validInput);
    const p2 = buildCustomDevice(validInput);
    expect(p1.id).not.toBe(p2.id);
  });
});
