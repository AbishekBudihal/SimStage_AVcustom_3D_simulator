import { describe, it, expect, beforeEach } from 'vitest';
import { AppState, catalog } from '../../src/app/AppState';
import { createDefaultRoom } from '../../src/room/RoomModel';
import { bomToCsv, bomToJson } from '../../src/docs/BomGenerator';
import { reportToText, reportToMarkdown, reportToJson } from '../../src/docs/EngineeringReport';
import { cableScheduleToCsv } from '../../src/system/CableSchedule';
import type { EquipmentInstance, EquipmentProduct } from '../../src/catalog/EquipmentCatalog';

describe('Phase 12: Documentation Synchronization', () => {
  let state: AppState;

  beforeEach(() => {
    state = new AppState();
    const room = createDefaultRoom('boardroom');
    room.templateId = 'boardroom';
    room.ceilingType = 'acoustic_grid_2x2';
    room.lightingStyle = 'linear_pendants';
    room.flooringType = 'corporate_carpet_tile';
    room.wallStyle = 'wood_paneling';
    room.furnitureStyle = 'executive_wood';
    state.setRoom(room);
  });

  it('generates authoritative BOM deterministically from AppState equipment, racks, and cables', () => {
    const dispProduct = catalog.byCategory('display')[0];
    const micProduct = catalog.byCategory('microphone')[0];

    const dispInstance: EquipmentInstance = {
      instanceId: 'disp-1',
      productId: dispProduct.id,
      name: 'Main Display',
      position: { x: 5, y: 1.8, z: 0.1 },
      rotationY: 0
    };

    const micInstance: EquipmentInstance = {
      instanceId: 'mic-1',
      productId: micProduct.id,
      name: 'Ceiling Mic',
      position: { x: 5, y: 3.0, z: 3.5 },
      rotationY: 0
    };

    state.addEquipment(dispInstance);
    state.addEquipment(micInstance);

    const bom1 = state.getBom();
    expect(bom1.lines.length).toBe(2);
    expect(bom1.totalItems).toBe(2);
    expect(bom1.lines[0].lineKind).toBe('equipment');
    expect(bom1.lines[0].provenance).toBeDefined();

    // Adding a rack enclosure enriches the BOM with a rack item
    state.addRack({
      id: 'rack-1',
      kind: 'floor',
      x: 1,
      y: 0,
      z: 1,
      width: 0.6,
      depth: 0.8,
      height: 1.2,
      ruTotal: 24,
      rotationY: 0,
      frontClearance: 1,
      rearClearance: 0.8,
      ventilation: 'standard'
    });

    const bom2 = state.getBom();
    expect(bom2.rackCount).toBe(1);
    const rackLine = bom2.lines.find((l) => l.lineKind === 'rack');
    expect(rackLine).toBeDefined();
    expect(rackLine?.model).toContain('24RU Floor Rack');
  });

  it('synchronizes rack-mounted flags and power totals in BOM when equipment is assigned to rack', () => {
    const dspProduct = catalog.byCategory('dsp')[0] || catalog.byCategory('amplifier')[0] || catalog.all()[0];
    const dspInstance: EquipmentInstance = {
      instanceId: 'dsp-1',
      productId: dspProduct.id,
      name: 'Core Processor',
      position: { x: 1, y: 0.5, z: 1 },
      rotationY: 0
    };

    state.addRack({
      id: 'rack-1',
      kind: 'floor',
      x: 1,
      y: 0,
      z: 1,
      width: 0.6,
      depth: 0.8,
      height: 1.2,
      ruTotal: 24,
      rotationY: 0,
      frontClearance: 1,
      rearClearance: 0.8,
      ventilation: 'standard'
    });

    state.addEquipment(dspInstance);
    state.assignEquipmentToRack('dsp-1', 'rack-1');

    const bom = state.getBom();
    const dspLine = bom.lines.find((l) => l.productId === dspProduct.id);
    expect(dspLine).toBeDefined();
    expect(dspLine?.rackMounted).toBe(true);
    expect(bom.totalPowerWatts).toBeGreaterThanOrEqual(0);
  });

  it('aggregates structured cabling infrastructure in BOM when connections exist', () => {
    const disp = catalog.byCategory('display')[0];
    const camera = catalog.byCategory('camera')[0];

    state.addEquipment({
      instanceId: 'dev-disp',
      productId: disp.id,
      name: 'Display',
      position: { x: 5, y: 1.8, z: 0.2 },
      rotationY: 0
    });

    state.addEquipment({
      instanceId: 'dev-cam',
      productId: camera.id,
      name: 'Camera',
      position: { x: 5, y: 2.2, z: 0.2 },
      rotationY: 0
    });

    state.addConnection({
      id: 'conn-1',
      fromInstanceId: 'dev-cam',
      fromPortId: 'hdmi-out-1',
      toInstanceId: 'dev-disp',
      toPortId: 'hdmi-in-1',
      signalType: 'VIDEO',
      transport: 'hdmi',
      physicalMedium: 'HDMI'
    });

    const bom = state.getBom();
    const cableLine = bom.lines.find((l) => l.lineKind === 'cable');
    expect(cableLine).toBeDefined();
    expect(cableLine?.manufacturer).toBe('Structured Cabling');
    expect(bom.totalCableLengthM).toBeGreaterThan(0);
  });

  it('exports BOM to CSV and JSON formats faithfully including part numbers and custom items', () => {
    // Register a product with explicit part number and custom provenance
    const customProd: EquipmentProduct = {
      id: 'custom-switch-48',
      manufacturer: 'NetCorp',
      model: 'NC-48-POE',
      type: 'Network Switch',
      category: 'switcher',
      provenance: 'user_defined',
      partNumber: 'SKU-NC48-POE',
      power: { powerWatts: 150 },
      physical: { width: 0.44, height: 0.044, depth: 0.35, weightKg: 4.5, powerWatts: 150 }
    };
    catalog.register([customProd], 'user');

    state.addEquipment({
      instanceId: 'sw-1',
      productId: customProd.id,
      name: 'Core Switch',
      position: { x: 1, y: 0.5, z: 1 },
      rotationY: 0
    });

    const bom = state.getBom();
    const line = bom.lines.find((l) => l.productId === customProd.id)!;
    expect(line).toBeDefined();
    expect(line.partNumber).toBe('SKU-NC48-POE');
    expect(line.isCustomDevice).toBe(true);

    const csv = bomToCsv(bom);
    expect(csv).toContain('Item,Manufacturer,Model,Part Number,Category,Kind,Description,Qty,Power (W),Rack Mounted,Custom Device');
    expect(csv).toContain('SKU-NC48-POE');
    expect(csv).toContain('NetCorp');
    expect(csv).toContain('equipment');

    const jsonStr = bomToJson(bom);
    const parsed = JSON.parse(jsonStr);
    expect(parsed.totalItems).toBe(bom.totalItems);
    expect(parsed.lines).toHaveLength(bom.lines.length);
    const parsedLine = parsed.lines.find((l: any) => l.productId === customProd.id);
    expect(parsedLine.partNumber).toBe('SKU-NC48-POE');
  });

  it('generates comprehensive EngineeringReport aggregating room finishes, power, health, and cabling', () => {
    const disp = catalog.byCategory('display')[0];
    state.addEquipment({
      instanceId: 'disp-1',
      productId: disp.id,
      name: 'Front Display',
      position: { x: 5, y: 1.8, z: 0.1 },
      rotationY: 0
    });

    const report = state.getEngineeringReport();

    // Architectural environment
    expect(report.room.templateId).toBe('boardroom');
    expect(report.room.ceilingType).toBe('acoustic_grid_2x2');
    expect(report.room.lightingStyle).toBe('linear_pendants');
    expect(report.room.flooringType).toBe('corporate_carpet_tile');
    expect(report.room.wallStyle).toBe('wood_paneling');
    expect(report.room.furnitureStyle).toBe('executive_wood');

    // Power summary
    expect(report.power).toBeDefined();
    expect(typeof report.power.totalWatts).toBe('number');
    expect(typeof report.power.poeWatts).toBe('number');

    // Health
    expect(report.health.score).toBeGreaterThanOrEqual(0);
    expect(report.health.score).toBeLessThanOrEqual(100);

    // Text export contains key sections
    const txt = reportToText(report);
    expect(txt).toContain('AV ENGINEERING REPORT');
    expect(txt).toContain('ROOM & ARCHITECTURAL ENVIRONMENT');
    expect(txt).toContain('Ceiling: acoustic_grid_2x2');
    expect(txt).toContain('POWER BUDGET');
    expect(txt).toContain('BILL OF MATERIALS');

    // Markdown export contains headers and markdown tables
    const md = reportToMarkdown(report);
    expect(md).toContain('# Engineering Report:');
    expect(md).toContain('## Room & Architectural Environment');
    expect(md).toContain('`acoustic_grid_2x2`');
    expect(md).toContain('## Design Health Score:');
    expect(md).toContain('## Bill of Materials (BOM)');
    expect(md).toContain('| Item | Part Number | Manufacturer | Model | Category | Kind | Qty | Power | Rack |');
    expect(md).toContain('## Cable Schedule');

    // JSON export is strictly parseable
    const jsonStr = reportToJson(report);
    const parsed = JSON.parse(jsonStr);
    expect(parsed.project.name).toBe(report.project.name);
    expect(parsed.room.ceilingType).toBe('acoustic_grid_2x2');
    expect(parsed.power.totalWatts).toBe(report.power.totalWatts);
  });

  it('updates documentation reactively when equipment is removed', () => {
    const disp = catalog.byCategory('display')[0];
    state.addEquipment({
      instanceId: 'disp-1',
      productId: disp.id,
      name: 'Front Display',
      position: { x: 5, y: 1.8, z: 0.1 },
      rotationY: 0
    });

    expect(state.getBom().totalItems).toBe(1);
    expect(state.getEngineeringReport().equipmentCount).toBe(1);

    state.removeEquipment('disp-1');

    expect(state.getBom().totalItems).toBe(0);
    expect(state.getEngineeringReport().equipmentCount).toBe(0);
  });
});
