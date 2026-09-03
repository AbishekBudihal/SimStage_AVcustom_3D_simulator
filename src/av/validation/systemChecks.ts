/**
 * systemChecks.ts
 * Topology checks. Spatial engines are not used here.
 * Completeness checks run only when a system graph exists
 * (a connection or a system-role device). Spatial-only rooms stay quiet.
 */

import type { ProjectValidationContext } from './ValidationContext';
import type { ValidationCheck, ValidationFinding } from './ValidationTypes';
import { SYSTEM_ROLE_CATEGORIES } from '../../system/SystemTypes';
import { resolveInstancePorts, resolveProductPorts } from '../../system/PortResolver';
import { canConnectPorts, canConnectWithCable, maxConnectionsFor, occupancyConflict } from '../../system/PortCompatibility';
import { portConnectionRole } from '../../system/ConnectionStatus';
import { enumerateSignalPaths } from '../../system/SignalPathEngine';
import { cachedCableRoute, type CableRouteContext } from '../../system/CableRouter';
import { cableTypeOf } from '../../system/CableBoq';

function finding(
  partial: Omit<ValidationFinding, 'affectedObjects' | 'recommendedActions' | 'potentialVariables'> & {
    affectedObjects?: ValidationFinding['affectedObjects'];
    recommendedActions?: string[];
    potentialVariables?: string[];
  }
): ValidationFinding {
  return {
    affectedObjects: [],
    recommendedActions: [],
    potentialVariables: [],
    ...partial
  };
}

function systemGraphActive(ctx: ProjectValidationContext): boolean {
  if (ctx.connections.length > 0) return true;
  return ctx.equipment.some((e) => {
    const cat = ctx.catalog.get(e.productId)?.category;
    return !!cat && (SYSTEM_ROLE_CATEGORIES as readonly string[]).includes(cat);
  });
}

export const checkSignalDirection: ValidationCheck = {
  code: 'SIGNAL-002',
  category: 'system',
  title: 'Connection direction',
  evaluate(ctx): ValidationFinding[] {
    const out: ValidationFinding[] = [];
    for (const c of ctx.connections) {
      const fromEq = ctx.equipment.find((e) => e.instanceId === c.fromInstanceId);
      const toEq = ctx.equipment.find((e) => e.instanceId === c.toInstanceId);
      if (!fromEq || !toEq) continue;
      const from = resolveInstancePorts(fromEq.instanceId, fromEq.productId, ctx.catalog).find((p) => p.id === c.fromPortId);
      const to = resolveInstancePorts(toEq.instanceId, toEq.productId, ctx.catalog).find((p) => p.id === c.toPortId);
      if (!from || !to) continue;
      const r = canConnectPorts(from, to);
      if (!r.ok) {
        out.push(
          finding({
            id: `${r.code}-${c.id}`,
            code: r.code,
            severity: 'error',
            category: 'system',
            title: 'Invalid connection',
            message: r.reason,
            explanation: 'Connections must join compatible catalog ports (direction, signal, connector, transport).',
            objectId: fromEq.instanceId,
            affectedObjects: [
              { kind: 'equipment', id: fromEq.instanceId, label: fromEq.name },
              { kind: 'equipment', id: toEq.instanceId, label: toEq.name }
            ],
            source: 'PortCompatibility'
          })
        );
      }
    }
    return out;
  }
};

export const checkOccupiedPorts: ValidationCheck = {
  code: 'SIGNAL-006',
  category: 'system',
  title: 'Port occupancy',
  evaluate(ctx): ValidationFinding[] {
    const out: ValidationFinding[] = [];
    ctx.connections.forEach((c, i) => {
      const others = ctx.connections.filter((_, j) => j !== i);
      const fromEq = ctx.equipment.find((e) => e.instanceId === c.fromInstanceId);
      const toEq = ctx.equipment.find((e) => e.instanceId === c.toInstanceId);
      const from = fromEq
        ? resolveInstancePorts(fromEq.instanceId, fromEq.productId, ctx.catalog).find((p) => p.id === c.fromPortId)
        : undefined;
      const to = toEq
        ? resolveInstancePorts(toEq.instanceId, toEq.productId, ctx.catalog).find((p) => p.id === c.toPortId)
        : undefined;
      const conflict = occupancyConflict(others, c.fromInstanceId, c.fromPortId, c.toInstanceId, c.toPortId, {
        fromMax: from ? maxConnectionsFor(from) : 1,
        toMax: to ? maxConnectionsFor(to) : 1
      });
      if (conflict) {
        out.push(
          finding({
            id: `CONN-004-${c.id}`,
            code: 'CONN-004',
            severity: 'error',
            category: 'system',
            title: 'Port already occupied',
            message: conflict,
            explanation: 'Each catalog port accepts one connection unless the catalog declares otherwise (it does not).',
            objectId: c.fromInstanceId,
            affectedObjects: [{ kind: 'equipment', id: c.fromInstanceId, label: c.fromInstanceId }],
            source: 'PortCompatibility.occupancy'
          })
        );
      }
    });
    return out;
  }
};

