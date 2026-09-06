/**
 * PortCompatibility.ts
 * Connection validity from catalog ports. No invented adapters.
 * Conversion (HDMI → HDBaseT → HDMI) is device hops, not a single mixed-connector cable.
 */

import type { EquipmentCatalog } from '../catalog/EquipmentCatalog';
import type { CompatibilityResult, PhysicalMedium, ResolvedPort, SystemConnection, TransportId } from './SystemTypes';
import { resolveInstancePorts } from './PortResolver';
import type { PortDefinition } from './SystemTypes';

export function maxConnectionsFor(port: PortDefinition): number {
  return port.maxConnections && port.maxConnections > 1 ? port.maxConnections : 1;
}

export function portByIds(
  catalog: EquipmentCatalog,
  instanceId: string,
  productId: string,
  portId: string
): ResolvedPort | undefined {
  return resolveInstancePorts(instanceId, productId, catalog).find((p) => p.id === portId);
}

export function canConnectPorts(from: ResolvedPort, to: ResolvedPort): CompatibilityResult {
  if (from.instanceId === to.instanceId && from.id === to.id) {
    return { ok: false, code: 'CONN-001', reason: 'A port cannot connect to itself.' };
  }
  if (from.instanceId === to.instanceId) {
    return { ok: false, code: 'CONN-001', reason: 'Internal device routing is not drawn as a cable. Use the routing matrix.' };
  }
  const fromOut = from.direction === 'output' || from.direction === 'bidirectional';
  const toIn = to.direction === 'input' || to.direction === 'bidirectional';
  if (!fromOut || !toIn) {
    return {
      ok: false,
      code: 'CONN-001',
      reason: `${from.direction.toUpperCase()} cannot connect to ${to.direction.toUpperCase()}.`
    };
  }
  const signals = from.signalTypes.filter((s) => to.signalTypes.includes(s));
  if (!signals.length) {
    return {
      ok: false,
      code: 'CONN-002',
      reason: `${from.signalTypes.join('/')} output cannot connect to ${to.signalTypes.join('/')} input.`
    };
  }
  if (from.connector !== to.connector) {
    return {
      ok: false,
      code: 'CONN-003',
      reason: `Connector mismatch: ${from.connector} cannot connect to ${to.connector}.`
    };
  }
  if (from.transport && to.transport && from.transport !== to.transport) {
    return {
      ok: false,
      code: 'CONN-003',
      reason: `Unsupported transport: ${from.transport} cannot connect to ${to.transport}.`
    };
  }
  if (from.protocol && to.protocol) {
    const protoCheck = checkProtocolCompatibility(from, to);
    if (!protoCheck.ok) {
      return {
        ok: false,
        code: 'CONN-011',
        reason: protoCheck.reason ?? `Protocol mismatch: ${from.protocol} cannot connect to ${to.protocol}.`
      };
    }
  }
  const transport: TransportId = from.transport ?? to.transport ?? inferTransport(from.connector);
  return {
    ok: true,
    signalType: signals[0],
    transport,
    physicalMedium: mediumFor(transport, from.connector)
  };
}

export function cableMediumCompatible(expected: PhysicalMedium, cable?: PhysicalMedium): boolean {
  if (!cable || cable === expected) return true;
  const cat = cable === 'Cat6' || cable === 'Cat6A';
  const exp = expected === 'Cat6' || expected === 'Cat6A';
  return cat && exp;
}

export function canConnectWithCable(
  from: ResolvedPort,
  to: ResolvedPort,
  cableType?: PhysicalMedium
): CompatibilityResult {
  const base = canConnectPorts(from, to);
  if (!base.ok) return base;
  if (cableType && !cableMediumCompatible(base.physicalMedium, cableType)) {
    return {
      ok: false,
      code: 'CONN-007',
      reason: `Cable ${cableType} is not catalog-compatible with ${base.physicalMedium} (${from.connector}).`
    };
  }
  return base;
}

