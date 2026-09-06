/**
 * RoomTemplateTypes.ts
 * ────────────────────────────────────────────────────────────
 * Strongly-typed data model for the Room Template Engine (§16, §17).
 *
 * Encapsulates:
 * - Room Archetypes (Boardroom, Conference, Huddle, Training, etc.)
 * - Environmental / Architectural Finishes (Ceiling, Lighting, Flooring, Walls)
 * - Semantic AV Placement Zones (Display wall, Camera zone, Mic zones, etc.)
 *
 * Keeps architectural room definition strictly decoupled from AV simulation logic (§19).
 * ────────────────────────────────────────────────────────────
 */

export type RoomType =
  | 'boardroom'
  | 'conference'
  | 'huddle'
  | 'training'
  | 'classroom'
  | 'executive'
  | 'multipurpose'
  | 'custom';

export type CeilingType =
  | 'acoustic_grid_2x2'
  | 'acoustic_grid_2x4'
  | 'drywall_hardlid'
  | 'open_plenum'
  | 'wood_slat';

export type LightingStyle =
  | 'recessed_troffers'
  | 'linear_pendants'
  | 'downlights'
  | 'perimeter_cove';

export type FlooringType =
  | 'corporate_carpet_tile'
  | 'executive_broadloom'
  | 'hardwood'
  | 'polished_concrete'
  | 'resilient_vinyl';

export type WallStyle =
  | 'painted_drywall'
  | 'acoustic_fabric_panels'
  | 'wood_paneling'
  | 'glass_storefront';

export type FurnitureStyle =
  | 'executive_wood'
  | 'modern_minimalist'
  | 'educational_laminate'
  | 'contemporary_office';

export type SemanticZoneKind =
  | 'display_wall'
  | 'camera_zone'
  | 'microphone_zone'
  | 'speaker_zone'
  | 'presenter_zone'
  | 'table_center'
  | 'rack_zone'
  | 'credenza_zone';

export interface SemanticZoneBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface SemanticZone {
  id: string;
  name: string;
  kind: SemanticZoneKind;
  bounds: SemanticZoneBounds;
  targetHeightM?: number;
  wall?: 'front' | 'back' | 'left' | 'right';
  description?: string;
}

export interface RoomEnvironmentSpec {
  ceiling: CeilingType;
  lighting: LightingStyle;
  flooring: FlooringType;
  wallStyle: WallStyle;
  furnitureStyle: FurnitureStyle;
}

export interface RecommendedAvSpec {
  minDisplays: number;
  defaultCameraMount: 'wall' | 'table' | 'ceiling';
  micType: 'ceiling_array' | 'table_array' | 'boundary' | 'wireless';
  speakerDistribution: 'ceiling_distributed' | 'front_stereo' | 'soundbar';
  rackRecommended: boolean;
}

export interface RoomTemplate {
  id: RoomType;
  label: string;
  description: string;
  typicalCapacity: [number, number];
  defaultDimensions: {
    width: number;
    depth: number;
    height: number;
  };
  defaultDisplayWall: 'front' | 'back' | 'left' | 'right';
  seatingPattern: string;
  tableType: string;
  environment: RoomEnvironmentSpec;
  recommendedAv: RecommendedAvSpec;
}
