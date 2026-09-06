/**
 * RoomTemplates.ts
 * ────────────────────────────────────────────────────────────
 * Catalog of 8 Data-Driven Room Archetypes (§16) and
 * dynamic semantic zone derivation (§18).
 * ────────────────────────────────────────────────────────────
 */

import type { RoomModel } from './RoomModel';
import type {
  RoomTemplate,
  RoomType,
  SemanticZone,
  RoomEnvironmentSpec,
  RecommendedAvSpec
} from './RoomTemplateTypes';

export const ROOM_TEMPLATES: Record<RoomType, RoomTemplate> = {
  boardroom: {
    id: 'boardroom',
    label: 'Boardroom',
    description: 'Executive conference space with premium finishes, integrated ceiling audio, and dual displays.',
    typicalCapacity: [12, 20],
    defaultDimensions: { width: 9.0, depth: 6.0, height: 3.2 },
    defaultDisplayWall: 'front',
    seatingPattern: 'boardroom_perimeter',
    tableType: 'executive_conference',
    environment: {
      ceiling: 'acoustic_grid_2x2',
      lighting: 'linear_pendants',
      flooring: 'executive_broadloom',
      wallStyle: 'wood_paneling',
      furnitureStyle: 'executive_wood'
    },
    recommendedAv: {
      minDisplays: 2,
      defaultCameraMount: 'wall',
      micType: 'ceiling_array',
      speakerDistribution: 'ceiling_distributed',
      rackRecommended: true
    }
  },

  conference: {
    id: 'conference',
    label: 'Conference Room',
    description: 'Standard collaboration meeting space with interactive display and table or ceiling mics.',
    typicalCapacity: [8, 14],
    defaultDimensions: { width: 7.0, depth: 5.0, height: 3.0 },
    defaultDisplayWall: 'front',
    seatingPattern: 'conference_table',
    tableType: 'standard_conference',
    environment: {
      ceiling: 'acoustic_grid_2x2',
      lighting: 'recessed_troffers',
      flooring: 'corporate_carpet_tile',
      wallStyle: 'painted_drywall',
      furnitureStyle: 'contemporary_office'
    },
    recommendedAv: {
      minDisplays: 1,
      defaultCameraMount: 'wall',
      micType: 'table_array',
      speakerDistribution: 'ceiling_distributed',
      rackRecommended: true
    }
  },

  huddle: {
    id: 'huddle',
    label: 'Huddle Room',
    description: 'Compact ad-hoc video conferencing pod optimized for 2–6 participants with an all-in-one soundbar.',
    typicalCapacity: [2, 6],
    defaultDimensions: { width: 3.4, depth: 3.0, height: 2.6 },
    defaultDisplayWall: 'front',
    seatingPattern: 'trapezoid_facing',
    tableType: 'teardrop_huddle',
    environment: {
      ceiling: 'drywall_hardlid',
      lighting: 'downlights',
      flooring: 'corporate_carpet_tile',
      wallStyle: 'acoustic_fabric_panels',
      furnitureStyle: 'modern_minimalist'
    },
    recommendedAv: {
      minDisplays: 1,
      defaultCameraMount: 'wall',
      micType: 'boundary',
      speakerDistribution: 'soundbar',
      rackRecommended: false
    }
  },

  training: {
    id: 'training',
    label: 'Training Room',
    description: 'Interactive classroom/workshop room with reconfigurable tables, instructor podium, and tracking camera.',
    typicalCapacity: [16, 30],
    defaultDimensions: { width: 10.0, depth: 8.0, height: 3.2 },
    defaultDisplayWall: 'front',
    seatingPattern: 'classroom_modular',
    tableType: 'flip_top_training',
    environment: {
      ceiling: 'acoustic_grid_2x4',
      lighting: 'recessed_troffers',
      flooring: 'corporate_carpet_tile',
      wallStyle: 'painted_drywall',
      furnitureStyle: 'educational_laminate'
    },
    recommendedAv: {
      minDisplays: 2,
      defaultCameraMount: 'wall',
      micType: 'ceiling_array',
      speakerDistribution: 'ceiling_distributed',
      rackRecommended: true
    }
  },

  classroom: {
    id: 'classroom',
    label: 'Classroom',
    description: 'Instructor-led learning space with fixed student rows, presenter zone, and speech reinforcement.',
    typicalCapacity: [20, 40],
    defaultDimensions: { width: 11.0, depth: 9.0, height: 3.3 },
    defaultDisplayWall: 'front',
    seatingPattern: 'traditional_rows',
    tableType: 'fixed_bench',
    environment: {
      ceiling: 'acoustic_grid_2x4',
      lighting: 'linear_pendants',
      flooring: 'resilient_vinyl',
      wallStyle: 'painted_drywall',
      furnitureStyle: 'educational_laminate'
    },
    recommendedAv: {
      minDisplays: 2,
      defaultCameraMount: 'wall',
      micType: 'wireless',
      speakerDistribution: 'ceiling_distributed',
      rackRecommended: true
    }
  },

  executive: {
    id: 'executive',
    label: 'Executive Meeting Room',
    description: 'High-end leadership suite with architectural wood ceiling, discreet beamforming mics, and credenza.',
    typicalCapacity: [6, 12],
    defaultDimensions: { width: 8.0, depth: 5.5, height: 3.2 },
    defaultDisplayWall: 'front',
    seatingPattern: 'boat_shaped_conference',
    tableType: 'executive_veneer',
    environment: {
      ceiling: 'wood_slat',
      lighting: 'perimeter_cove',
      flooring: 'executive_broadloom',
      wallStyle: 'acoustic_fabric_panels',
      furnitureStyle: 'executive_wood'
    },
    recommendedAv: {
      minDisplays: 2,
      defaultCameraMount: 'wall',
      micType: 'ceiling_array',
      speakerDistribution: 'ceiling_distributed',
      rackRecommended: true
    }
  },

  multipurpose: {
    id: 'multipurpose',
    label: 'Multipurpose Room',
    description: 'Divisible assembly / townhall space with high ceilings, stage zone, and wide-coverage line arrays.',
    typicalCapacity: [30, 80],
    defaultDimensions: { width: 14.0, depth: 10.0, height: 3.6 },
    defaultDisplayWall: 'front',
    seatingPattern: 'theater_or_banquet',
    tableType: 'stacking_banquet',
    environment: {
      ceiling: 'open_plenum',
      lighting: 'linear_pendants',
      flooring: 'polished_concrete',
      wallStyle: 'acoustic_fabric_panels',
      furnitureStyle: 'contemporary_office'
    },
    recommendedAv: {
      minDisplays: 3,
      defaultCameraMount: 'wall',
      micType: 'wireless',
      speakerDistribution: 'ceiling_distributed',
      rackRecommended: true
    }
  },

  custom: {
    id: 'custom',
    label: 'Custom Room',
    description: 'User-tailored architectural environment with customizable dimensions, layout, and finish styling.',
    typicalCapacity: [4, 16],
    defaultDimensions: { width: 6.5, depth: 4.5, height: 3.0 },
    defaultDisplayWall: 'front',
    seatingPattern: 'standard',
    tableType: 'standard',
    environment: {
      ceiling: 'acoustic_grid_2x2',
      lighting: 'recessed_troffers',
      flooring: 'corporate_carpet_tile',
      wallStyle: 'painted_drywall',
      furnitureStyle: 'contemporary_office'
    },
    recommendedAv: {
      minDisplays: 1,
      defaultCameraMount: 'wall',
      micType: 'table_array',
      speakerDistribution: 'ceiling_distributed',
      rackRecommended: false
    }
  }
};

