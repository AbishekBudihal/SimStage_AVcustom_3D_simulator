/**
 * RoomModel.ts
 * Pure architectural data describing the space. No Three.js types
 * here — RoomGenerator (engine layer) turns this into geometry.
 * Keeping this pure means viewing/audio/mic engines can reason
 * about the room without touching the renderer, and the model is
 * trivially serializable for the project file format.
 */

export interface Opening {
  /** Stable id so the placement engine / UI can reference a specific opening
   *  (e.g. "this candidate is rejected because of opening door-1"). Optional
   *  for backward compatibility with older project files; generateOpeningId()
   *  fills one in when missing. */
  id?: string;
  wall: 'front' | 'back' | 'left' | 'right';
  /** Offset from the wall's local origin (its left corner as built in
   *  RoomGenerator), meters */
  offset: number;
  width: number;
  height: number;
  sillHeight: number; // 0 for a door, >0 for a window
  kind: 'door' | 'window';
}

let openingCounter = 0;
export function generateOpeningId(kind: Opening['kind']): string {
  openingCounter += 1;
  return `${kind}-${openingCounter}`;
}

export interface Column {
  x: number;
  z: number;
  width: number;
  depth: number;
}

export interface RoomZone {
  id: string;
  name: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

import type {
  RoomType,
  CeilingType,
  LightingStyle,
  FlooringType,
  WallStyle,
  FurnitureStyle,
  SemanticZone
} from './RoomTemplateTypes';

export interface RoomModel {
  id: string;
  width: number;   // meters, X axis
  depth: number;   // meters, Z axis
  height: number;  // meters, ceiling height (AFF)
  wallThickness: number;
  floorElevation: number;
  openings: Opening[];
  columns: Column[];
  useCase: string;
  /**
   * Explicit presentation-wall override. When unset, RoomGeometry's
   * determinePresentationWall() picks the best wall automatically (avoiding
   * doors/windows, preferring more usable width) — see §2/§3 of the spatial
   * model. The UI's "Change" control on the Presentation Wall setting writes
   * here; everything else (seating orientation, display suggestion) should
   * read via RoomGeometry.getPresentationWall(room) rather than assuming
   * 'front', so a user override actually takes effect everywhere.
   */
  presentationWall?: 'front' | 'back' | 'left' | 'right';
  /** Flexible/divisible rooms. Partition geometry is not simulated. */
  divisible?: boolean;
  zones?: RoomZone[];
  /** Template archetype ID (§16) */
  templateId?: RoomType;
  ceilingType?: CeilingType;
  lightingStyle?: LightingStyle;
  flooringType?: FlooringType;
  wallStyle?: WallStyle;
  furnitureStyle?: FurnitureStyle;
  /** Semantic AV equipment placement zones (§18) */
  semanticZones?: SemanticZone[];
}

export function createDefaultRoom(useCase: string = 'conference'): RoomModel {
  return {
    id: 'room-1',
    width: 10,
    depth: 7,
    height: 3.2,
    wallThickness: 0.15,
    floorElevation: 0,
    openings: [
      { id: generateOpeningId('door'), wall: 'front', offset: 3.6, width: 1.0, height: 2.1, sillHeight: 0, kind: 'door' }
    ],
    columns: [],
    useCase,
    templateId: (useCase as RoomType) || 'conference',
    ceilingType: 'acoustic_grid_2x2',
    lightingStyle: 'recessed_troffers',
    flooringType: 'corporate_carpet_tile',
    wallStyle: 'painted_drywall',
    furnitureStyle: 'contemporary_office'
  };
}
