import { describe, it, expect } from 'vitest';
import {
  inferCapabilities,
  hasCapability,
  hasAnyCapability,
  hasAllCapabilities,
  getDisplayCapability,
  getCameraCapability,
  getMicrophoneCapability,
  getSpeakerCapability,
  getRackCapability,
  getPowerCapability,
  getConnectivityCapability,
  getMountingCapability,
  capabilityLabels
} from '../../src/catalog/DeviceCapabilities';
import { loadDefaultCatalog } from '../../src/catalog/loadCatalog';
import type { EquipmentProduct } from '../../src/catalog/EquipmentCatalog';
import { evaluateRackRequirement } from '../../src/av/RackRequirement';
import { resolveActiveDisplay } from '../../src/av/DesignAnalysis';

describe('Phase 2 — Capability-Based Engineering Model (§13)', () => {
  const catalog = loadDefaultCatalog();

  it('correctly extracts display capability with viewing bounds', () => {
    const product = catalog.get('samsung-qm85r')!;
    const display = getDisplayCapability(product);

    expect(display).not.toBeNull();
    expect(display!.diagonalInches).toBe(85);
    expect(display!.aspectRatio).toBe('16:9');
    expect(hasCapability(catalog, 'samsung-qm85r', 'hasDisplay')).toBe(true);
    expect(hasCapability(catalog, 'samsung-qm85r', 'displayCoverage')).toBe(true);
  });

  it('correctly extracts camera capability with FOV and mount specs', () => {
    const product = catalog.get('yealink-uvc84')!;
    const camera = getCameraCapability(product);

    expect(camera).not.toBeNull();
    expect(camera!.horizontalFovDeg).toBe(81.9);
    expect(hasCapability(catalog, 'yealink-uvc84', 'hasCamera')).toBe(true);
    expect(hasCapability(catalog, 'yealink-uvc84', 'cameraCoverage')).toBe(true);
  });

  it('correctly extracts microphone capability with pickup radius', () => {
    const product = catalog.get('shure-mxa920')!;
    const mic = getMicrophoneCapability(product);

    expect(mic).not.toBeNull();
    expect(mic!.pickupRadiusM).toBeGreaterThan(0);
    expect(hasCapability(catalog, 'shure-mxa920', 'hasMicrophone')).toBe(true);
    expect(hasCapability(catalog, 'shure-mxa920', 'micCoverage')).toBe(true);
  });

  it('correctly extracts speaker capability with dispersion and power class', () => {
    const product = catalog.get('jbl-control26ct')!;
    const spk = getSpeakerCapability(product);

    expect(spk).not.toBeNull();
    expect(spk!.dispersionDeg).toBe(110);
    expect(spk!.mount).toBe('ceiling');
    expect(hasCapability(catalog, 'jbl-control26ct', 'hasSpeaker')).toBe(true);
    expect(hasCapability(catalog, 'jbl-control26ct', 'speakerCoverage')).toBe(true);
  });

  it('correctly extracts rack capability for centralized rack equipment', () => {
    const product = catalog.get('biamp-tesiraforte-vt4')!;
    const rack = getRackCapability(product);

    expect(rack).not.toBeNull();
    expect(rack!.rackMountable).toBe(true);
    expect(rack!.rackUnits).toBe(1);
    expect(hasCapability(catalog, 'biamp-tesiraforte-vt4', 'hasRack')).toBe(true);
    expect(hasCapability(catalog, 'biamp-tesiraforte-vt4', 'rackMountable')).toBe(true);
  });

  it('correctly extracts power and connectivity capabilities', () => {
    const product = catalog.get('biamp-tesiraforte-vt4')!;
    const conn = getConnectivityCapability(product);
    expect(conn).not.toBeNull();
    expect(conn!.forwardsSignal).toBe(true);

    // When power is declared, power capability is present
    const poweredDevice: EquipmentProduct = {
      ...product,
      id: 'biamp-with-power',
      power: { powerWatts: 45, poeClass: 'None' }
    };
    const power = getPowerCapability(poweredDevice);
    expect(power).not.toBeNull();
    expect(power!.powerWatts).toBe(45);
  });

  it('handles multi-function composite devices (All-in-one Video Soundbar)', () => {
    const videobar: EquipmentProduct = {
      id: 'poly-studio-x50',
      manufacturer: 'Poly',
      model: 'Studio X50',
      category: 'codec',
      type: 'videobar',
      physical: { width: 0.762, height: 0.102, depth: 0.102, powerWatts: 65 },
      camera: { mount: 'wall', horizontalFovDeg: 120, verticalFovDeg: 80, tracking: true },
      microphone: { mount: 'wall', pickupRadiusM: 4.5, pattern: 'beamforming', channels: 3, connection: 'integrated' },
      speaker: { mount: 'wall', dispersionDeg: 90, powerClass: 'active' },
      mounting: { wall: true, table: true, floor: false, ceiling: false, rack: false },
      ports: [
        { id: 'hdmi-out', label: 'HDMI OUT', direction: 'output', signalTypes: ['VIDEO'], connector: 'hdmi' },
        { id: 'lan', label: 'NETWORK', direction: 'bidirectional', signalTypes: ['NETWORK'], connector: 'rj45' }
      ],
      provenance: 'user_defined'
    };

    const caps = inferCapabilities(videobar);

    // Composite multi-function capability verification
    expect(caps.hasCamera).toBe(true);
    expect(caps.hasMicrophone).toBe(true);
    expect(caps.hasSpeaker).toBe(true);
    expect(caps.hasConnectivity).toBe(true);
    expect(caps.hasDisplay).toBe(false);
    expect(caps.hasRack).toBe(false);

    // Coverage types
    expect(caps.coverage?.kinds).toContain('camera');
    expect(caps.coverage?.kinds).toContain('microphone');
    expect(caps.coverage?.kinds).toContain('speaker');
    expect(caps.coverage?.kinds).not.toContain('display');

    // Label formatting
    const labels = capabilityLabels(videobar);
    expect(labels).toContain('Camera Coverage');
    expect(labels).toContain('Microphone Coverage');
    expect(labels).toContain('Speaker Coverage');
  });

  it('hasAnyCapability and hasAllCapabilities match correctly', () => {
    expect(hasAnyCapability(catalog, 'shure-mxa920', ['hasMicrophone', 'hasSpeaker'])).toBe(true);
    expect(hasAllCapabilities(catalog, 'shure-mxa920', ['hasMicrophone', 'hasSpeaker'])).toBe(false);
    expect(hasAllCapabilities(catalog, 'shure-mxa920', ['hasMicrophone', 'hasMounting'])).toBe(true);
  });

  it('integrates seamlessly with evaluateRackRequirement', () => {
    const rackEquip = [
      {
        instanceId: 'inst-dsp',
        productId: 'biamp-tesiraforte-vt4',
        name: 'Biamp DSP',
        position: { x: 0, y: 0, z: 0 },
        rotationY: 0,
        placementMode: 'smart' as const,
        origin: 'auto' as const
      }
    ];
    const evalResult = evaluateRackRequirement(rackEquip, catalog);
    expect(evalResult.required).toBe(true);
    expect(evalResult.totalRU).toBe(1);
    expect(evalResult.rackDeviceCount).toBe(1);
  });

  it('integrates seamlessly with resolveActiveDisplay', () => {
    const displayEquip = [
      {
        instanceId: 'inst-disp',
        productId: 'samsung-qm85r',
        name: 'Main Display',
        position: { x: 0, y: 1.5, z: -3 },
        rotationY: 0,
        wall: 'front' as const,
        placementMode: 'smart' as const,
        origin: 'auto' as const
      }
    ];
    const active = resolveActiveDisplay(displayEquip, catalog);
    expect(active.kind).toBe('ok');
    if (active.kind === 'ok') {
      expect(active.placement.diagonalInches).toBe(85);
    }
  });
});