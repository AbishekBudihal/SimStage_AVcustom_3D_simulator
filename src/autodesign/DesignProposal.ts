import type { EquipmentInstance, EquipmentProduct } from '../catalog/EquipmentCatalog';
import type { Seat, TableSpec } from '../room/SeatingGenerator';
import type { RoomModel } from '../room/RoomModel';
import type { SystemConnection, SystemRoute } from '../system/SystemTypes';
import type { ValidationSummary } from '../av/validation/ValidationTypes';
import type { DesignRequirements } from './DesignRequirements';
import type { RequirementIssue } from './validateRequirements';
import type { DataCompleteness as Completeness } from './CatalogCandidates';
import type { AVRack } from '../av/AVRack';
import type { SpatialIssue } from './SpatialAudit';
import type { EngineeringExplanation } from './Recommendations';

export interface ProductPick {
  productId: string;
  name: string;
  reason: string;
  criterion: string;
  actual: string;
  expected: string;
  status: 'pass' | 'warning' | 'fail' | 'incomplete';
  source: string;
  completeness: Completeness;
  completenessReason: string;
  retainedExisting?: boolean;
  alternatives: Array<{ productId: string; name: string; reason: string }>;
  explanation?: EngineeringExplanation;
}

export interface SubsystemNote {
  id: string;
  title: string;
  status: 'done' | 'warning' | 'incomplete' | 'skipped';
  detail: string;
}

export interface DesignOption {
  id: 'minimal' | 'balanced' | 'premium';
  label: string;
  bullets: string[];
  room: RoomModel;
  seats: Seat[];
  tables: TableSpec[];
  racks?: AVRack[];
  equipment: EquipmentInstance[];
  connections: SystemConnection[];
  routes: SystemRoute[];
  picks: {
    display?: ProductPick;
    microphone?: ProductPick;
    speaker?: ProductPick;
    camera?: ProductPick;
  };
  validation: ValidationSummary;
  why: string[];
  topologyNotes: string[];
}

export interface DesignProposal {
  status: 'ok' | 'no_valid_design' | 'invalid_requirements';
  blockingReason?: string;
  requirementIssues: RequirementIssue[];
  requirements: DesignRequirements;
  stages: SubsystemNote[];
  options: DesignOption[];
  selectedOptionId: DesignOption['id'];
  existing: {
    room: boolean;
    seating: boolean;
    display: boolean;
    audio: boolean;
    microphones: boolean;
    camera: boolean;
    routing: boolean;
  };
  missing: string[];
  assistant: SubsystemNote[];
  spatialIssues: SpatialIssue[];
}

export interface ProjectDesignContext {
  room: RoomModel | null;
  seats: Seat[];
  tables: TableSpec[];
  equipment: EquipmentInstance[];
  connections: SystemConnection[];
  routes: SystemRoute[];
}

export interface CatalogProductRef {
  product: EquipmentProduct;
}
