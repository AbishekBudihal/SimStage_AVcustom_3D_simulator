import { describe, it, expect } from 'vitest';
import { AppState } from '../../src/app/AppState';
import { loadDefaultCatalog } from '../../src/catalog/loadCatalog';
import { generateEngineeringReport, reportToText } from '../../src/docs/EngineeringReport';
import { createDefaultRoom } from '../../src/room/RoomModel';

const catalog = loadDefaultCatalog();

function buildProject(): AppState {
  const state = new AppState();
  state.setRoom(createDefaultRoom('conference'));
  state.project.name = 'Test Conference Room';
  state.project.designer = 'Test Engineer';

  const disp = catalog.get('lg-86uh5j')!;
  state.addEquipment({
    instanceId: 'disp1',
    productId: 'lg-86uh5j',
    name: `${disp.manufacturer} ${disp.model}`,
    position: { x: 0, y: 1.5, z: -3 },
    rotationY: 0
  });

  const src = catalog.get('user-laptop-source')!;
  state.addEquipment({
    instanceId: 'src1',
    productId: 'user-laptop-source',
    name: `${src.manufacturer} ${src.model}`,
    position: { x: -2, y: 1, z: 0 },
    rotationY: 0
  });

  state.addConnection('src1', 'hdmi-out', 'disp1', 'hdmi-in-1');
  return state;
}

describe('Engineering report', () => {
  it('generates report with all sections populated', () => {
    const state = buildProject();
    const report = generateEngineeringReport(state, catalog);

    expect(report.project.name).toBe('Test Conference Room');
    expect(report.project.designer).toBe('Test Engineer');
    expect(report.project.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('includes room dimensions', () => {
    const state = buildProject();
    const report = generateEngineeringReport(state, catalog);

    expect(report.room.width).toBeGreaterThan(0);
    expect(report.room.length).toBeGreaterThan(0);
    expect(report.room.height).toBeGreaterThan(0);
    expect(report.room.useCase).toBe('conference');
  });

  it('includes BOM data', () => {
    const state = buildProject();
    const report = generateEngineeringReport(state, catalog);

    expect(report.bom.totalItems).toBe(2);
    expect(report.bom.totalUniqueProducts).toBe(2);
  });

  it('includes cable data', () => {
    const state = buildProject();
    const report = generateEngineeringReport(state, catalog);

    expect(report.cables.summary.totalConnections).toBe(1);
    expect(report.cables.rows[0].cableId).toBe('C-001');
  });

  it('includes health score', () => {
    const state = buildProject();
    const report = generateEngineeringReport(state, catalog);

    expect(report.health.score).toBeGreaterThanOrEqual(0);
    expect(report.health.score).toBeLessThanOrEqual(100);
    expect(report.health.subsystems.length).toBeGreaterThan(0);
  });

  it('counts equipment and connections', () => {
    const state = buildProject();
    const report = generateEngineeringReport(state, catalog);

    expect(report.equipmentCount).toBe(2);
    expect(report.connectionCount).toBe(1);
  });

  it('generates readable text export', () => {
    const state = buildProject();
    const report = generateEngineeringReport(state, catalog);
    const text = reportToText(report);

    expect(text).toContain('AV ENGINEERING REPORT');
    expect(text).toContain('Test Conference Room');
    expect(text).toContain('BILL OF MATERIALS');
    expect(text).toContain('CABLE SCHEDULE');
    expect(text).toContain('DESIGN HEALTH');
    expect(text.length).toBeGreaterThan(200);
  });

  it('handles empty project gracefully', () => {
    const state = new AppState();
    state.setRoom(createDefaultRoom('conference'));
    const report = generateEngineeringReport(state, catalog);

    expect(report.equipmentCount).toBe(0);
    expect(report.connectionCount).toBe(0);
    expect(report.bom.totalItems).toBe(0);
    expect(report.cables.summary.totalConnections).toBe(0);
  });
});
