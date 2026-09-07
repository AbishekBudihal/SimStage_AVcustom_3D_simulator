/**
 * SchematicExporter.ts
 * Exports the live AppState engineering model to a canonical SchematicGraph.
 * Governed strictly by "ONE ENGINEERING MODEL -> MULTIPLE VIEWS":
 * Translates placed equipment instances, resolved ports, connections,
 * rack mount metadata, and room properties into standard schematic JSON.
 */

import type { AppState } from '../app/AppState';
import type { EquipmentCatalog, EquipmentInstance, EquipmentProduct } from '../catalog/EquipmentCatalog';
import { resolveInstancePorts } from '../system/PortResolver';
import { computeAutoLayout } from '../system/SystemLayout';
import type {
  SchematicGraph,
  SchematicNode,
  SchematicLink,
  SchematicNodePort,
  SchematicMetadata
} from './SchematicTypes';

/**
 * Export current project state in AppState into a canonical SchematicGraph.
 */
export function exportAppStateToSchematic(
  state: AppState,
  catalog?: EquipmentCatalog
): SchematicGraph {
  const cat = catalog ?? state.getCatalog();
  const room = state.room;

  // 1. Construct Metadata
  const metadata: SchematicMetadata = {
    title: room?.useCase ? `${room.useCase.toUpperCase()} System Schematic` : 'SimStage AV System Schematic',
    designer: 'SimStage AV Engineer',
    revision: '1.0',
    projectCode: room?.id ?? 'PRJ-001',
    targetRoom: room
      ? {
          widthM: room.width,
          depthM: room.depth,
          heightM: room.height
        }
      : undefined
  };

  // Ensure system layout exists for all nodes
  const layout = { ...state.systemLayout };
  const missingLayout = state.equipment.filter((e) => !layout[e.instanceId]);
  if (missingLayout.length > 0) {
    const computed = computeAutoLayout(
      state.equipment.map((e) => ({ instanceId: e.instanceId, productId: e.productId })),
      cat
    );
    Object.assign(layout, computed);
  }

  // 2. Map Equipment Instances to Schematic Nodes
  const nodes: SchematicNode[] = state.equipment.map((inst) => {
    const product: EquipmentProduct | undefined = cat.get(inst.productId);
    const resolvedPorts = resolveInstancePorts(inst.instanceId, inst.productId, cat);

    const ports: SchematicNodePort[] = resolvedPorts.map((p) => ({
      id: p.id,
      label: p.label,
      direction: p.direction,
      signalTypes: [...p.signalTypes],
      connector: p.connector,
      transport: p.transport,
      protocol: p.protocol,
      maxConnections: p.maxConnections
    }));

    const isRackMounted = inst.rackId != null;
    const isRackCapable = Boolean(product?.mounting?.rack || product?.rackUnits || isRackMounted);
    const ruHeight = inst.rackPositionRU != null
      ? (product?.rackUnits ?? 1)
      : (product?.rackUnits ?? (isRackCapable ? 1 : undefined));

    const pos = layout[inst.instanceId] ?? { x: 100, y: 100 };

    let mountingPreference: SchematicNode['mountingPreference'] = undefined;
    if (isRackMounted) {
      mountingPreference = 'rack';
    } else if (inst.mountingKind === 'floor') {
      mountingPreference = 'freestanding';
    } else if (inst.mountingKind === 'wall' || inst.mountingKind === 'ceiling' || inst.mountingKind === 'table' || inst.mountingKind === 'rack' || inst.mountingKind === 'freestanding') {
      mountingPreference = inst.mountingKind;
    } else if (inst.wall) {
      mountingPreference = 'wall';
    }

    const powerWatts = product?.power?.powerWatts ?? product?.physical?.powerWatts;

    const node: SchematicNode = {
      id: inst.instanceId,
      label: inst.name,
      category: product?.category ?? 'infrastructure',
      productId: inst.productId,
      manufacturer: product?.manufacturer,
      model: product?.model,
      position2D: { x: Math.round(pos.x), y: Math.round(pos.y) },
      ports,
      rackMountable: isRackCapable,
      ruHeight,
      mountingPreference,
      powerWatts,
      poeClass: product?.power?.poeClass,
      bom: {
        partNumber: product?.partNumber,
        quantity: 1
      }
    };

    return node;
  });

  // 3. Map System Connections to Schematic Links
  const links: SchematicLink[] = state.connections.map((conn, idx) => ({
    id: conn.id || `lk-${idx + 1}`,
    fromNodeId: conn.fromInstanceId,
    fromPortId: conn.fromPortId,
    toNodeId: conn.toInstanceId,
    toPortId: conn.toPortId,
    signalType: conn.signalType,
    transport: conn.transport,
    physicalMedium: conn.physicalMedium,
    cableType: conn.cableType,
    lengthM: conn.estimatedLengthM ?? (conn.route?.totalLength)
  }));

  return {
    metadata,
    nodes,
    links
  };
}

/**
 * Triggers a browser download of the SchematicGraph as a JSON file.
 */
export function downloadSchematicJson(graph: SchematicGraph, filename = 'system-schematic.json'): void {
  const jsonStr = JSON.stringify(graph, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