export function portUseCount(connections: SystemConnection[], instanceId: string, portId: string): number {
  return connections.filter(
    (c) =>
      (c.fromInstanceId === instanceId && c.fromPortId === portId) ||
      (c.toInstanceId === instanceId && c.toPortId === portId)
  ).length;
}

export function occupancyConflict(
  connections: SystemConnection[],
  fromInstanceId: string,
  fromPortId: string,
  toInstanceId: string,
  toPortId: string,
  limits?: { fromMax?: number; toMax?: number }
): string | null {
  const fromMax = limits?.fromMax && limits.fromMax > 1 ? limits.fromMax : 1;
  const toMax = limits?.toMax && limits.toMax > 1 ? limits.toMax : 1;
  if (portUseCount(connections, fromInstanceId, fromPortId) >= fromMax) return 'Source port is already occupied.';
  if (portUseCount(connections, toInstanceId, toPortId) >= toMax) return 'Destination port is already occupied.';
  return null;
}

export function duplicateConnection(
  connections: SystemConnection[],
  fromInstanceId: string,
  fromPortId: string,
  toInstanceId: string,
  toPortId: string
): boolean {
  return connections.some(
    (c) =>
      c.fromInstanceId === fromInstanceId &&
      c.fromPortId === fromPortId &&
      c.toInstanceId === toInstanceId &&
      c.toPortId === toPortId
  );
}

export function compatibleSources(
  to: ResolvedPort,
  candidates: ResolvedPort[],
  connections: SystemConnection[]
): ResolvedPort[] {
  return candidates.filter((from) => {
    if (from.instanceId === to.instanceId) return false;
    if (!canConnectPorts(from, to).ok) return false;
    if (
      occupancyConflict(connections, from.instanceId, from.id, to.instanceId, to.id, {
        fromMax: maxConnectionsFor(from),
        toMax: maxConnectionsFor(to)
      })
    ) {
      return false;
    }
    return true;
  });
}

export function compatibleDestinations(
  from: ResolvedPort,
  candidates: ResolvedPort[],
  connections: SystemConnection[]
): ResolvedPort[] {
  return candidates.filter((to) => {
    if (to.instanceId === from.instanceId) return false;
    if (!canConnectPorts(from, to).ok) return false;
    if (
      occupancyConflict(connections, from.instanceId, from.id, to.instanceId, to.id, {
        fromMax: maxConnectionsFor(from),
        toMax: maxConnectionsFor(to)
      })
    ) {
      return false;
    }
    return true;
  });
}

function inferTransport(connector: ResolvedPort['connector']): TransportId {
  switch (connector) {
    case 'hdmi':
      return 'hdmi';
    case 'displayport':
      return 'displayport';
    case 'usbc':
      return 'usb-c';
    case 'usb-a':
      return 'usb';
    case 'rj45':
      return 'ethernet';
    case 'xlr':
      return 'analog-mic';
    case 'line-trs':
      return 'analog-line';
    case 'phoenix':
    case 'speakon':
      return 'analog-speaker';
    default:
      return 'hdmi';
  }
}

function mediumFor(transport: TransportId, connector: ResolvedPort['connector']): PhysicalMedium {
  if (transport === 'hdmi-over-cat' || connector === 'rj45') return 'Cat6';
  if (connector === 'hdmi') return 'HDMI';
  if (connector === 'displayport') return 'DisplayPort';
  if (connector === 'usbc') return 'USB-C';
  if (connector === 'usb-a') return 'USB';
  if (connector === 'speakon' || connector === 'phoenix') return 'Speaker';
  return 'Audio';
}

/**
 * Validates protocol interoperability between two digital ports.
 */
