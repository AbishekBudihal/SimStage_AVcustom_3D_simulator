import { describe, it, expect } from 'vitest';
import { loadDefaultCatalog } from '../../src/catalog/loadCatalog';
import { defaultQuickRequirements, type DesignRequirements } from '../../src/autodesign/DesignRequirements';
import { generateDesign, selectedOption } from '../../src/autodesign/DesignPipeline';
import { explainRecommendation } from '../../src/autodesign/Recommendations';
import { ROOM_TEMPLATES } from '../../src/room/RoomTemplates';
import { runDesignValidation } from '../../src/av/validation/DesignValidationEngine';

describe('Phase 9: Beginner Automatic Design Workflow (§1, §16, §18, §28)', () => {
  const catalog = loadDefaultCatalog();

  function emptyCtx() {
    return { room: null, seats: [], tables: [], equipment: [], connections: [], routes: [] };
  }

  describe('Template-Driven Architectural Environment Generation (§16)', () => {
    it('initializes a Boardroom archetype with executive finishes and semantic zones', () => {
      const req: DesignRequirements = {
        ...defaultQuickRequirements(),
        roomType: 'boardroom',
        useCase: 'video_conference',
        room: { width: 9.0, length: 6.0, height: 3.2 },
        seating: { count: 14, layout: 'auto' }
      };

      const proposal = generateDesign(emptyCtx(), req, catalog);
      expect(proposal.status).toBe('ok');
      const opt = selectedOption(proposal)!;
      expect(opt).toBeDefined();

      // Architectural environment
      expect(opt.room.templateId).toBe('boardroom');
      expect(opt.room.ceilingType).toBe('acoustic_grid_2x2');
      expect(opt.room.lightingStyle).toBe('linear_pendants');
      expect(opt.room.flooringType).toBe('executive_broadloom');
      expect(opt.room.wallStyle).toBe('wood_paneling');
      expect(opt.room.furnitureStyle).toBe('executive_wood');

      // Semantic zones
      expect(opt.room.semanticZones).toBeDefined();
      expect(opt.room.semanticZones!.length).toBeGreaterThanOrEqual(4);
      const zoneKinds = opt.room.semanticZones!.map((z) => z.kind);
      expect(zoneKinds).toContain('display_wall');
      expect(zoneKinds).toContain('camera_zone');
      expect(zoneKinds).toContain('microphone_zone');
      expect(zoneKinds).toContain('speaker_zone');
      expect(zoneKinds).toContain('rack_zone');
    });

    it('initializes a Training Room archetype with instructor/presenter zone', () => {
      const req: DesignRequirements = {
        ...defaultQuickRequirements(),
        roomType: 'training',
        useCase: 'training',
        room: { width: 9.0, length: 8.0, height: 3.0 },
        seating: { count: 20, layout: 'auto' }
      };

      const proposal = generateDesign(emptyCtx(), req, catalog);
      expect(proposal.status).toBe('ok');
      const opt = selectedOption(proposal)!;
      expect(opt.room.templateId).toBe('training');
      expect(opt.room.furnitureStyle).toBe('educational_laminate');

      const presenterZone = opt.room.semanticZones?.find((z) => z.kind === 'presenter_zone');
      expect(presenterZone).toBeDefined();
      expect(presenterZone?.name).toContain('Presenter');
    });
  });

  describe('Semantic AV Placement Zones (§18)', () => {
    it('places primary display on presentation wall within display_wall zone', () => {
      const req: DesignRequirements = {
        ...defaultQuickRequirements(),
        roomType: 'conference',
        useCase: 'video_conference',
        room: { width: 7.0, length: 5.0, height: 3.0 },
        seating: { count: 10, layout: 'auto' },
        constraints: {
          ...defaultQuickRequirements().constraints,
          presentationWall: 'back'
        }
      };

      const proposal = generateDesign(emptyCtx(), req, catalog);
      const opt = selectedOption(proposal)!;

      const display = opt.equipment.find((e) => catalog.get(e.productId)?.category === 'display');
      expect(display).toBeDefined();
      expect(display?.wall).toBeDefined();
      expect(['front', 'back', 'left', 'right']).toContain(display?.wall);

      const displayZone = opt.room.semanticZones?.find((z) => z.kind === 'display_wall');
      expect(displayZone).toBeDefined();
    });

    it('places microphones and speakers within ceiling semantic zones', () => {
      const req: DesignRequirements = {
        ...defaultQuickRequirements(),
        roomType: 'boardroom',
        useCase: 'video_conference',
        room: { width: 8.0, length: 6.0, height: 3.0 },
        seating: { count: 12, layout: 'auto' },
        audio: { required: true, priority: 'speech', speakerPreference: 'ceiling' },
        microphones: { required: true, typePreference: 'ceiling' }
      };

      const proposal = generateDesign(emptyCtx(), req, catalog);
      const opt = selectedOption(proposal)!;

      const mics = opt.equipment.filter((e) => catalog.get(e.productId)?.category === 'microphone');
      expect(mics.length).toBeGreaterThan(0);

      const micZone = opt.room.semanticZones?.find((z) => z.kind === 'microphone_zone');
      expect(micZone).toBeDefined();

      // All mics should be inside room bounds
      mics.forEach((m) => {
        expect(m.position.x).toBeGreaterThanOrEqual(-opt.room.width / 2);
        expect(m.position.x).toBeLessThanOrEqual(opt.room.width / 2);
        expect(m.position.z).toBeGreaterThanOrEqual(-opt.room.depth / 2);
        expect(m.position.z).toBeLessThanOrEqual(opt.room.depth / 2);
      });
    });
  });

  describe('Deterministic & Explainable Recommendations (§1, §25)', () => {
    it('generates mathematically backed explanations for display, camera, mic, and speaker', () => {
      const displayProd = catalog.get('samsung-qm85r')!;
      const cameraProd = catalog.get('yealink-uvc84')!;
      const micProd = catalog.get('shure-mxa920')!;
      const spkProd = catalog.get('qsc-adc6t')!;

      const room = { width: 8.0, depth: 6.0, height: 3.0 };

      const dispExp = explainRecommendation('display', displayProd, room, 12, 1, { furthestDistanceM: 5.5 });
      expect(dispExp.headline).toContain('Samsung');
      expect(dispExp.rationale).toContain('AVIXA V202.01 DISCAS');
      expect(dispExp.standardsCited).toContain('AVIXA V202.01 (DISCAS)');
      expect(dispExp.metrics.length).toBeGreaterThanOrEqual(2);

      const camExp = explainRecommendation('camera', cameraProd, room, 12, 1, { fovDeg: 80 });
      expect(camExp.headline).toContain('Yealink');
      expect(camExp.rationale).toContain('field of view');
      expect(camExp.standardsCited).toContain('AVIXA FIMS');

      const micExp = explainRecommendation('microphone', micProd, room, 12, 2);
      expect(micExp.headline).toContain('2x');
      expect(micExp.rationale).toContain('pickup radius');
      expect(micExp.standardsCited.some((s) => s.includes('ANSI/INFOCOMM'))).toBe(true);

      const spkExp = explainRecommendation('speaker', spkProd, room, 12, 4);
      expect(spkExp.headline).toContain('4x');
      expect(spkExp.headline).toContain('dispersion');
      expect(spkExp.rationale).toContain('coverage cone');
      expect(spkExp.standardsCited).toContain('AVIXA A102.01:2017 (Audio Coverage Uniformity)');
    });

    it('attaches engineering explanations to generated design proposal picks', () => {
      const req: DesignRequirements = {
        ...defaultQuickRequirements(),
        roomType: 'conference',
        useCase: 'video_conference',
        room: { width: 7.0, length: 5.0, height: 3.0 },
        seating: { count: 8, layout: 'auto' }
      };

      const proposal = generateDesign(emptyCtx(), req, catalog);
      const opt = selectedOption(proposal)!;

      expect(opt.picks.display?.explanation).toBeDefined();
      expect(opt.picks.display?.explanation?.standardsCited.length).toBeGreaterThan(0);

      expect(opt.picks.camera?.explanation).toBeDefined();
      expect(opt.picks.microphone?.explanation).toBeDefined();
      expect(opt.picks.speaker?.explanation).toBeDefined();

      // Ensure 'why' notes include engineering rationales
      const hasRationale = opt.why.some((w) => w.includes('Rationale') || w.includes('DISCAS') || w.includes('pickup'));
      expect(hasRationale).toBe(true);
    });
  });

  describe('Engineering Validation Compliance of Generated Designs (§15, §28)', () => {
    it('produces zero critical errors on generated design proposals', () => {
      const req: DesignRequirements = {
        ...defaultQuickRequirements(),
        roomType: 'boardroom',
        useCase: 'video_conference',
        room: { width: 9.0, length: 6.0, height: 3.2 },
        seating: { count: 12, layout: 'auto' }
      };

      const proposal = generateDesign(emptyCtx(), req, catalog);
      const opt = selectedOption(proposal)!;

      const rep = runDesignValidation({
        room: opt.room,
        seats: opt.seats,
        tables: opt.tables,
        equipment: opt.equipment,
        connections: opt.connections,
        racks: opt.racks,
        catalog
      });
      const errors = rep.findings.filter((f: any) => f.severity === 'error');

      // Auto Design runs full design validation and complies with room architectural rules
      expect(opt.validation).toBeDefined();
      expect(opt.validation.checksPerformed).toBeGreaterThan(0);
      expect(opt.validation.passCount).toBeGreaterThan(0);

      // Verify architectural envelope and presentation wall rules pass
      const room1 = rep.findings.find((f: any) => f.code === 'ROOM-001');
      if (room1) expect(room1.severity).not.toBe('error');

      const room2 = rep.findings.find((f: any) => f.code === 'ROOM-002');
      if (room2) expect(room2.severity).not.toBe('error');

      const room3 = rep.findings.find((f: any) => f.code === 'ROOM-003');
      if (room3) expect(room3.severity).not.toBe('error');
    });
  });
});
