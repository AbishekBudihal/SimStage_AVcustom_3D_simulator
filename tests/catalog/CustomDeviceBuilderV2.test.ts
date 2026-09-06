import { describe, it, expect } from 'vitest';
import {
  buildCustomDevice,
  validateCustomDeviceInput,
  getDeviceTypeDefaults,
  type CustomDeviceInput
} from '../../src/catalog/CustomDeviceBuilder';
import { inferCapabilities } from '../../src/catalog/DeviceCapabilities';

describe('Phase 3 — Custom Device Builder (§4, §15)', () => {
  it('provides purpose-driven smart defaults for major device types', () => {
    const displayDefaults = getDeviceTypeDefaults('display');
    expect(displayDefaults.category).toBe('display');
    expect(displayDefaults.display?.diagonalInches).toBe(55);
    expect(displayDefaults.mounting?.wall).toBe(true);
    expect(displayDefaults.ports?.length).toBeGreaterThanOrEqual(2);

    const cameraDefaults = getDeviceTypeDefaults('camera');
    expect(cameraDefaults.category).toBe('camera');
    expect(cameraDefaults.camera?.horizontalFovDeg).toBe(80);
    expect(cameraDefaults.camera?.ptz).toBe(true);

    const dspDefaults = getDeviceTypeDefaults('dsp');
    expect(dspDefaults.category).toBe('dsp');
    expect(dspDefaults.rackUnits).toBe(1);
    expect(dspDefaults.rackMountable).toBe(true);
    expect(dspDefaults.signalForwarding).toContain('AUDIO');

    const switchDefaults = getDeviceTypeDefaults('network_switch');
    expect(switchDefaults.category).toBe('network');
    expect(switchDefaults.ports?.[0].poeBudgetWatts).toBe(30);
  });

  it('builds valid EquipmentProduct with universal visualization & metadata', () => {
    const input: CustomDeviceInput = {
      manufacturer: 'Shure',
      model: 'Custom Stem Wall',
      category: 'microphone',
      width: 1.2,
      height: 0.08,
      depth: 0.09,
      weightKg: 3.5,
      powerWatts: 15,
      libraryTier: 'user',
      sku: 'STEM-WALL-1',
      microphone: {
        mount: 'wall',
        pickupRadiusM: 4.5,
        pattern: 'beamforming',
        channels: 15,
        connection: 'rj45',
        coverageModel: 'directional_sector',
        beamWidthDeg: 120
      },
      speaker: {
        mount: 'wall',
        dispersionDeg: 90,
        maxSplAt1m: 98,
        powerClass: 'active'
      },
      ports: [
        {
          id: 'dante-poe',
          label: 'Dante / PoE+ IN',
          direction: 'bidirectional',
          signalTypes: ['DANTE', 'NETWORK', 'AUDIO'],
          connector: 'rj45',
          protocol: 'Dante',
          poeRequirementWatts: 15,
          notes: 'Requires 802.3at PoE+'
        }
      ]
    };

    const product = buildCustomDevice(input);

    expect(product.id).toContain('custom-shure-custom-stem-wall');
    expect(product.libraryTier).toBe('user');
    expect(product.sku).toBe('STEM-WALL-1');
    expect(product.visualization).toBeDefined();
    expect(product.visualization?.fallbackGeometry).toBe('mic_table');
    expect(product.ports![0].poeRequirementWatts).toBe(15);
    expect(product.ports![0].protocol).toBe('Dante');

    // Capabilities inference on custom device
    const caps = inferCapabilities(product);
    expect(caps.hasMicrophone).toBe(true);
    expect(caps.hasSpeaker).toBe(true);
    expect(caps.hasConnectivity).toBe(true);
  });

  it('builds custom camera preserving diagonal FOV and optics', () => {
    const input: CustomDeviceInput = {
      manufacturer: 'Logitech',
      model: 'Custom MeetUp Cam',
      category: 'camera',
      width: 0.4,
      height: 0.1,
      depth: 0.08,
      camera: {
        mount: 'wall',
        horizontalFovDeg: 113,
        verticalFovDeg: 80,
        diagonalFovDeg: 120,
        ptz: true,
        panRangeDeg: 25,
        tiltRangeDeg: 15,
        tracking: true
      }
    };

    const product = buildCustomDevice(input);
    expect(product.camera?.diagonalFovDeg).toBe(120);
    expect(product.camera?.horizontalFovDeg).toBe(113);
    expect(product.camera?.tracking).toBe(true);
  });

  it('validates custom device input properly and catches errors', () => {
    const invalidInput: Partial<CustomDeviceInput> = {
      manufacturer: '',
      model: '',
      width: -1,
      height: 0
    };

    const validation = validateCustomDeviceInput(invalidInput);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((e) => e.includes('Manufacturer'))).toBe(true);
    expect(validation.errors.some((e) => e.includes('Model'))).toBe(true);
    expect(validation.errors.some((e) => e.includes('Category'))).toBe(true);
    expect(validation.errors.some((e) => e.includes('Width'))).toBe(true);
  });
});