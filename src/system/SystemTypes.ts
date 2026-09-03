/**
 * SystemTypes.ts
 * Device → Port → Connection graph. Not spatial simulation.
 * Catalog describes capability; project instances + connections describe the design.
 */

export type SignalType =
  | 'VIDEO'
  | 'AUDIO'
  | 'USB'
  | 'NETWORK'
  | 'CONTROL'
  | 'POWER'
  | 'SERIAL'
  | 'GPIO'
  | 'DANTE'
  | 'AES67'
  | 'SDI'
  | 'FIBER'
  | 'HDBASET';
export type PortDirection = 'input' | 'output' | 'bidirectional';
export type ConnectorId =
  | 'hdmi'
  | 'displayport'
  | 'usbc'
  | 'usb-a'
  | 'rj45'
  | 'xlr'
  | 'line-trs'
  | 'phoenix'
  | 'speakon'
  | 'dsub9'
  | 'bnc'
  | 'terminal-block';
export type TransportId =
  | 'hdmi'
  | 'displayport'
  | 'usb'
  | 'usb-c'
  | 'hdmi-over-cat'
  | 'analog-line'
  | 'analog-mic'
  | 'analog-speaker'
  | 'ethernet';
export type PhysicalMedium =
  | 'HDMI'
  | 'DisplayPort'
  | 'USB'
  | 'USB-C'
  | 'Cat6'
  | 'Cat6A'
  | 'Audio'
  | 'Speaker'
  | 'XLR'
  | 'TRS'
  | 'Fiber'
  | 'Control'
  | 'Power';

export type PortConnectionState = 'available' | 'connected' | 'reserved' | 'invalid';
export type ConnectionImportance = 'required' | 'optional' | 'recommended';

export interface PortDefinition {
  id: string;
  label: string;
  direction: PortDirection;
  signalTypes: SignalType[];
  connector: ConnectorId;
  transport?: TransportId;
  /** Optional engineering protocol (e.g. "Dante", "AES67", "NDI", "RS-232", "VISCA") */
  protocol?: string;
  required?: boolean;
  /** Catalog-only. Defaults to optional when omitted. */
  connectionImportance?: ConnectionImportance;
  /** Defaults to 1. Multi-drop only when the catalog declares it. */
  maxConnections?: number;
  /** Catalog note, e.g. PoE. Never invent electrical ratings. */
  capabilities?: string[];
}

export interface ResolvedPort extends PortDefinition {
  instanceId: string;
  productId: string;
  origin: 'catalog' | 'connectivity';
}

export type CablePathType = 'ceiling' | 'wall' | 'rack-internal' | 'direct';
export type CableRouteStatus = 'clear' | 'intersects-obstacle' | 'no-room';

export interface CableSegment {
  start: { x: number; y: number; z: number };
  end: { x: number; y: number; z: number };
  length: number;
}

/** Obstacle-aware polyline. Length is the sum of segments, not Euclidean. */
export interface CableRoute {
  connectionId: string;
  segments: CableSegment[];
  totalLength: number;
  pathType: CablePathType;
  status: CableRouteStatus;
  intersectingObstacleIds: string[];
}

export interface SystemConnection {
  id: string;
  /** Source device (authoritative). */
  fromInstanceId: string;
  fromPortId: string;
  toInstanceId: string;
  toPortId: string;
  signalType: SignalType;
  transport: TransportId;
  /** Catalog-derived cable/medium. Never invented (e.g. Cat6 vs Cat6A). */
  physicalMedium: PhysicalMedium;
  /** Same as physicalMedium unless a future catalog names a specific SKU. */
  cableType?: PhysicalMedium;
  /** Derived route. Recomputed from geometry; optional on disk. */
  route?: CableRoute;
  estimatedLengthM?: number;
}

export type CompatibilityOk = {
  ok: true;
  signalType: SignalType;
  transport: TransportId;
  physicalMedium: PhysicalMedium;
};

export type CompatibilityFailCode =
  | 'CONN-001'
  | 'CONN-002'
  | 'CONN-003'
  | 'CONN-004'
  | 'CONN-007'
  | 'SIGNAL-002'
  | 'SIGNAL-003'
  | 'SIGNAL-004'
  | 'SIGNAL-005'
  | 'SIGNAL-006';

export type CompatibilityFail = {
  ok: false;
  reason: string;
  code: CompatibilityFailCode;
};

export type CompatibilityResult = CompatibilityOk | CompatibilityFail;

export interface SignalPathHop {
  instanceId: string;
  portId: string;
  productId: string;
}

export interface SignalPath {
  id: string;
  signalType: SignalType;
  hops: SignalPathHop[];
  connectionIds: string[];
  complete: boolean;
  breakReason?: string;
}

export interface SystemRoute {
  instanceId: string;
  inputPortId: string;
  outputPortId: string;
}

export interface SystemGroup {
  id: string;
  name: string;
  memberIds: string[];
  collapsed: boolean;
}

export const SYSTEM_ROLE_CATEGORIES = [
  'source',
  'switcher',
  'extender',
  'dsp',
  'amplifier',
  'control',
  'network',
  'codec'
] as const;
