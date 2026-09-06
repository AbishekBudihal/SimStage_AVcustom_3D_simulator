import { EquipmentCategory } from '../catalog/EquipmentCatalog';
import { SignalType, ConnectorId, TransportId, PhysicalMedium, PortDirection } from '../system/SystemTypes';

export interface SchematicNodePort {
  id: string;
  label: string;
  direction: PortDirection;
  signalTypes: SignalType[];
  connector: ConnectorId;
  transport?: TransportId;
  protocol?: string;
  maxConnections?: number;
}

export interface SchematicBOM {
  partNumber?: string;
  unitCost?: number;
  supplier?: string;
  quantity: number;
}

/**
 * Represents an abstract or physical node in a schematic graph.
 */
export interface SchematicNode {
  id: string;
  label: string;
  category: EquipmentCategory;
  productId?: string;
  manufacturer?: string;
  model?: string;
  position2D: { x: number; y: number };
  ports: SchematicNodePort[];
  rackMountable?: boolean;
  ruHeight?: number;
  mountingPreference?: 'wall' | 'ceiling' | 'rack' | 'table' | 'freestanding';
  powerWatts?: number;
  poeClass?: string;
  bom?: SchematicBOM;
}

/**
 * Represents a connection between two nodes in a schematic graph.
 */
export interface SchematicLink {
  id: string;
  fromNodeId: string;
  fromPortId: string;
  toNodeId: string;
  toPortId: string;
  signalType: SignalType;
  transport?: TransportId;
  physicalMedium?: PhysicalMedium;
  cableType?: string;
  lengthM?: number;
  protocol?: string;
  notes?: string;
}

export interface SchematicMetadata {
  title: string;
  designer?: string;
  revision?: string;
  projectCode?: string;
  targetRoom?: { widthM: number; depthM: number; heightM: number };
}

/**
 * A graph representing the entire logical schematic.
 */
export interface SchematicGraph {
  metadata: SchematicMetadata;
  nodes: SchematicNode[];
  links: SchematicLink[];
}

export type SchematicIssueSeverity = 'error' | 'warning' | 'info';

export type SchematicIssueCode =
  | 'SCHEMA-001'
  | 'SCHEMA-002'
  | 'SIGNAL-MISMATCH'
  | 'PORT-MISSING'
  | 'DIRECTION-MISMATCH'
  | 'CONNECTOR-MISMATCH'
  | 'LOOP-DETECTED'
  | 'DANGLING-NODE'
  | 'INCOMPLETE-CHAIN'
  | 'POWER-OVERLOAD'
  | 'DUPLICATE-ID'
  | 'MULTI-DROP';

export interface SchematicIssue {
  code: SchematicIssueCode;
  severity: SchematicIssueSeverity;
  message: string;
  affectedNodeIds: string[];
  affectedLinkIds: string[];
}

export interface PowerSummary {
  totalWatts: number;
  poeDeviceCount: number;
  poeTotalWatts: number;
  acDeviceCount: number;
}

export interface SchematicValidationResult {
  valid: boolean;
  issues: SchematicIssue[];
  powerSummary: PowerSummary;
  signalChainCount: number;
  danglingNodeCount: number;
}

export interface Placement3DTarget {
  nodeId: string;
  position: { x: number; y: number; z: number };
  rotationY: number;
  wall?: 'front' | 'back' | 'left' | 'right';
  mountingKind: 'wall' | 'ceiling' | 'rack' | 'table' | 'floor' | 'freestanding';
  rackId?: string;
  rackPositionRU?: number;
}

export interface AnalyzedSchematicPayload {
  graph: SchematicGraph;
  validation: SchematicValidationResult;
  placements: Placement3DTarget[];
  rackRequired: boolean;
  rackKind?: 'floor' | 'wall';
  totalRU: number;
  cableManifest: Array<{ linkId: string; cableId: string; medium: PhysicalMedium; estimatedLengthM: number }>;
}