export const checkRequiredPorts: ValidationCheck = {
  code: 'SIGNAL-007',
  category: 'system',
  title: 'Required ports',
  evaluate(ctx): ValidationFinding[] {
    if (!systemGraphActive(ctx)) return [];
    const out: ValidationFinding[] = [];
    for (const inst of ctx.equipment) {
      const ports = resolveInstancePorts(inst.instanceId, inst.productId, ctx.catalog);
      for (const p of ports) {
        const role = portConnectionRole(p);
        if (role === 'optional') continue;
        const used = ctx.connections.some(
          (c) =>
            (c.fromInstanceId === inst.instanceId && c.fromPortId === p.id) ||
            (c.toInstanceId === inst.instanceId && c.toPortId === p.id)
        );
        if (!used) {
          out.push(
            finding({
              id: `CONN-006-${inst.instanceId}-${p.id}`,
              code: 'CONN-006',
              severity: role === 'recommended' ? 'info' : 'warning',
              category: 'system',
              title: role === 'recommended' ? 'Recommended port unconnected' : 'Required port unconnected',
              message: `${inst.name}: ${p.label} is catalog-${role} and has no connection.`,
              explanation: 'Required is a catalog flag, not an invented room rule.',
              objectId: inst.instanceId,
              affectedObjects: [{ kind: 'equipment', id: inst.instanceId, label: inst.name }],
              recommendedActions: ['Connect a compatible port in System view'],
              source: 'PortDefinition.required'
            })
          );
        }
      }
    }
    return out;
  }
};

export const checkPortsIncomplete: ValidationCheck = {
  code: 'SIGNAL-001',
  category: 'system',
  title: 'Port data',
  evaluate(ctx): ValidationFinding[] {
    if (!systemGraphActive(ctx)) return [];
    const out: ValidationFinding[] = [];
    for (const inst of ctx.equipment) {
      const product = ctx.catalog.get(inst.productId);
      if (!product) continue;
      const { incomplete } = resolveProductPorts(product);
      if (!incomplete) continue;
      const role = (SYSTEM_ROLE_CATEGORIES as readonly string[]).includes(product.category);
      if (!role) continue;
      out.push(
        finding({
          id: `SIGNAL-001-${inst.instanceId}`,
          code: 'SIGNAL-001',
          severity: 'warning',
          category: 'system',
          title: 'DATA INCOMPLETE — ports',
          message: `${inst.name} has no catalog ports or connectivity. System connections cannot be validated.`,
          explanation: 'Do not invent HDMI/USB/network. Add ports in the catalog.',
          objectId: inst.instanceId,
          affectedObjects: [{ kind: 'equipment', id: inst.instanceId, label: inst.name }],
          recommendedActions: ['Edit Catalog — add PortDefinition[]'],
          source: 'PortResolver'
        })
      );
    }
    return out;
  }
};

export const checkSourceDestination: ValidationCheck = {
  code: 'SYSTEM-002',
  category: 'system',
  title: 'Source / destination',
  evaluate(ctx): ValidationFinding[] {
    if (!systemGraphActive(ctx)) return [];
    const out: ValidationFinding[] = [];
    for (const inst of ctx.equipment) {
      const product = ctx.catalog.get(inst.productId);
      if (product?.category !== 'source') continue;
      const hasOut = ctx.connections.some((c) => c.fromInstanceId === inst.instanceId);
      if (!hasOut) {
        out.push(
          finding({
            id: `SYSTEM-002-${inst.instanceId}`,
            code: 'SYSTEM-002',
            severity: 'warning',
            category: 'system',
            title: 'Source has no destination',
            message: `${inst.name} has no outgoing connection.`,
            explanation: 'A source is present in the system graph but is not driving any input.',
            objectId: inst.instanceId,
            affectedObjects: [{ kind: 'equipment', id: inst.instanceId, label: inst.name }],
            source: 'System topology'
          })
        );
      }
    }
    return out;
  }
};

