import { describe, it, expect } from 'vitest';
import { buildCustomDevice, validateCustomDeviceInput, type CustomDeviceInput } from '../../src/catalog/CustomDeviceBuilder';
import { saveUserDevice, loadUserLibrary, clearUserLibrary } from '../../src/catalog/UserLibrary';

describe('Custom device metadata & arbitrary ports', () => {
  it('builds custom device with full engineering metadata', () => {
    const input: CustomDeviceInput = {
      manufacturer: 'Extron',
      model: 'DTP CrossPoint 84',
      partNumber: '60-1371-01',
      productName: '4K Scaling Presentation Matrix Switcher',
      category: 'switcher',
      description: '4K/60 HDMI and DTP matrix switcher with audio DSP and power amp',
      provenance: 'verified',
      source: 'Extron official datasheet',
      datasheetUrl: 'https://example.com/extron-dtp84.pdf',
      modelAsset: 'assets/models/extron_dtp84.glb',
      width: 0.48,
      height: 0.088,
      depth: 0.38,
      weightKg: 6.8,
      power: {
        powerWatts: 65,
        voltage: 120,
        currentAmps: 0.55,
        poeClass: 'PoE+ (30W)'
      },
      rackUnits: 2,
      rackMountable: true,
      ports: [
        {
          id: 'hdmi-in-1',
          label: 'HDMI IN 1',
          direction: 'input',
          signalTypes: ['VIDEO', 'AUDIO'],
          connector: 'hdmi',
          protocol: 'HDMI 2.0 / HDCP 2.2'
        },
        {
          id: 'rs232-ctrl',
          label: 'RS-232 CTRL',
          direction: 'bidirectional',
          signalTypes: ['CONTROL', 'SERIAL'],
          connector: 'dsub9',
          protocol: 'RS-232 115200 baud'
        },
        {
          id: 'sdi-out',
          label: 'SDI OUT',
          direction: 'output',
          signalTypes: ['VIDEO'],
          connector: 'bnc',
          protocol: '12G-SDI'
        },
        {
          id: 'gpio-port',
          label: 'RELAY / GPIO',
          direction: 'bidirectional',
          signalTypes: ['GPIO', 'CONTROL'],
          connector: 'terminal-block'
        }
      ]
    };

    const validation = validateCustomDeviceInput(input);
    expect(validation.valid).toBe(true);

    const product = buildCustomDevice(input);
    expect(product.manufacturer).toBe('Extron');
    expect(product.model).toBe('DTP CrossPoint 84');
    expect(product.partNumber).toBe('60-1371-01');
    expect(product.productName).toBe('4K Scaling Presentation Matrix Switcher');
    expect(product.provenance).toBe('verified');
    expect(product.source).toBe('Extron official datasheet');
    expect(product.modelAsset).toBe('assets/models/extron_dtp84.glb');
    expect(product.power?.powerWatts).toBe(65);
    expect(product.power?.poeClass).toBe('PoE+ (30W)');
    expect(product.rackUnits).toBe(2);
    expect(product.mounting?.rack).toBe(true);
    expect(product.ports?.length).toBe(4);
    expect(product.ports?.[1].connector).toBe('dsub9');
    expect(product.ports?.[1].protocol).toBe('RS-232 115200 baud');
    expect(product.ports?.[2].connector).toBe('bnc');
    expect(product.ports?.[3].connector).toBe('terminal-block');
  });

  it('persists and loads custom device in UserLibrary', () => {
    clearUserLibrary();
    const product = buildCustomDevice({
      manufacturer: 'Shure',
      model: 'IntelliMix P300',
      partNumber: 'P300-IMX',
      category: 'dsp',
      width: 0.22,
      height: 0.044,
      depth: 0.14,
      provenance: 'verified',
      ports: [
        {
          id: 'dante-net',
          label: 'DANTE PRIMARY',
          direction: 'bidirectional',
          signalTypes: ['AUDIO', 'NETWORK'],
          connector: 'rj45',
          protocol: 'Dante'
        }
      ]
    });

    saveUserDevice(product);
    const lib = loadUserLibrary();
    expect(lib.length).toBe(1);
    expect(lib[0].partNumber).toBe('P300-IMX');
    expect(lib[0].ports?.[0].protocol).toBe('Dante');
    clearUserLibrary();
  });
});
