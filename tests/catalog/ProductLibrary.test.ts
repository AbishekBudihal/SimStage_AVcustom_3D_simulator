import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadLibrary,
  saveProductToLibrary,
  deleteProductFromLibrary,
  exportLibrary,
  importLibrary,
  clearLibrary,
  resetLibraryMemoryStore,
  getAllStoredProducts
} from '../../src/catalog/ProductLibrary';
import {
  loadUserLibrary,
  saveUserDevice,
  deleteUserDevice,
  exportUserLibrary,
  importUserLibrary,
  clearUserLibrary
} from '../../src/catalog/UserLibrary';
import { EquipmentCatalog, type EquipmentProduct } from '../../src/catalog/EquipmentCatalog';
import { buildCustomDevice } from '../../src/catalog/CustomDeviceBuilder';
import { generateBom } from '../../src/docs/BomGenerator';

describe('ProductLibrary (§14 Product Library Structure)', () => {
  beforeEach(() => {
    resetLibraryMemoryStore();
    clearLibrary('company');
    clearLibrary('user');
  });

  const sampleCompanyDisplay: EquipmentProduct = {
    id: 'corp-disp-85',
    manufacturer: 'CorporateAV',
    model: 'Enterprise 85',
    category: 'display',
    type: 'display',
    libraryTier: 'company',
    provenance: 'verified',
    physical: { width: 1.9, height: 1.1, depth: 0.08, weightKg: 45 },
    display: {
      diagonalInches: 85,
      resolution: '3840x2160',
      aspectRatio: '16:9',
      brightnessNits: 500
    },
    ports: [
      { id: 'hdmi-1', label: 'HDMI IN', direction: 'input', signalTypes: ['VIDEO'], connector: 'hdmi' }
    ]
  };

  const sampleUserCamera: EquipmentProduct = {
    id: 'user-cam-4k',
    manufacturer: 'PrototypeLab',
    model: 'PTZ-4K-Custom',
    category: 'camera',
    type: 'camera',
    libraryTier: 'user',
    provenance: 'user_defined',
    physical: { width: 0.2, height: 0.22, depth: 0.18 },
    camera: {
      mount: 'wall',
      horizontalFovDeg: 84,
      verticalFovDeg: 54
    },
    ports: [
      { id: 'lan', label: 'LAN / PoE', direction: 'bidirectional', signalTypes: ['NETWORK', 'POWER', 'VIDEO'], connector: 'rj45' }
    ]
  };

  it('maintains strict isolation between Company and User library tiers', () => {
    saveProductToLibrary(sampleCompanyDisplay, 'company');
    saveProductToLibrary(sampleUserCamera, 'user');

    const companyProducts = loadLibrary('company');
    const userProducts = loadLibrary('user');

    expect(companyProducts.length).toBe(1);
    expect(companyProducts[0].id).toBe('corp-disp-85');
    expect(companyProducts[0].libraryTier).toBe('company');

    expect(userProducts.length).toBe(1);
    expect(userProducts[0].id).toBe('user-cam-4k');
    expect(userProducts[0].libraryTier).toBe('user');

    const allStored = getAllStoredProducts();
    expect(allStored.length).toBe(2);
  });

  it('prevents direct overwrite of system library products', () => {
    expect(() => {
      saveProductToLibrary(sampleCompanyDisplay, 'system');
    }).toThrow(/System Library products are curated/);

    expect(() => {
      importLibrary('[]', 'system');
    }).toThrow(/Cannot import directly into System Library/);
  });

  it('updates an existing product when ID matches within the same tier', () => {
    saveProductToLibrary(sampleCompanyDisplay, 'company');

    const updated: EquipmentProduct = {
      ...sampleCompanyDisplay,
      model: 'Enterprise 85 Gen2'
    };
    saveProductToLibrary(updated, 'company');

    const list = loadLibrary('company');
    expect(list.length).toBe(1);
    expect(list[0].model).toBe('Enterprise 85 Gen2');
  });

  it('deletes devices from a specific library tier', () => {
    saveProductToLibrary(sampleCompanyDisplay, 'company');
    expect(loadLibrary('company').length).toBe(1);

    deleteProductFromLibrary('corp-disp-85', 'company');
    expect(loadLibrary('company').length).toBe(0);
  });

  it('exports and imports library packages with duplicate handling', () => {
    saveProductToLibrary(sampleCompanyDisplay, 'company');
    const exportedJson = exportLibrary('company');
    expect(exportedJson).toContain('corp-disp-85');
    expect(exportedJson).toContain('CorporateAV');

    clearLibrary('company');
    expect(loadLibrary('company').length).toBe(0);

    const imported = importLibrary(exportedJson, 'company');
    expect(imported.length).toBe(1);
    expect(imported[0].id).toBe('corp-disp-85');
    expect(loadLibrary('company').length).toBe(1);
  });

  it('registers products in EquipmentCatalog with tier assignment and queries by tier', () => {
    const catalog = new EquipmentCatalog();

    const systemProducts: EquipmentProduct[] = [
      {
        id: 'sys-mic-01',
        manufacturer: 'Shure',
        model: 'MXA910',
        category: 'microphone',
        type: 'microphone',
        provenance: 'verified',
        physical: { width: 0.6, height: 0.05, depth: 0.6 },
        microphone: {
          mount: 'ceiling',
          pickupRadiusM: 4.5,
          pattern: 'steerable',
          channels: 8,
          connection: 'rj45'
        }
      }
    ];

    catalog.register(systemProducts); // default should be 'system'
    catalog.register([sampleCompanyDisplay], 'company');
    catalog.register([sampleUserCamera], 'user');

    expect(catalog.byTier('system').length).toBe(1);
    expect(catalog.byTier('company').length).toBe(1);
    expect(catalog.byTier('user').length).toBe(1);

    const counts = catalog.tierCounts();
    expect(counts).toEqual({
      system: 1,
      company: 1,
      user: 1
    });

    const companyOnlySearch = catalog.search({ tier: 'company' });
    expect(companyOnlySearch.length).toBe(1);
    expect(companyOnlySearch[0].id).toBe('corp-disp-85');

    const userOnlySearch = catalog.search({ tier: 'user' });
    expect(userOnlySearch.length).toBe(1);
    expect(userOnlySearch[0].id).toBe('user-cam-4k');
  });

  it('ensures custom devices from all tiers work seamlessly in BOM generation', () => {
    const customSpeaker = buildCustomDevice({
      category: 'speaker',
      manufacturer: 'OrgAudio',
      model: 'Ceiling-70V',
      libraryTier: 'company',
      width: 0.25,
      height: 0.25,
      depth: 0.2,
      speaker: {
        coverageAngleDeg: 120,
        maxSplAt1m: 102
      }
    });

    expect(customSpeaker.libraryTier).toBe('company');
    saveProductToLibrary(customSpeaker, 'company');

    const catalog = new EquipmentCatalog();
    catalog.register([customSpeaker], 'company');

    const instances = [
      {
        instanceId: 'eq-inst-1',
        productId: customSpeaker.id,
        name: 'Ceiling Speaker 1',
        position: { x: 2, y: 2.8, z: 2 },
        rotationY: 0
      }
    ];

    const bom = generateBom(instances as any, catalog);

    expect(bom.lines.length).toBe(1);
    expect(bom.lines[0].manufacturer).toBe('OrgAudio');
    expect(bom.lines[0].model).toBe('Ceiling-70V');
    expect(bom.totalItems).toBe(1);
    expect(bom.customDeviceCount).toBe(1);
  });

  it('provides 100% backward compatibility via UserLibrary facade', () => {
    saveUserDevice(sampleUserCamera);
    const userDevices = loadUserLibrary();
    expect(userDevices.length).toBe(1);
    expect(userDevices[0].id).toBe('user-cam-4k');

    const exported = exportUserLibrary();
    expect(exported).toContain('user-cam-4k');

    clearUserLibrary();
    expect(loadUserLibrary().length).toBe(0);

    const imported = importUserLibrary(exported);
    expect(imported.length).toBe(1);
    expect(loadUserLibrary().length).toBe(1);

    deleteUserDevice('user-cam-4k');
    expect(loadUserLibrary().length).toBe(0);
  });
});