export const checkPassiveSpeakerPath: ValidationCheck = {
  code: 'SYSTEM-004',
  category: 'system',
  title: 'Passive speaker amplification',
  evaluate(ctx): ValidationFinding[] {
    const hasAmp = ctx.equipment.some((e) => ctx.catalog.get(e.productId)?.category === 'amplifier');
    if (!hasAmp && ctx.connections.length === 0) return [];
    const out: ValidationFinding[] = [];
    for (const inst of ctx.equipment) {
      const product = ctx.catalog.get(inst.productId);
      if (product?.category !== 'speaker') continue;
      if (product.speaker?.powerClass == null) {
        if (hasAmp) {
          out.push(
            finding({
              id: `SYSTEM-004-inc-${inst.instanceId}`,
              code: 'SYSTEM-004',
              severity: 'warning',
              category: 'system',
              title: 'DATA INCOMPLETE — speaker class',
              message: `${inst.name} has no catalog powerClass (active/passive). Amplifier requirement is unknown.`,
              explanation: 'Do not assume every loudspeaker needs an amplifier.',
              objectId: inst.instanceId,
              affectedObjects: [{ kind: 'equipment', id: inst.instanceId, label: inst.name }],
              recommendedActions: ['Edit Catalog — set speaker.powerClass'],
              source: 'EquipmentCatalog.speaker.powerClass'
            })
          );
        }
        continue;
      }
      if (product.speaker.powerClass !== 'passive') continue;
      const paths = enumerateSignalPaths(ctx.equipment, ctx.connections, ctx.catalog, ctx.routes);
      const fed = paths.some(
        (p) =>
          p.signalType === 'AUDIO' &&
          p.hops.some((h) => h.instanceId === inst.instanceId) &&
          p.hops.some((h) => ctx.catalog.get(h.productId)?.category === 'amplifier')
      );
      if (!fed) {
        out.push(
          finding({
            id: `SYSTEM-004-${inst.instanceId}`,
            code: 'SYSTEM-004',
            severity: 'error',
            category: 'system',
            title: 'Passive speaker has no amplifier path',
            message: `${inst.name} is catalog-passive and has no AUDIO path from an amplifier.`,
            explanation: 'Spatial SPL still uses SpeakerCoverageEngine. This check is topology only.',
            objectId: inst.instanceId,
            affectedObjects: [{ kind: 'equipment', id: inst.instanceId, label: inst.name }],
            recommendedActions: ['Add an amplifier and connect SPEAKER OUT to the speaker input'],
            source: 'SignalPathEngine + speaker.powerClass'
          })
        );
      }
    }
    return out;
  }
};

export const checkIncompletePath: ValidationCheck = {
  code: 'SYSTEM-001',
  category: 'system',
  title: 'Incomplete signal path',
  evaluate(ctx): ValidationFinding[] {
    if (!systemGraphActive(ctx)) return [];
    const paths = enumerateSignalPaths(ctx.equipment, ctx.connections, ctx.catalog, ctx.routes);
    return paths
      .filter((p) => !p.complete)
      .map((p) => {
        const last = p.hops[p.hops.length - 1];
        const inst = ctx.equipment.find((e) => e.instanceId === last.instanceId);
        return finding({
          id: `SYSTEM-001-${p.id}`,
          code: 'SYSTEM-001',
          severity: 'error',
          category: 'system',
          title: 'Signal path incomplete',
          message: p.breakReason ?? 'Path ends before an endpoint.',
          explanation: 'A forwarding device has no continuing connection or matrix route.',
          objectId: last.instanceId,
          affectedObjects: inst ? [{ kind: 'equipment', id: inst.instanceId, label: inst.name }] : [],
          recommendedActions: ['Connect the unused output or set a switcher route'],
          source: 'SignalPathEngine'
        });
      });
  }
};

export const checkDestinationSource: ValidationCheck = {
  code: 'SYSTEM-003',
  category: 'system',
  title: 'Destination has no source',
  evaluate(ctx): ValidationFinding[] {
    if (!systemGraphActive(ctx)) return [];
    const out: ValidationFinding[] = [];
    for (const inst of ctx.equipment) {
      const product = ctx.catalog.get(inst.productId);
      if (product?.category !== 'display') continue;
      const ports = resolveInstancePorts(inst.instanceId, inst.productId, ctx.catalog).filter((p) => p.direction === 'input');
      if (!ports.length) continue;
      const fed = ports.some((p) => ctx.connections.some((c) => c.toInstanceId === inst.instanceId && c.toPortId === p.id));
      if (!fed) {
        out.push(
          finding({
            id: `SYSTEM-003-${inst.instanceId}`,
            code: 'SYSTEM-003',
            severity: 'warning',
            category: 'system',
            title: 'Destination has no valid source',
            message: `${inst.name} has no incoming video connection.`,
            explanation: 'Display HDMI inputs are catalog-declared. No source is attached.',
            objectId: inst.instanceId,
            affectedObjects: [{ kind: 'equipment', id: inst.instanceId, label: inst.name }],
            source: 'System topology'
          })
        );
      }
    }
    return out;
  }
};