export function checkProtocolCompatibility(
  from: ResolvedPort,
  to: ResolvedPort
): { ok: boolean; reason?: string } {
  if (!from.protocol || !to.protocol) return { ok: true };
  const p1 = from.protocol.trim().toLowerCase();
  const p2 = to.protocol.trim().toLowerCase();
  if (p1 === p2) return { ok: true };

  // Audio-over-IP network interop (Dante, AES67, Ravenna)
  const isAoIP1 = p1 === 'dante' || p1 === 'aes67' || p1 === 'ravenna';
  const isAoIP2 = p2 === 'dante' || p2 === 'aes67' || p2 === 'ravenna';
  if (isAoIP1 && isAoIP2) {
    return { ok: true };
  }

  // Serial & camera control cross-connection checks
  const isSerial1 = p1 === 'rs-232' || p1 === 'rs-422' || p1 === 'rs-485' || p1 === 'visca';
  const isSerial2 = p2 === 'rs-232' || p2 === 'rs-422' || p2 === 'rs-485' || p2 === 'visca';
  if (isSerial1 !== isSerial2) {
    return {
      ok: false,
      reason: `Protocol conflict: ${from.protocol} control interface cannot communicate with ${to.protocol} stream.`
    };
  }

  return {
    ok: false,
    reason: `Incompatible protocols: ${from.protocol} cannot interoperate with ${to.protocol}.`
  };
}

export interface BandwidthCheckResult {
  ok: boolean;
  bottleneck: boolean;
  sourceGbps?: number;
  destGbps?: number;
  message?: string;
}

/**
 * Checks for bandwidth bottlenecks where a source transmitter exceeds destination capacity.
 */
export function checkBandwidthCompatibility(
  from: ResolvedPort,
  to: ResolvedPort
): BandwidthCheckResult {
  const fromBw = from.bandwidthGbps;
  const toBw = to.bandwidthGbps;

  if (fromBw == null || toBw == null) {
    return { ok: true, bottleneck: false, sourceGbps: fromBw, destGbps: toBw };
  }

  if (fromBw > toBw) {
    return {
      ok: true,
      bottleneck: true,
      sourceGbps: fromBw,
      destGbps: toBw,
      message: `Bandwidth bottleneck: Source outputs up to ${fromBw} Gbps, but destination supports only ${toBw} Gbps. Signal may downsample or fail at high resolutions.`
    };
  }

  return { ok: true, bottleneck: false, sourceGbps: fromBw, destGbps: toBw };
}

export interface PoeCheckResult {
  ok: boolean;
  isPoeLink: boolean;
  pdPort?: ResolvedPort;
  psePort?: ResolvedPort;
  requiredWatts?: number;
  availableWatts?: number;
  message?: string;
}

/**
 * Checks PoE supply versus consumer demand on a link.
 */
export function checkPoeCompatibility(
  from: ResolvedPort,
  to: ResolvedPort
): PoeCheckResult {
  const isPd = (p: ResolvedPort) =>
    (p.poeRequirementWatts != null && p.poeRequirementWatts > 0) ||
    p.capabilities?.some((c) => c.toLowerCase().includes('poe pd'));
  const isPse = (p: ResolvedPort) =>
    (p.poeBudgetWatts != null && p.poeBudgetWatts > 0) ||
    p.capabilities?.some((c) => c.toLowerCase().includes('pse') || c.toLowerCase().includes('poe+'));

  const fromPd = isPd(from);
  const toPd = isPd(to);
  const fromPse = isPse(from);
  const toPse = isPse(to);

  if (!fromPd && !toPd) {
    return { ok: true, isPoeLink: false };
  }

  const pdPort = toPd ? to : from;
  const psePort = fromPse ? from : (toPse ? to : undefined);
  const requiredWatts = pdPort.poeRequirementWatts ?? 15.4;

  if (!psePort) {
    return {
      ok: false,
      isPoeLink: true,
      pdPort,
      requiredWatts,
      message: `Port "${pdPort.label}" requires PoE (${requiredWatts}W), but connected endpoint does not supply PoE power.`
    };
  }

  const availableWatts = psePort.poeBudgetWatts;
  if (availableWatts != null && availableWatts < requiredWatts) {
    return {
      ok: false,
      isPoeLink: true,
      pdPort,
      psePort,
      requiredWatts,
      availableWatts,
      message: `PoE port capacity insufficient: connected device requires ${requiredWatts}W but port supplies max ${availableWatts}W.`
    };
  }

  return {
    ok: true,
    isPoeLink: true,
    pdPort,
    psePort,
    requiredWatts,
    availableWatts
  };
}
