/**
 * Derived port/connection status. Does not duplicate the connection graph.
 */

import type { EquipmentCatalog, EquipmentInstance } from '../catalog/EquipmentCatalog';
import type { ValidationFinding } from '../av/validation/ValidationTypes';
import { resolveProductPorts } from './PortResolver';
import type {
  ConnectionImportance,
  PortConnectionState,
  PortDefinition,
  ResolvedPort,
  SystemConnection,
  SystemRoute
} from './SystemTypes';
import { canConnectPorts, maxConnectionsFor, portUseCount } from './PortCompatibility';
import { resolveInstancePorts } from './PortResolver';
import { enumerateSignalPaths } from './SignalPathEngine';

export function portConnectionRole(port: PortDefinition): ConnectionImportance {
  if (port.connectionImportance) return port.connectionImportance;
  if (port.required) return 'required';
  return 'optional';
}

export function portOccupancyState(port: ResolvedPort, connections: SystemConnection[]): PortConnectionState {
  const used = portUseCount(connections, port.instanceId, port.id);
  if (used <= 0) return 'available';
  if (used >= maxConnectionsFor(port)) return 'connected';
  return 'connected';
}

export function connectionEndpointStatus(
  connection: SystemConnection,
  equipment: EquipmentInstance[],
  catalog: EquipmentCatalog
): 'connected' | 'invalid' | 'unknown' {
  const fromEq = equipment.find((e) => e.instanceId === connection.fromInstanceId);
  const toEq = equipment.find((e) => e.instanceId === connection.toInstanceId);
  if (!fromEq || !toEq) return 'invalid';
  const fromProduct = catalog.get(fromEq.productId);
  const toProduct = catalog.get(toEq.productId);
  if (!fromProduct || !toProduct) return 'invalid';
  const fromIncomplete = resolveProductPorts(fromProduct).incomplete;
  const toIncomplete = resolveProductPorts(toProduct).incomplete;
  const from = resolveInstancePorts(fromEq.instanceId, fromEq.productId, catalog).find((p) => p.id === connection.fromPortId);
  const to = resolveInstancePorts(toEq.instanceId, toEq.productId, catalog).find((p) => p.id === connection.toPortId);
  if (!from || !to) return fromIncomplete || toIncomplete ? 'unknown' : 'invalid';
  return canConnectPorts(from, to).ok ? 'connected' : 'invalid';
}

export function deviceSignalFlowLines(
  instanceId: string,
  equipment: EquipmentInstance[],
  connections: SystemConnection[],
  catalog: EquipmentCatalog,
  routes: SystemRoute[]
): string[] {
  const linked = connections.filter((c) => c.fromInstanceId === instanceId || c.toInstanceId === instanceId);
  const lines: string[] = [];
  linked.forEach((c) => {
    const otherId = c.fromInstanceId === instanceId ? c.toInstanceId : c.fromInstanceId;
    const other = equipment.find((e) => e.instanceId === otherId);
    const dir = c.fromInstanceId === instanceId ? '→' : '←';
    lines.push(`${c.signalType} ${dir} ${other?.name ?? otherId} (${c.physicalMedium})`);
  });
  enumerateSignalPaths(equipment, connections, catalog, routes)
    .filter((p) => p.hops.some((h) => h.instanceId === instanceId))
    .slice(0, 3)
    .forEach((p) => {
      const names = p.hops
        .map((h) => equipment.find((e) => e.instanceId === h.instanceId)?.name ?? h.instanceId)
        .join(' → ');
      lines.push(`${p.signalType} path: ${names}${p.complete ? '' : ' (incomplete)'}`);
    });
  return lines;
}

export function systemCompletenessFromFindings(
  findings: ValidationFinding[],
  equipment: EquipmentInstance[],
  catalog: EquipmentCatalog
): Array<{ mark: 'ok' | 'warn' | 'err' | 'idle'; label: string }> {
  const has = (cat: string) => equipment.some((e) => catalog.get(e.productId)?.category === cat);
  const codes = new Set(findings.map((f) => f.code));
  const items: Array<{ mark: 'ok' | 'warn' | 'err' | 'idle'; label: string }> = [];
  if (has('display')) {
    items.push({
      mark: codes.has('SYSTEM-003') ? 'warn' : 'ok',
      label: codes.has('SYSTEM-003') ? 'Display video connection missing' : 'Display connected or optional ports unused'
    });
  }
  if (has('camera')) {
    const camIssue = findings.some(
      (f) => f.objectId && equipment.some((e) => e.instanceId === f.objectId && catalog.get(e.productId)?.category === 'camera') && (f.code === 'CONN-006' || f.code === 'SIGNAL-007')
    );
    items.push({ mark: camIssue ? 'warn' : 'ok', label: camIssue ? 'Camera required port unconnected' : 'Camera in system' });
  }
  if (has('microphone')) {
    const micIssue = findings.some(
      (f) =>
        f.objectId &&
        equipment.some((e) => e.instanceId === f.objectId && catalog.get(e.productId)?.category === 'microphone') &&
        (f.code === 'CONN-006' || f.code === 'SIGNAL-007')
    );
    items.push({ mark: micIssue ? 'warn' : 'ok', label: micIssue ? 'Microphone required port unconnected' : 'Microphone in system' });
  }
  if (has('speaker')) {
    const ampMissing = codes.has('SYSTEM-004');
    items.push({
      mark: ampMissing ? 'err' : 'ok',
      label: ampMissing ? 'Speaker amplifier connection missing' : 'Speaker topology'
    });
  }
  const netIssue = findings.some((f) => (f.code === 'CONN-006' || f.code === 'SIGNAL-007') && f.message.toLowerCase().includes('network'));
  if (has('network') || has('codec') || has('dsp') || has('control')) {
    items.push({
      mark: netIssue ? 'warn' : 'idle',
      label: netIssue ? 'Required network port unconnected' : 'Network follows catalog (optional unless required)'
    });
  }
  const invalid = findings.filter((f) => ['CONN-001', 'CONN-002', 'CONN-003', 'CONN-004', 'CONN-005', 'CONN-007'].includes(f.code));
  if (invalid.length) {
    items.push({ mark: 'err', label: `${invalid.length} invalid connection${invalid.length === 1 ? '' : 's'}` });
  }
  return items;
}
