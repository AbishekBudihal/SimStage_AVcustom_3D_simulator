/**
 * Project setup maps UI choices onto DesignRequirements.
 * No engineering calculations here — Auto Design / seating engines consume the result.
 */

import { createDefaultRoom, type RoomModel } from '../../room/RoomModel';
import {
  defaultQuickRequirements,
  type DesignRequirements,
  type DesignUseCase
} from '../../autodesign/DesignRequirements';

export type ShellNav = 'project' | 'design' | 'system' | 'simulate' | 'validate' | 'docs';

export type UiComplexity = 'beginner' | 'pro';

export type ProjectTypeId =
  | 'meeting'
  | 'boardroom'
  | 'training'
  | 'classroom'
  | 'presentation'
  | 'video_conference'
  | 'hybrid'
  | 'auditorium';

export const PROJECT_TYPES: Array<{ id: ProjectTypeId; label: string }> = [
  { id: 'meeting', label: 'Meeting Room' },
  { id: 'boardroom', label: 'Boardroom' },
  { id: 'training', label: 'Training Room' },
  { id: 'classroom', label: 'Classroom' },
  { id: 'presentation', label: 'Presentation Room' },
  { id: 'video_conference', label: 'Video Conference' },
  { id: 'hybrid', label: 'Hybrid Collaboration' },
  { id: 'auditorium', label: 'Auditorium' }
];

export const CAPACITY_PRESETS = [2, 4, 6, 8, 12, 16] as const;

export function useCaseForProjectType(type: ProjectTypeId): DesignUseCase {
  switch (type) {
    case 'training':
    case 'classroom':
      return 'training';
    case 'presentation':
    case 'auditorium':
      return 'presentation';
    case 'video_conference':
      return 'video_conference';
    case 'hybrid':
      return 'hybrid';
    default:
      return 'meeting';
  }
}

export function requirementsFromSetup(input: {
  projectType: ProjectTypeId;
  capacity: number;
  widthM: number;
  lengthM: number;
  heightM: number;
  useCase?: DesignUseCase;
}): DesignRequirements {
  const useCase = input.useCase ?? useCaseForProjectType(input.projectType);
  const base = defaultQuickRequirements();
  return {
    ...base,
    useCase,
    room: { width: input.widthM, length: input.lengthM, height: input.heightM },
    seating: { count: input.capacity, layout: 'auto' },
    constraints: {
      ...base.constraints,
      keepExistingEquipment: false,
      keepExistingSeating: false
    },
    completeMissingOnly: false
  };
}

export function shellNavForWorkspace(mode: 'design' | 'system' | 'simulate' | 'validate' | 'docs', designTool: 'room' | 'seating' | 'catalog'): ShellNav {
  if (mode === 'system') return 'system';
  if (mode === 'simulate') return 'simulate';
  if (mode === 'validate') return 'validate';
  if (mode === 'docs') return 'docs';
  return designTool === 'room' ? 'project' : 'design';
}

export function roomFromSetup(input: {
  projectType: ProjectTypeId;
  widthM: number;
  lengthM: number;
  heightM: number;
}): RoomModel {
  const room = createDefaultRoom(input.projectType);
  room.width = input.widthM;
  room.depth = input.lengthM;
  room.height = input.heightM;
  return room;
}