/**
 * Retrieve a specific room template by ID.
 */
export function getRoomTemplate(type: RoomType): RoomTemplate {
  return ROOM_TEMPLATES[type] ?? ROOM_TEMPLATES.custom;
}

/**
 * Retrieve all 8 room template archetypes as an array.
 */
export function getAllRoomTemplates(): RoomTemplate[] {
  return Object.values(ROOM_TEMPLATES);
}

/**
 * Dynamically computes semantic AV zones (§18) for a room geometry and presentation wall.
 * Semantic zones provide clear regions for downstream engines (cameras, displays, microphones, speakers, racks).
 */
export function computeSemanticZones(
  template: RoomTemplate,
  width: number,
  depth: number,
  height: number,
  presentationWall: 'front' | 'back' | 'left' | 'right' = 'front'
): SemanticZone[] {
  const halfW = width / 2;
  const halfD = depth / 2;
  const zones: SemanticZone[] = [];

  // 1. Main Display Wall Zone (depth ~0.3m offset from wall)
  zones.push({
    id: 'zone-display-main',
    name: 'Main Display Wall',
    kind: 'display_wall',
    wall: presentationWall,
    targetHeightM: Math.min(1.5, height * 0.45),
    bounds: {
      minX: -halfW * 0.7,
      maxX: halfW * 0.7,
      minZ: -halfD,
      maxZ: -halfD + 0.3
    },
    description: 'Primary visual display mount region centered on presentation wall.'
  });

  // 2. Camera Zone (centered on display wall, eye-level)
  zones.push({
    id: 'zone-camera-front',
    name: 'Primary Camera Zone',
    kind: 'camera_zone',
    wall: presentationWall,
    targetHeightM: Math.min(1.7, height * 0.52),
    bounds: {
      minX: -halfW * 0.25,
      maxX: halfW * 0.25,
      minZ: -halfD,
      maxZ: -halfD + 0.2
    },
    description: 'Main framing / tracking PTZ camera position directly above or below display.'
  });

  // 3. Table / Participant Zone (center room cluster)
  zones.push({
    id: 'zone-table-center',
    name: 'Table & Participant Center',
    kind: 'table_center',
    targetHeightM: 0.74,
    bounds: {
      minX: -halfW * 0.5,
      maxX: halfW * 0.5,
      minZ: -halfD * 0.3,
      maxZ: halfD * 0.5
    },
    description: 'Central participant seating and conference table envelope.'
  });

  // 4. Ceiling Microphone Zone (suspended over seating envelope)
  zones.push({
    id: 'zone-mic-ceiling',
    name: 'Ceiling Microphone Array Zone',
    kind: 'microphone_zone',
    targetHeightM: height - 0.1,
    bounds: {
      minX: -halfW * 0.4,
      maxX: halfW * 0.4,
      minZ: -halfD * 0.2,
      maxZ: halfD * 0.4
    },
    description: 'Preferred ceiling acoustic array pickup zone for participants.'
  });

  // 5. Speaker Zones (front stereo or distributed ceiling)
  zones.push({
    id: 'zone-speaker-distributed',
    name: 'Ceiling Speaker Grid Zone',
    kind: 'speaker_zone',
    targetHeightM: height,
    bounds: {
      minX: -halfW * 0.75,
      maxX: halfW * 0.75,
      minZ: -halfD * 0.75,
      maxZ: halfD * 0.75
    },
    description: 'Evenly distributed audio reinforcement coverage area.'
  });

  // 6. Presenter / Lectern Zone (near front wall, off to one side)
  if (template.id === 'training' || template.id === 'classroom' || template.id === 'multipurpose') {
    zones.push({
      id: 'zone-presenter',
      name: 'Instructor / Presenter Zone',
      kind: 'presenter_zone',
      wall: presentationWall,
      targetHeightM: 0,
      bounds: {
        minX: halfW * 0.3,
        maxX: halfW * 0.8,
        minZ: -halfD + 0.4,
        maxZ: -halfD + 1.8
      },
      description: 'Instructor podium, lectern, and whiteboard interaction space.'
    });
  }

  // 7. Equipment Rack / Credenza Zone (back or side corner)
  zones.push({
    id: 'zone-rack-equipment',
    name: 'Equipment Rack & Credenza Zone',
    kind: 'rack_zone',
    targetHeightM: 0,
    bounds: {
      minX: -halfW + 0.1,
      maxX: -halfW + 0.8,
      minZ: halfD - 0.9,
      maxZ: halfD - 0.1
    },
    description: 'AV rack enclosure, centralized DSP, switcher, and amplifier service footprint.'
  });

  return zones;
}

/**
 * Apply a RoomTemplate archetype to an existing or new RoomModel.
 * Preserves user custom overrides when switching templates.
 */
export function applyRoomTemplate(room: RoomModel, template: RoomTemplate): RoomModel {
  const width = template.defaultDimensions.width;
  const depth = template.defaultDimensions.depth;
  const height = template.defaultDimensions.height;

  const semanticZones = computeSemanticZones(template, width, depth, height, template.defaultDisplayWall);

  return {
    ...room,
    width,
    depth,
    height,
    useCase: template.id,
    presentationWall: template.defaultDisplayWall,
    templateId: template.id,
    ceilingType: template.environment.ceiling,
    lightingStyle: template.environment.lighting,
    flooringType: template.environment.flooring,
    wallStyle: template.environment.wallStyle,
    furnitureStyle: template.environment.furnitureStyle,
    semanticZones
  };
}
