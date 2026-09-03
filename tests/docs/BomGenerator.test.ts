import { describe, it, expect } from 'vitest';
import { AppState } from '../../src/app/AppState';
import { loadDefaultCatalog } from '../../src/catalog/loadCatalog';
import { generateBom, bomToCsv } from '../../src/docs/BomGenerator';
import { createDefaultRoom } from '../../src/room/RoomModel';

const catalog = loadDefaultCatalog();

function place(state: AppState, productId: string, instanceId: string): void {
  const p = catalog.get(productId)!;
  state.addEquipment({
    instanceId,
    productId,
    name: `${p.manufacturer} ${p.model}`,
    position: { x: 0, y: 1, z: 0 },
    rotationY: 0
  });
}

describe('BOM generator', () => {
  it('returns empty BOM for empty project', () => {
    const bom = generateBom([], catalog);
    expect(bom.totalItems).toBe(0);
    expect(bom.totalUniqueProducts).toBe(0);
    expect(bom.lines.length).toBe(0);
  });

  it('counts single item correctly', () => {
    const state = new AppState();
    place(state, 'lg-86uh5j', 'disp1');
    const bom = generateBom(state.equipment, catalog);
    expect(bom.totalItems).toBe(1);
    expect(bom.totalUniqueProducts).toBe(1);
    expect(bom.lines[0].quantity).toBe(1);
    expect(bom.lines[0].manufacturer).toBe('LG');
  });

  it('groups multiple instances of same product', () => {
    const state = new AppState();
    place(state, 'lg-86uh5j', 'disp1');
    place(state, 'lg-86uh5j', 'disp2');
    const bom = generateBom(state.equipment, catalog);
    expect(bom.totalItems).toBe(2);
    expect(bom.totalUniqueProducts).toBe(1);
    expect(bom.lines[0].quantity).toBe(2);
    expect(bom.lines[0].equipmentIds).toContain('disp1');
    expect(bom.lines[0].equipmentIds).toContain('disp2');
  });

  it('separates different products into different lines', () => {
    const state = new AppState();
    place(state, 'lg-86uh5j', 'disp');
    place(state, 'yealink-uvc84', 'cam');
    const bom = generateBom(state.equipment, catalog);
    expect(bom.totalItems).toBe(2);
    expect(bom.totalUniqueProducts).toBe(2);
    expect(bom.lines.length).toBe(2);
  });

  it('generates sequential item IDs', () => {
    const state = new AppState();
    place(state, 'lg-86uh5j', 'disp');
    place(state, 'yealink-uvc84', 'cam');
    const bom = generateBom(state.equipment, catalog);
    expect(bom.lines[0].itemId).toBe('B-001');
    expect(bom.lines[1].itemId).toBe('B-002');
  });

  it('detects rack-mounted equipment', () => {
    const state = new AppState();
    state.setRoom(createDefaultRoom('conference'));
    place(state, 'user-hdmi-switcher-2x1', 'sw');
    state.setRacks([{
      id: 'rack-1', kind: 'floor', ruTotal: 42,
      width: 0.6, depth: 0.9, height: 2, x: 0, y: 1, z: 0,
      rotationY: 0, frontClearance: 1, rearClearance: 0.8, ventilation: 'unknown'
    }]);
    state.assignEquipmentToRack('sw', 'rack-1', 1);
    const bom = generateBom(state.equipment, catalog);
    expect(bom.lines[0].rackMounted).toBe(true);
  });

  it('exports valid CSV', () => {
    const state = new AppState();
    place(state, 'lg-86uh5j', 'disp');
    place(state, 'yealink-uvc84', 'cam');
    const bom = generateBom(state.equipment, catalog);
    const csv = bomToCsv(bom);
    const csvLines = csv.split('\n');
    expect(csvLines[0]).toContain('Item,Manufacturer,Model');
    expect(csvLines.length).toBe(3); // header + 2 items
  });

  it('identifies custom devices', () => {
    const state = new AppState();
    place(state, 'user-laptop-source', 'src');
    const bom = generateBom(state.equipment, catalog);
    expect(bom.lines[0].isCustomDevice).toBe(true);
    expect(bom.customDeviceCount).toBe(1);
  });
});