export const checkAmpSpeakerOut: ValidationCheck = {
  code: 'SYSTEM-005',
  category: 'system',
  title: 'Amplifier output unused',
  evaluate(ctx): ValidationFinding[] {
    if (!ctx.equipment.some((e) => ctx.catalog.get(e.productId)?.category === 'speaker')) return [];
    const out: ValidationFinding[] = [];
    for (const inst of ctx.equipment) {
      if (ctx.catalog.get(inst.productId)?.category !== 'amplifier') continue;
      const outs = resolveInstancePorts(inst.instanceId, inst.productId, ctx.catalog).filter(
        (p) => p.direction === 'output' && p.signalTypes.includes('AUDIO') && p.required
      );
      for (const p of outs) {
        const used = ctx.connections.some((c) => c.fromInstanceId === inst.instanceId && c.fromPortId === p.id);
        if (!used) {
          out.push(
            finding({
              id: `SYSTEM-005-${inst.instanceId}-${p.id}`,
              code: 'SYSTEM-005',
              severity: 'warning',
              category: 'system',
              title: 'Amplifier output has no speaker',
              message: `${inst.name} ${p.label} is not connected to a speaker.`,
              explanation: 'Catalog-required amplifier speaker outputs should feed a compatible speaker input.',
              objectId: inst.instanceId,
              affectedObjects: [{ kind: 'equipment', id: inst.instanceId, label: inst.name }],
              source: 'PortDefinition.required'
            })
          );
        }
      }
    }
    return out;
  }
};

function routeCtx(ctx: ProjectValidationContext): CableRouteContext {
  return {
    room: ctx.room,
    equipment: ctx.equipment,
    tables: ctx.tables,
    seats: ctx.seats,
    racks: ctx.racks,
    portOf: (instanceId, portId) => {
      const inst = ctx.equipment.find((e) => e.instanceId === instanceId);
      if (!inst) return undefined;
      return resolveInstancePorts(inst.instanceId, inst.productId, ctx.catalog).find((p) => p.id === portId);
    }
  };
}

export const checkConnMissingEndpoint: ValidationCheck = {
  code: 'CONN-005',
  category: 'system',
  title: 'Connection endpoint missing',
  evaluate(ctx): ValidationFinding[] {
    const out: ValidationFinding[] = [];
    for (const c of ctx.connections) {
      const fromEq = ctx.equipment.find((e) => e.instanceId === c.fromInstanceId);
      const toEq = ctx.equipment.find((e) => e.instanceId === c.toInstanceId);
      const from = fromEq
        ? resolveInstancePorts(fromEq.instanceId, fromEq.productId, ctx.catalog).find((p) => p.id === c.fromPortId)
        : undefined;
      const to = toEq
        ? resolveInstancePorts(toEq.instanceId, toEq.productId, ctx.catalog).find((p) => p.id === c.toPortId)
        : undefined;
      if (fromEq && toEq && from && to) continue;
      out.push(
        finding({
          id: `CONN-005-${c.id}`,
          code: 'CONN-005',
          severity: 'error',
          category: 'system',
          title: 'Connection references missing device/port',
          message: `${c.fromInstanceId}.${c.fromPortId} → ${c.toInstanceId}.${c.toPortId} is incomplete.`,
          explanation: 'The connection graph must name devices and catalog ports that exist in the project.',
          objectId: c.fromInstanceId,
          source: 'SystemConnection'
        })
      );
    }
    return out;
  }
};

