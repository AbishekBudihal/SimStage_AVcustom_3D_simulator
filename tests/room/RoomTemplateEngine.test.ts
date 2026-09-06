import { describe, it, expect } from 'vitest';
import {
  ROOM_TEMPLATES,
  getRoomTemplate,
  getAllRoomTemplates,
  computeSemanticZones,
  applyRoomTemplate
} from '../../src/room/RoomTemplates';
import type { RoomType, RoomTemplate } from '../../src/room/RoomTemplateTypes';
import { createDefaultRoom, type RoomModel } from '../../src/room/RoomModel';
import { generateRoomGeometry } from '../../src/room/RoomGenerator';

describe('Room Template Engine (§16, §17)', () => {
  const archetypes: RoomType[] = [
    'boardroom',
    'conference',
    'huddle',
    'training',
    'classroom',
    'executive',
    'multipurpose',
    'custom'
  ];

  it('defines all 8 core room archetypes with complete specs', () => {
    const all = getAllRoomTemplates();
    expect(all.length).toBe(8);

    archetypes.forEach((type) => {
      const t = getRoomTemplate(type);
      expect(t.id).toBe(type);
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);

      // Positive default dimensions
      expect(t.defaultDimensions.width).toBeGreaterThan(0);
      expect(t.defaultDimensions.depth).toBeGreaterThan(0);
      expect(t.defaultDimensions.height).toBeGreaterThan(0);

      // Realistic capacity ranges
      expect(t.typicalCapacity[0]).toBeGreaterThan(0);
      expect(t.typicalCapacity[1]).toBeGreaterThanOrEqual(t.typicalCapacity[0]);

      // Environmental styling
      expect(t.environment.ceiling).toBeDefined();
      expect(t.environment.lighting).toBeDefined();
      expect(t.environment.flooring).toBeDefined();
      expect(t.environment.wallStyle).toBeDefined();
      expect(t.environment.furnitureStyle).toBeDefined();

      // Recommended AV spec
      expect(t.recommendedAv.minDisplays).toBeGreaterThanOrEqual(1);
      expect(t.recommendedAv.defaultCameraMount).toBeDefined();
      expect(t.recommendedAv.micType).toBeDefined();
      expect(t.recommendedAv.speakerDistribution).toBeDefined();
    });
  });

  it('falls back to custom template for unrecognized room types', () => {
    const fallback = getRoomTemplate('space_station' as any);
    expect(fallback.id).toBe('custom');
  });

  describe('Semantic AV Placement Zones (§18)', () => {
    it('generates essential AV zones within the physical room boundaries', () => {
      const t = getRoomTemplate('boardroom');
      const w = 10, d = 6, h = 3.2;
      const zones = computeSemanticZones(t, w, d, h, 'front');

      expect(zones.length).toBeGreaterThanOrEqual(6);

      const displayZone = zones.find((z) => z.kind === 'display_wall');
      expect(displayZone).toBeDefined();
      expect(displayZone!.wall).toBe('front');

      const camZone = zones.find((z) => z.kind === 'camera_zone');
      expect(camZone).toBeDefined();

      const tableZone = zones.find((z) => z.kind === 'table_center');
      expect(tableZone).toBeDefined();

      const micZone = zones.find((z) => z.kind === 'microphone_zone');
      expect(micZone).toBeDefined();

      const spkZone = zones.find((z) => z.kind === 'speaker_zone');
      expect(spkZone).toBeDefined();

      const rackZone = zones.find((z) => z.kind === 'rack_zone');
      expect(rackZone).toBeDefined();

      // All zone bounds must fall within physical room envelope
      const halfW = w / 2;
      const halfD = d / 2;
      zones.forEach((z) => {
        expect(z.bounds.minX).toBeGreaterThanOrEqual(-halfW - 0.01);
        expect(z.bounds.maxX).toBeLessThanOrEqual(halfW + 0.01);
        expect(z.bounds.minZ).toBeGreaterThanOrEqual(-halfD - 0.01);
        expect(z.bounds.maxZ).toBeLessThanOrEqual(halfD + 0.01);
      });
    });

    it('generates instructor/presenter zone for training, classroom, and multipurpose rooms', () => {
      ['training', 'classroom', 'multipurpose'].forEach((type) => {
        const t = getRoomTemplate(type as RoomType);
        const zones = computeSemanticZones(t, 12, 8, 3.2, 'front');
        const presenterZone = zones.find((z) => z.kind === 'presenter_zone');
        expect(presenterZone).toBeDefined();
        expect(presenterZone!.name).toContain('Presenter');
      });

      // Huddle rooms should not have a presenter zone
      const huddleT = getRoomTemplate('huddle');
      const huddleZones = computeSemanticZones(huddleT, 3.5, 3.0, 2.6, 'front');
      expect(huddleZones.find((z) => z.kind === 'presenter_zone')).toBeUndefined();
    });
  });

  describe('Template Application to RoomModel', () => {
    it('applies template archetypes and preserves openings/columns', () => {
      const initial = createDefaultRoom('conference');
      initial.columns.push({ x: 2, z: 2, width: 0.4, depth: 0.4 });

      const boardroomTemplate = getRoomTemplate('boardroom');
      const applied = applyRoomTemplate(initial, boardroomTemplate);

      expect(applied.width).toBe(boardroomTemplate.defaultDimensions.width);
      expect(applied.depth).toBe(boardroomTemplate.defaultDimensions.depth);
      expect(applied.height).toBe(boardroomTemplate.defaultDimensions.height);
      expect(applied.templateId).toBe('boardroom');
      expect(applied.flooringType).toBe('executive_broadloom');
      expect(applied.ceilingType).toBe('acoustic_grid_2x2');
      expect(applied.wallStyle).toBe('wood_paneling');
      expect(applied.semanticZones).toBeDefined();
      expect(applied.semanticZones!.length).toBeGreaterThanOrEqual(6);

      // Preserved architectural columns and openings
      expect(applied.columns.length).toBe(1);
      expect(applied.columns[0].x).toBe(2);
      expect(applied.openings.length).toBe(initial.openings.length);
    });
  });

  describe('Architectural 3D Generation Compatibility', () => {
    it('generates 3D room architecture with environmental finishes without error', () => {
      archetypes.forEach((type) => {
        const t = getRoomTemplate(type);
        const room = applyRoomTemplate(createDefaultRoom('conference'), t);
        const sceneGroup = generateRoomGeometry(room);

        expect(sceneGroup).toBeDefined();
        expect(sceneGroup.name).toBe('room-architecture');

        const floor = sceneGroup.getObjectByName('floor');
        expect(floor).toBeDefined();

        const ceiling = sceneGroup.getObjectByName('ceiling');
        expect(ceiling).toBeDefined();

        const baseboards = sceneGroup.getObjectByName('room-baseboards');
        expect(baseboards).toBeDefined();

        const frontWall = sceneGroup.getObjectByName('wall-front');
        expect(frontWall).toBeDefined();
      });
    });
  });
});
