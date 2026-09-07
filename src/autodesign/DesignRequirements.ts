/**
 * Structured Auto Design requirements. Form UI maps into this model —
 * never store the wizard as ad-hoc strings.
 */

import type { EquipmentCategory } from '../catalog/EquipmentCatalog';
import type { SeatingLayout } from '../room/SeatingGenerator';
import type { WallKey } from '../room/RoomGeometry';
import type { RoomType } from '../room/RoomTemplateTypes';

export type AutoDesignMode = 'quick' | 'guided' | 'expert';

export type DesignUseCase = 'meeting' | 'presentation' | 'video_conference' | 'hybrid' | 'training';

export type DisplayCountPref = 'single' | 'dual' | 'no_preference';

export type AudioPriority = 'basic' | 'speech' | 'full_room';

export type MicTypePref = 'table' | 'ceiling' | 'no_preference';

export type CameraRequirement = 'required' | 'optional' | 'not_required';

export type SpeakerPref = 'ceiling' | 'wall' | 'no_preference';

export interface DesignRequirements {
  mode: AutoDesignMode;
  /** Architectural Room Template Archetype (§16, §1) */
  roomType?: RoomType;
  room: {
    /** World Z extent (presentation axis). UI label: Length. */
    length: number | null;
    /** World X extent. UI label: Width. */
    width: number | null;
    height: number | null;
    divisible?: boolean;
  };
  seating: {
    count: number | null;
    layout: SeatingLayout | 'auto';
  };
  useCase: DesignUseCase;
  presentation: {
    displayCount: DisplayCountPref;
    sizeMinIn?: number;
    sizeMaxIn?: number;
    byodWireless?: boolean;
    tablePatch?: boolean;
  };
  audio: {
    required: boolean;
    priority: AudioPriority;
    speakerPreference: SpeakerPref;
  };
  microphones: {
    required: boolean;
    typePreference: MicTypePref;
  };
  camera: {
    required: CameraRequirement;
  };
  networking?: {
    dedicatedSwitch?: boolean;
    poeRequired?: boolean;
  };
  control?: {
    touchPanel?: boolean;
    keypad?: boolean;
  };
  system: {
    switchingRequired: boolean | 'auto';
    dspRequired: boolean | 'auto';
    controlRequired: boolean;
  };
  preferences: {
    manufacturers: string[];
    categories: EquipmentCategory[];
  };
  constraints: {
    presentationWall?: WallKey;
    noWallSpeakers: boolean;
    noRearWallEquipment: boolean;
    keepExistingEquipment: boolean;
    keepExistingSeating: boolean;
    manufacturersExclusive: boolean;
    userConstraints: string[];
  };
  completeMissingOnly: boolean;
}

export function defaultQuickRequirements(): DesignRequirements {
  return {
    mode: 'quick',
    roomType: 'conference',
    room: { length: 10, width: 8, height: 3 },
    seating: { count: 12, layout: 'auto' },
    useCase: 'video_conference',
    presentation: { displayCount: 'no_preference', byodWireless: true, tablePatch: true },
    audio: { required: true, priority: 'speech', speakerPreference: 'ceiling' },
    microphones: { required: true, typePreference: 'no_preference' },
    camera: { required: 'required' },
    networking: { dedicatedSwitch: true, poeRequired: true },
    control: { touchPanel: true },
    system: { switchingRequired: 'auto', dspRequired: 'auto', controlRequired: false },
    preferences: { manufacturers: [], categories: [] },
    constraints: {
      noWallSpeakers: true,
      noRearWallEquipment: false,
      keepExistingEquipment: true,
      keepExistingSeating: true,
      manufacturersExclusive: false,
      userConstraints: []
    },
    completeMissingOnly: true
  };
}

export function layoutForUseCase(useCase: DesignUseCase): SeatingLayout {
  switch (useCase) {
    case 'training':
    case 'presentation':
      return 'classroom';
    case 'meeting':
    case 'video_conference':
    case 'hybrid':
      return 'boardroom';
  }
}

export function applyUseCaseDefaults(req: DesignRequirements): DesignRequirements {
  const next: DesignRequirements = {
    ...req,
    seating: { ...req.seating },
    audio: { ...req.audio },
    microphones: { ...req.microphones },
    camera: { ...req.camera },
    system: { ...req.system }
  };
  if (next.seating.layout === 'auto') {
    next.seating.layout = layoutForUseCase(next.useCase);
  }
  if (next.mode === 'quick') {
    if (next.useCase === 'presentation' || next.useCase === 'training') {
      if (next.camera.required === 'required' && req.mode === 'quick') {
        /* keep explicit camera choice */
      }
    }
    if (next.useCase === 'video_conference' || next.useCase === 'hybrid') {
      next.microphones.required = true;
      next.audio.required = true;
    }
  }
  return next;
}
