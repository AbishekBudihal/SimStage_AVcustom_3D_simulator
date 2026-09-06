import { describe, it, expect } from 'vitest';
import { analyzeSchematic } from '../../src/schematic/SchematicAnalyzer';
import { boardroomSchematic, huddleSchematic } from '../../src/schematic/demoSchematics';
import { loadDefaultCatalog } from '../../src/catalog/loadCatalog';

const catalog = loadDefaultCatalog();

describe('SchematicAnalyzer', () => {
  it('analyzes boardroom schematic and produces valid payload', () => {
    const payload = analyzeSchematic(boardroomSchematic(), catalog);
    expect(payload.validation.valid).toBe(true);
    expect(payload.placements.length).toBe(9);
    expect(payload.rackRequired).toBe(true);
    expect(payload.rackKind).toBe('floor');
    expect(payload.totalRU).toBeGreaterThanOrEqual(5); // 2+1+2 = 5 RU
    expect(payload.cableManifest.length).toBe(7);
  });

  it('assigns wall mounting to displays', () => {
    const payload = analyzeSchematic(boardroomSchematic(), catalog);
    const disp1 = payload.placements.find((p) => p.nodeId === 'display-1');
    expect(disp1).toBeDefined();
    expect(disp1!.mountingKind).toBe('wall');
    expect(disp1!.wall).toBe('front');
  });

  it('assigns rack mounting to DSP and amplifier', () => {
    const payload = analyzeSchematic(boardroomSchematic(), catalog);
    const dsp = payload.placements.find((p) => p.nodeId === 'dsp-1');
    const amp = payload.placements.find((p) => p.nodeId === 'amp-1');
    expect(dsp!.mountingKind).toBe('rack');
    expect(amp!.mountingKind).toBe('rack');
    expect(dsp!.rackPositionRU).toBeDefined();
  });

  it('generates sequential cable IDs', () => {
    const payload = analyzeSchematic(boardroomSchematic(), catalog);
    expect(payload.cableManifest[0].cableId).toBe('C-001');
    expect(payload.cableManifest[6].cableId).toBe('C-007');
  });

  it('huddle schematic requires no rack', () => {
    const payload = analyzeSchematic(huddleSchematic(), catalog);
    expect(payload.rackRequired).toBe(false);
    expect(payload.totalRU).toBe(0);
    expect(payload.placements.length).toBe(2);
  });

  it('respects target room dimensions from metadata', () => {
    const payload = analyzeSchematic(boardroomSchematic(), catalog);
    // Boardroom metadata: 10m x 7m — displays should be on z = -depth/2
    const disp = payload.placements.find((p) => p.nodeId === 'display-1');
    expect(disp!.position.z).toBeCloseTo(-3.5 + 0.02, 1);
  });

  it('estimates cable lengths from room diagonal', () => {
    const payload = analyzeSchematic(boardroomSchematic(), catalog);
    for (const cable of payload.cableManifest) {
      expect(cable.estimatedLengthM).toBeGreaterThan(0);
    }
  });

  it('infers medium from signal type when not specified', () => {
    const payload = analyzeSchematic(boardroomSchematic(), catalog);
    const danteCable = payload.cableManifest.find((c) => c.linkId === 'lk-5');
    expect(danteCable!.medium).toBe('Cat6');
  });
});