export const checkConnCableType: ValidationCheck = {
  code: 'CONN-007',
  category: 'system',
  title: 'Cable type',
  evaluate(ctx): ValidationFinding[] {
    const out: ValidationFinding[] = [];
    for (const c of ctx.connections) {
      const fromEq = ctx.equipment.find((e) => e.instanceId === c.fromInstanceId);
      const toEq = ctx.equipment.find((e) => e.instanceId === c.toInstanceId);
      if (!fromEq || !toEq) continue;
      const from = resolveInstancePorts(fromEq.instanceId, fromEq.productId, ctx.catalog).find((p) => p.id === c.fromPortId);
      const to = resolveInstancePorts(toEq.instanceId, toEq.productId, ctx.catalog).find((p) => p.id === c.toPortId);
      if (!from || !to) continue;
      const r = canConnectWithCable(from, to, cableTypeOf(c));
      if (!r.ok && r.code === 'CONN-007') {
        out.push(
          finding({
            id: `CONN-007-${c.id}`,
            code: 'CONN-007',
            severity: 'error',
            category: 'system',
            title: 'Invalid cable type',
            message: r.reason,
            explanation: 'Cable type is independent of connector name. HDMI-over-Cat uses Cat cable on the extender hop.',
            objectId: fromEq.instanceId,
            affectedObjects: [
              { kind: 'equipment', id: fromEq.instanceId, label: fromEq.name },
              { kind: 'equipment', id: toEq.instanceId, label: toEq.name }
            ],
            source: 'PortCompatibility.canConnectWithCable'
          })
        );
      }
    }
    return out;
  }
};

export const checkConnRouteUnavailable: ValidationCheck = {
  code: 'CONN-008',
  category: 'system',
  title: 'Cable route',
  evaluate(ctx): ValidationFinding[] {
    if (!ctx.connections.length) return [];
    const rctx = routeCtx(ctx);
    const out: ValidationFinding[] = [];
    for (const c of ctx.connections) {
      const fromEq = ctx.equipment.find((e) => e.instanceId === c.fromInstanceId);
      const toEq = ctx.equipment.find((e) => e.instanceId === c.toInstanceId);
      if (!fromEq || !toEq) continue;
      const route = cachedCableRoute(c, rctx);
      if (route.status !== 'no-room' && route.segments.length > 0) continue;
      if (ctx.room && route.segments.length > 0) continue;
      out.push(
        finding({
          id: `CONN-008-${c.id}`,
          code: 'CONN-008',
          severity: 'warning',
          category: 'system',
          title: 'Cable route unavailable',
          message: `${fromEq.name} → ${toEq.name}: route length is an estimate only when room geometry exists.`,
          explanation: 'Routing is a geometric estimate, not BIM tray design. Length uses the polyline when a room is present.',
          objectId: fromEq.instanceId,
          affectedObjects: [
            { kind: 'equipment', id: fromEq.instanceId, label: fromEq.name },
            { kind: 'equipment', id: toEq.instanceId, label: toEq.name }
          ],
          source: 'CableRouter'
        })
      );
    }
    return out;
  }
};

export const checkDisconnectedEquipment: ValidationCheck = {
  code: 'SYSTEM-006',
  category: 'system',
  title: 'Disconnected equipment',
  evaluate(ctx): ValidationFinding[] {
    if (!systemGraphActive(ctx)) return [];
    const out: ValidationFinding[] = [];
    for (const inst of ctx.equipment) {
      const product = ctx.catalog.get(inst.productId);
      if (!product) continue;
      const cat = product.category;
      if (!(SYSTEM_ROLE_CATEGORIES as readonly string[]).includes(cat)) continue;
      const hasAny = ctx.connections.some(
        (c) => c.fromInstanceId === inst.instanceId || c.toInstanceId === inst.instanceId
      );
      if (!hasAny) {
        out.push(
          finding({
            id: `SYSTEM-006-${inst.instanceId}`,
            code: 'SYSTEM-006',
            severity: 'warning',
            category: 'system',
            title: 'Equipment has no connections',
            message: `${inst.name} (${cat}) is in the design but has no system connections.`,
            explanation: 'System-role equipment should participate in the signal graph. If intentionally standalone, this can be dismissed.',
            objectId: inst.instanceId,
            affectedObjects: [{ kind: 'equipment', id: inst.instanceId, label: inst.name }],
            recommendedActions: ['Connect the device in System view', 'Remove it if not needed'],
            source: 'System topology'
          })
        );
      }
    }
    return out;
  }
};

export const SYSTEM_CHECKS: ValidationCheck[] = [
  checkPortsIncomplete,
  checkSignalDirection,
  checkOccupiedPorts,
  checkRequiredPorts,
  checkIncompletePath,
  checkSourceDestination,
  checkDestinationSource,
  checkPassiveSpeakerPath,
  checkAmpSpeakerOut,
  checkConnMissingEndpoint,
  checkConnCableType,
  checkConnRouteUnavailable,
  checkDisconnectedEquipment
];
