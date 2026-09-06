import { describe, it, expect } from 'vitest';
import { syncSchematicTo3D } from '../../src/schematic/Schematic3DSync';
import { analyzeSchematic } from '../../src/schematic/SchematicAnalyzer';
import { boardroomSchematic, huddleSchematic } from '../../src/schematic/demoSchematics';
import { loadDefaultCatalog } from '../../src/catalog/loadCatalog';
import { AppState } from '../../src/app/AppState';

const catalog = loadDefaultCatalog();

describe('Schematic3DSync', () => {
  it('synchronizes boardroom schematic into AppState seamlessly', () => {
    const state = new AppState();
    const analyzed = analyzeSchematic(boardroomSchematic(), catalog);

    const result = syncSchematicTo3D(analyzed, state);

    expect(result.equipmentAdded).toBe(9);
    expect(state.equipment.length).toBe(9);
    expect(result.rackCreated).toBe(true);
    expect(state.racks.length).toBeGreaterThanOrEqual(1);
    expect(result.rackAssignments).toBeGreaterThanOrEqual(3); // switcher, dsp, amp
    expect(result.connectionsAdded).toBeGreaterThan(0);
  });

  it('synchronizes huddle schematic without creating racks', () => {
    const state = new AppState();
    const analyzed = analyzeSchematic(huddleSchematic(), catalog);

    const result = syncSchematicTo3D(analyzed, state);

    expect(result.equipmentAdded).toBe(2);
    expect(state.equipment.length).toBe(2);
    expect(result.rackCreated).toBe(false);
    expect(state.racks.length).toBe(0);
    expect(result.connectionsAdded).toBeGreaterThanOrEqual(1);
  });

  it('supports clearExisting option', () => {
    const state = new AppState();
    const analyzedHuddle = analyzeSchematic(huddleSchematic(), catalog);
    syncSchematicTo3D(analyzedHuddle, state);
    expect(state.equipment.length).toBe(2);

    const analyzedBoardroom = analyzeSchematic(boardroomSchematic(), catalog);
    const result = syncSchematicTo3D(analyzedBoardroom, state, { clearExisting: true });

    expect(result.equipmentAdded).toBe(9);
    expect(state.equipment.length).toBe(9);
  });
});
