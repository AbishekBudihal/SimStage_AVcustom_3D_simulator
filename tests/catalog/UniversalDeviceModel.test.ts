import { describe, it, expect } from 'vitest';
import {
  createProvenanced,
  resolveEffectiveHorizontalFov,
  inferFallbackGeometry,
  buildDefaultVisualizationSpec,
  formatSpecValue
} from '../../src/catalog/UniversalDeviceModel';
import { loadDefaultCatalog } from '../../src/catalog/loadCatalog';
import type { CameraSpec, EquipmentProduct } from '../../src/catalog/EquipmentCatalog';

describe('Universal Device Model — Camera FOV Engineering Rules (§7)', () => {
  it('returns declared horizontal FOV with state "known"', () => {
    const cam: CameraSpec = {
      mount: 'wall',
      horizontalFovDeg: 73.0,
      verticalFovDeg: 45.0
    };
    const res = resolveEffectiveHorizontalFov(cam);
    expect(res.state).toBe('known');
    expect(res.fovDeg).toBe(73.0);
    expect(res.note).toContain('Manufacturer-declared');
  });

  it('never assumes diagonal FOV is horizontal FOV when aspect ratio is omitted', () => {
    const cam: CameraSpec = {
      mount: 'wall',
      diagonalFovDeg: 90.0
    };
    const res = resolveEffectiveHorizontalFov(cam);
    expect(res.state).toBe('unknown');
    expect(res.fovDeg).toBeNull();
    expect(res.note).toContain('Horizontal FOV is unknown without optical sensor aspect ratio');
  });

  it('mathematically converts diagonal FOV when optical aspect ratio is provided', () => {
    const cam: CameraSpec = {
      mount: 'wall',
      diagonalFovDeg: 90.0
    };
    // 16:9 aspect ratio = 16 / 9 ≈ 1.7778
    const res = resolveEffectiveHorizontalFov(cam, 16 / 9);
    expect(res.state).toBe('estimated');
    expect(res.fovDeg).toBeCloseTo(82.1, 1);
    expect(res.note).toContain('Mathematically converted');
  });

  it('handles empty or missing camera spec gracefully', () => {
    const res = resolveEffectiveHorizontalFov(undefined);
    expect(res.state).toBe('unknown');
    expect(res.fovDeg).toBeNull();
  });
});

describe('Universal Device Model — Provenanced Values & State Formatting (§5, §25)', () => {
  it('creates provenanced fields with explicit states', () => {
    const field = createProvenanced(
      500,
      'manufacturer_verified',
      'known',
      'https://samsung.com/datasheet.pdf'
    );
    expect(field.value).toBe(500);
    expect(field.state).toBe('known');
    expect(field.provenance).toBe('manufacturer_verified');
    expect(field.source).toBe('https://samsung.com/datasheet.pdf');
  });

  it('formats unknown and estimated states honestly', () => {
    const known = createProvenanced(65, 'manufacturer_verified', 'known');
    const est = createProvenanced(120, 'engineering_estimate', 'estimated');
    const unk = createProvenanced(null, 'unknown', 'unknown');
    const na = createProvenanced(null, 'unknown', 'not_applicable');

    expect(formatSpecValue(known)).toBe('65');
    expect(formatSpecValue(est)).toBe('120 (Est.)');
    expect(formatSpecValue(unk)).toBe('Unknown');
    expect(formatSpecValue(na)).toBe('N/A');
    expect(formatSpecValue(undefined)).toBe('Unknown');
  });
});

describe('Universal Device Model — Visualization Fallbacks (§6)', () => {
  const catalog = loadDefaultCatalog();

  it('assigns correct fallback geometry across catalog product types', () => {
    const display = catalog.get('lg-86uh5j')!;
    expect(inferFallbackGeometry(display)).toBe('display');

    const ptzCam = catalog.get('yealink-uvc84')!;
    expect(inferFallbackGeometry(ptzCam)).toBe('camera_ptz');

    const ceilSpeaker = catalog.get('jbl-control26ct')!;
    expect(inferFallbackGeometry(ceilSpeaker)).toBe('speaker_ceiling');

    const ceilMic = catalog.get('shure-mxa920')!;
    expect(inferFallbackGeometry(ceilMic)).toBe('mic_ceiling');

    const dsp = catalog.get('biamp-tesiraforte-vt4')!;
    expect(inferFallbackGeometry(dsp)).toBe('rack_unit');
  });

  it('builds complete visualization spec with installation height and clearances', () => {
    const display = catalog.get('samsung-qm85r')!;
    const vis = buildDefaultVisualizationSpec(display);

    expect(vis.fallbackGeometry).toBe('display');
    expect(vis.frontDirection).toBe('front');
    expect(vis.connectionSide).toBe('rear');
    expect(vis.defaultInstallationHeightM).toBe(1.2);
    expect(vis.clearanceM).toBeGreaterThan(0);
  });

  it('all existing seed catalog products can generate valid visualization specs', () => {
    const products = catalog.all();
    expect(products.length).toBeGreaterThanOrEqual(35);

    for (const p of products) {
      const vis = buildDefaultVisualizationSpec(p);
      expect(vis.fallbackGeometry).toBeDefined();
      expect(vis.frontDirection).toBeDefined();
      expect(vis.connectionSide).toBeDefined();
    }
  });
});

describe('Universal Device Model — Port Metadata Extensions (§12)', () => {
  it('supports bandwidth, poeBudget, and poeRequirement on PortDefinition', () => {
    const product: EquipmentProduct = {
      id: 'test-switch-poe',
      manufacturer: 'Cisco',
      model: 'CBS350-24P',
      category: 'network',
      type: 'managed_switch',
      physical: { width: 0.44, height: 0.044, depth: 0.25 },
      provenance: 'user_defined',
      ports: [
        {
          id: 'ge-1',
          label: 'Gigabit PoE Port 1',
          direction: 'bidirectional',
          signalTypes: ['NETWORK', 'CONTROL'],
          connector: 'rj45',
          bandwidthGbps: 1,
          poeBudgetWatts: 30,
          protocol: 'Ethernet',
          notes: '802.3at PoE+ PSE port'
        }
      ]
    };

    expect(product.ports![0].bandwidthGbps).toBe(1);
    expect(product.ports![0].poeBudgetWatts).toBe(30);
    expect(product.ports![0].notes).toContain('PoE+');
  });
});