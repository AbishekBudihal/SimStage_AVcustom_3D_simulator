import { describe, it, expect } from 'vitest';
import { syncSchematicTo3D } from '../../src/schematic/Schematic3DSync';
import { analyzeSchematic } from '../../src/schematic/SchematicAnalyzer';
import { exportAppStateToSchematic } from '../../src/schematic/SchematicExporter';
import { boardroomSchematic, huddleSchematic } from '../../src/schematic/demoSchematics';
import { loadDefaultCatalog } from '../../src/catalog/loadCatalog';
import { AppState } from '../../src/app/AppState';
import { createDefaultRoom } from '../../src/room/RoomModel';
import { ROOM_TEMPLATES, applyRoomTemplate } from '../../src/room/RoomTemplates';

const catalog = loadDefaultCatalog();

describe('Phase 10: Schematic -> Engineering Model -> 3D Hardening (§2, §18, §20, §28)', () => {
  it('round-trips boardroom schematic from SchematicGraph -> AppState -> SchematicGraph without data loss', () => {
    const state = new AppState();
    const originalSchematic = boardroomSchematic();
    const analyzed = analyzeSchematic(originalSchematic, catalog);

    // 1. Sync into AppState
    const syncRes = syncSchematicTo3D(analyzed, state, { clearExisting: true });
    expect(syncRes.equipmentAdded).toBe(9);
    expect(state.equipment.length).toBe(9);
    expect(state.connections.length).toBe(7);
    expect(state.racks.length).toBe(1);

    // 2. Export back to SchematicGraph
    const exported = exportAppStateToSchematic(state, catalog);
    expect(exported.nodes.length).toBe(9);
    expect(exported.links.length).toBe(7);
    expect(exported.metadata.title).toBeDefined();

    // Verify all original node roles and labels exist
    const labels = exported.nodes.map((n) => n.label);
    expect(labels).toContain('Presenter Laptop');
    expect(labels).toContain('Extron DTP CrossPoint 84');
    expect(labels).toContain('Samsung QM86R Display L');
    expect(labels).toContain('Samsung QM86R Display R');
    expect(labels).toContain('Shure MXA920 Ceiling Mic');
    expect(labels).toContain('Biamp TesiraForte AVB');
    expect(labels).toContain('QSC CX302V Power Amplifier');
    expect(labels).toContain('JBL Control 26CT Ceiling Speaker');
    expect(labels).toContain('PTZ Camera');

    // Verify rack-mountable properties were captured in exported nodes
    const dspNode = exported.nodes.find((n) => n.label === 'Biamp TesiraForte AVB');
    expect(dspNode?.mountingPreference).toBe('rack');
    expect(dspNode?.ruHeight).toBe(1);

    // 3. Re-analyze exported graph and re-sync
    const state2 = new AppState();
    const reAnalyzed = analyzeSchematic(exported, catalog);
    const reSyncRes = syncSchematicTo3D(reAnalyzed, state2, { clearExisting: true });
    expect(reSyncRes.equipmentAdded).toBe(9);
    expect(state2.equipment.length).toBe(9);
    expect(state2.racks.length).toBe(1);
    expect(state2.connections.length).toBe(7);
  });

  it('synthesizes displays and cameras onto room presentation wall with correct orientation', () => {
    const state = new AppState();
    const room = createDefaultRoom();
    // Configure room with back wall as presentation wall
    room.presentationWall = 'back';
    state.room = room;

    const originalSchematic = boardroomSchematic();
    const analyzed = analyzeSchematic(originalSchematic, catalog, room);

    // Placements on 'back' wall should have wall: 'back' and rotationY: Math.PI
    const displayPlacements = analyzed.placements.filter((p) => {
      const node = originalSchematic.nodes.find((n) => n.id === p.nodeId);
      return node?.category === 'display';
    });

    expect(displayPlacements.length).toBe(2);
    displayPlacements.forEach((dp) => {
      expect(dp.wall).toBe('back');
      expect(dp.rotationY).toBeCloseTo(Math.PI);
      expect(dp.position.z).toBeCloseTo(room.depth / 2 - 0.02, 1);
    });

    const camPlacement = analyzed.placements.find((p) => {
      const node = originalSchematic.nodes.find((n) => n.id === p.nodeId);
      return node?.category === 'camera';
    })!;
    expect(camPlacement).toBeDefined();
    expect(camPlacement.wall).toBe('back');
    expect(camPlacement.rotationY).toBeCloseTo(Math.PI);
  });

  it('places ceiling mics and speakers inside designated semantic zones', () => {
    const room = applyRoomTemplate(createDefaultRoom(), ROOM_TEMPLATES.boardroom);
    const originalSchematic = boardroomSchematic();
    const analyzed = analyzeSchematic(originalSchematic, catalog, room);

    const micZone = room.semanticZones!.find((z) => z.kind === 'microphone_zone')!;
    expect(micZone).toBeDefined();

    const micPlacement = analyzed.placements.find((p) => {
      const node = originalSchematic.nodes.find((n) => n.id === p.nodeId);
      return node?.category === 'microphone';
    })!;
    expect(micPlacement).toBeDefined();
    expect(micPlacement.position.x).toBeGreaterThanOrEqual(micZone.bounds.minX - 0.1);
    expect(micPlacement.position.x).toBeLessThanOrEqual(micZone.bounds.maxX + 0.1);
    expect(micPlacement.position.z).toBeGreaterThanOrEqual(micZone.bounds.minZ - 0.1);
    expect(micPlacement.position.z).toBeLessThanOrEqual(micZone.bounds.maxZ + 0.1);
    expect(micPlacement.position.y).toBeCloseTo(room.height - 0.05, 2);
  });

  it('aligns equipment rack coordinates to rack_zone when defined', () => {
    const state = new AppState();
    const room = applyRoomTemplate(createDefaultRoom(), ROOM_TEMPLATES.boardroom);
    state.room = room;

    const originalSchematic = boardroomSchematic();
    const analyzed = analyzeSchematic(originalSchematic, catalog, room);
    syncSchematicTo3D(analyzed, state);

    expect(state.racks.length).toBe(1);
    const rack = state.racks[0];
    const rackZone = room.semanticZones!.find((z) => z.kind === 'rack_zone')!;
    const expectedX = (rackZone.bounds.minX + rackZone.bounds.maxX) / 2;
    const expectedZ = (rackZone.bounds.minZ + rackZone.bounds.maxZ) / 2;

    expect(rack.x).toBeCloseTo(expectedX, 1);
    expect(rack.z).toBeCloseTo(expectedZ, 1);
  });

  it('preserves multi-signal protocols and media across export', () => {
    const state = new AppState();
    const originalSchematic = boardroomSchematic();
    const analyzed = analyzeSchematic(originalSchematic, catalog);
    syncSchematicTo3D(analyzed, state);

    const exported = exportAppStateToSchematic(state, catalog);
    const danteLink = exported.links.find((l) => l.signalType === 'DANTE');
    expect(danteLink).toBeDefined();
    expect(danteLink?.physicalMedium).toBe('Cat6');

    const hdmiLinks = exported.links.filter((l) => l.signalType === 'VIDEO');
    expect(hdmiLinks.length).toBeGreaterThanOrEqual(4);
    hdmiLinks.forEach((l) => expect(l.physicalMedium).toBe('HDMI'));
  });
});
