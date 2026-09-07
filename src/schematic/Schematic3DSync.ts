/**
 * Schematic3DSync.ts
 * Bridge between AnalyzedSchematicPayload and AppState.
 * Uses ONLY existing AppState methods:
 *   addEquipment(), addConnection(), addDefaultRack(), assignEquipmentToRack()
 *
 * Never bypasses the engineering model. All equipment and connections
 * flow through the same path as manual user interaction.
 */

import type { AppState } from '../app/AppState';
import type { EquipmentCatalog, EquipmentInstance } from '../catalog/EquipmentCatalog';
import { buildCustomDevice, type CustomDeviceInput } from '../catalog/CustomDeviceBuilder';
import type { AnalyzedSchematicPayload, Placement3DTarget, SchematicNode } from './SchematicTypes';

export interface SyncResult {
  /** Total equipment instances created. */
  equipmentAdded: number;
  /** Total connections established. */
  connectionsAdded: number;
  /** Connections that failed port compatibility. */
  connectionsFailed: number;
  /** Rack created (if any). */
  rackCreated: boolean;
  /** Equipment assigned to rack. */
  rackAssignments: number;
  /** Mapping from schematic node ID to AppState instance ID. */
  nodeToInstanceMap: Map<string, string>;
  /** Warnings encountered during sync. */
  warnings: string[];
}

/**
 * Convert a SchematicNode into a productId.
 * If the node references a catalog product, use it.
 * Otherwise, register a custom device on-the-fly.
 */
function resolveProductId(node: SchematicNode, catalog: EquipmentCatalog): string {
  // 1. Direct catalog match
  if (node.productId) {
    const existing = catalog.get(node.productId);
    if (existing) return node.productId;
  }

  // 2. Search catalog by manufacturer + model
  if (node.manufacturer && node.model) {
    const all = catalog.all();
    const match = all.find(
      (p) =>
        p.manufacturer.toLowerCase() === node.manufacturer!.toLowerCase() &&
        p.model.toLowerCase() === node.model!.toLowerCase()
    );
    if (match) return match.id;
  }

  // 3. Build a custom device from the node metadata
  const input: CustomDeviceInput = {
    manufacturer: node.manufacturer ?? 'Custom',
    model: node.model ?? node.label,
    category: node.category,
    width: 0.48,
    height: node.ruHeight != null ? node.ruHeight * 0.04445 : 0.044,
    depth: 0.3,
    ports: node.ports.map((p) => ({
      id: p.id,
      label: p.label,
      direction: p.direction,
      signalTypes: p.signalTypes,
      connector: p.connector,
      transport: p.transport,
      protocol: p.protocol,
      maxConnections: p.maxConnections
    })),
    rackUnits: node.ruHeight,
    rackMountable: node.rackMountable ?? (node.ruHeight != null && node.ruHeight > 0),
    powerWatts: node.powerWatts,
    provenance: 'user_defined'
  };

  const product = buildCustomDevice(input);
  catalog.register([product]);
  return product.id;
}

/**
 * Sync an analyzed schematic into the live AppState.
 *
 * This uses the standard AppState API:
 * - addEquipment() for each node
 * - addConnection() for each link
 * - addDefaultRack() + assignEquipmentToRack() for rack-mounted equipment
 *
 * All changes flow through history/undo and trigger the normal
 * notification pipeline (3D, Plan, Schematic, BOM all update).
 */
export function syncSchematicTo3D(
  payload: AnalyzedSchematicPayload,
  state: AppState,
  options: { clearExisting?: boolean } = {}
): SyncResult {
  const warnings: string[] = [];
  const nodeToInstanceMap = new Map<string, string>();
  const catalog = state.getCatalog();

  // Optionally clear existing equipment
  if (options.clearExisting) {
    const existingIds = state.equipment.map((e) => e.instanceId);
    for (const id of existingIds) {
      state.removeEquipment(id);
    }
  }

  // ── Phase 1: Create equipment instances ──
  let equipmentAdded = 0;
  for (const node of payload.graph.nodes) {
    const productId = resolveProductId(node, catalog);
    const placement = payload.placements.find((p) => p.nodeId === node.id);
    if (!placement) {
      warnings.push(`No placement target computed for node "${node.label}".`);
      continue;
    }

    const instanceId = `schematic-${node.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const instance: EquipmentInstance = {
      instanceId,
      productId,
      name: node.label,
      position: { ...placement.position },
      rotationY: placement.rotationY,
      wall: placement.wall,
      placementMode: 'smart',
      origin: 'auto',
      mountingKind: placement.mountingKind === 'rack' ? undefined : placement.mountingKind
    };

    state.addEquipment(instance);
    nodeToInstanceMap.set(node.id, instanceId);
    equipmentAdded++;
  }

  // ── Phase 2: Create rack (if required) ──
  let rackCreated = false;
  let rackAssignments = 0;
  let rackId: string | undefined;

  if (payload.rackRequired) {
    const rack = state.addDefaultRack(payload.rackKind ?? 'floor');
    rackId = rack.id;
    rackCreated = true;

    // Position rack in rack_zone if room defines one
    const rackZone = state.room?.semanticZones?.find((z) => z.kind === 'rack_zone');
    if (rackZone) {
      const rx = Number(((rackZone.bounds.minX + rackZone.bounds.maxX) / 2).toFixed(2));
      const rz = Number(((rackZone.bounds.minZ + rackZone.bounds.maxZ) / 2).toFixed(2));
      state.updateRack(rack.id, { x: rx, z: rz });
    }

    // Assign rack-mounted equipment
    for (const placement of payload.placements) {
      if (placement.mountingKind !== 'rack') continue;
      const instanceId = nodeToInstanceMap.get(placement.nodeId);
      if (!instanceId) continue;
      const node = payload.graph.nodes.find((n) => n.id === placement.nodeId);
      const ru = node?.ruHeight ?? 1;
      state.assignEquipmentToRack(instanceId, rackId, ru);
      rackAssignments++;
    }
  }

  // ── Phase 3: Create connections ──
  let connectionsAdded = 0;
  let connectionsFailed = 0;

  for (const link of payload.graph.links) {
    const fromInstanceId = nodeToInstanceMap.get(link.fromNodeId);
    const toInstanceId = nodeToInstanceMap.get(link.toNodeId);
    if (!fromInstanceId || !toInstanceId) {
      warnings.push(`Link "${link.id}": could not resolve instance IDs for connection.`);
      connectionsFailed++;
      continue;
    }

    const success = state.addConnection(
      fromInstanceId,
      link.fromPortId,
      toInstanceId,
      link.toPortId
    );

    if (success) {
      connectionsAdded++;
    } else {
      // Try auto-pairing compatible ports
      const pairSuccess = state.connectCompatiblePair(fromInstanceId, toInstanceId);
      if (pairSuccess) {
        connectionsAdded++;
        warnings.push(`Link "${link.id}": exact port match failed; connected via compatible pair.`);
      } else {
        connectionsFailed++;
        warnings.push(`Link "${link.id}": connection failed — ${state.lastSystemError}`);
      }
    }
  }

  // ── Phase 4: Trigger layout sync ──
  state.ensureSystemLayout();

  return {
    equipmentAdded,
    connectionsAdded,
    connectionsFailed,
    rackCreated,
    rackAssignments,
    nodeToInstanceMap,
    warnings
  };
}
