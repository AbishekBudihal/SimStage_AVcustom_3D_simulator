/**
 * SchematicAnalyzer.ts
 * The "Analyze" pipeline controller.
 * Takes a SchematicGraph, resolves products from catalog,
 * computes 3D spatial placement targets, and generates
 * the AnalyzedSchematicPayload ready for Schematic3DSync.
 *
 * Does NOT mutate AppState — purely functional.
 */

import type { EquipmentCatalog, EquipmentCategory } from '../catalog/EquipmentCatalog';
import type { RoomModel } from '../room/RoomModel';
import type { PhysicalMedium } from '../system/SystemTypes';
import type {
  SchematicGraph,
  SchematicNode,
  SchematicLink,
  AnalyzedSchematicPayload,
  Placement3DTarget,
  SchematicValidationResult
} from './SchematicTypes';
import { validateSchematicIntegrity } from './SchematicParser';

// ── Mounting heuristics ──────────────────────────────────────

const WALL_MOUNT_CATEGORIES = new Set<EquipmentCategory>(['display', 'projector', 'video_wall']);
const CEILING_MOUNT_CATEGORIES = new Set<EquipmentCategory>(['speaker', 'microphone']);
const TABLE_MOUNT_CATEGORIES = new Set<EquipmentCategory>(['source', 'codec']);
const RACK_MOUNT_CATEGORIES = new Set<EquipmentCategory>(['dsp', 'amplifier', 'switcher', 'network', 'control', 'extender']);

/** Default wall-mount height (center of display AFF in meters). */
const DISPLAY_CENTER_HEIGHT = 1.4;
/** Default ceiling offset for ceiling-mounted devices. */
const CEILING_OFFSET = 0.05;
/** Default table surface height. */
const TABLE_HEIGHT = 0.76;

/**
 * Infer the mounting kind from node metadata and category heuristics.
 */
function inferMountingKind(node: SchematicNode): Placement3DTarget['mountingKind'] {
  if (node.mountingPreference) return node.mountingPreference;
  if (node.rackMountable || (node.ruHeight != null && node.ruHeight > 0)) return 'rack';
  if (WALL_MOUNT_CATEGORIES.has(node.category)) return 'wall';
  if (CEILING_MOUNT_CATEGORIES.has(node.category)) return 'wall'; // ceiling mics/speakers default to ceiling
  if (TABLE_MOUNT_CATEGORIES.has(node.category)) return 'table';
  if (RACK_MOUNT_CATEGORIES.has(node.category)) return 'rack';
  return 'freestanding';
}

// ── 3D position resolver ─────────────────────────────────────

function resolvePosition(
  node: SchematicNode,
  mountKind: Placement3DTarget['mountingKind'],
  room: { width: number; depth: number; height: number },
  wallDisplayIndex: number,
  wallDisplayTotal: number,
  ceilingIndex: number,
  ceilingTotal: number
): { position: { x: number; y: number; z: number }; rotationY: number; wall?: 'front' | 'back' | 'left' | 'right' } {
  const cx = 0; // Room center X
  const cz = 0; // Room center Z

  switch (mountKind) {
    case 'wall': {
      // Displays go on the front wall (z = -depth/2), distributed evenly
      const spacing = room.width / (wallDisplayTotal + 1);
      const x = -room.width / 2 + spacing * (wallDisplayIndex + 1);
      return {
        position: { x, y: DISPLAY_CENTER_HEIGHT, z: -room.depth / 2 + 0.02 },
        rotationY: 0,
        wall: 'front'
      };
    }
    case 'ceiling': {
      // Ceiling speakers/mics distributed in a grid
      const cols = Math.ceil(Math.sqrt(ceilingTotal));
      const rows = Math.ceil(ceilingTotal / cols);
      const col = ceilingIndex % cols;
      const row = Math.floor(ceilingIndex / cols);
      const spacingX = room.width / (cols + 1);
      const spacingZ = room.depth / (rows + 1);
      return {
        position: {
          x: -room.width / 2 + spacingX * (col + 1),
          y: room.height - CEILING_OFFSET,
          z: -room.depth / 2 + spacingZ * (row + 1)
        },
        rotationY: 0
      };
    }
    case 'table': {
      return {
        position: { x: cx, y: TABLE_HEIGHT, z: cz },
        rotationY: 0
      };
    }
    case 'rack':
    case 'floor':
    case 'freestanding':
    default: {
      // Rack / floor equipment placed in the back-right corner
      return {
        position: { x: room.width / 2 - 0.4, y: 0, z: room.depth / 2 - 0.4 },
        rotationY: Math.PI
      };
    }
  }
}

// ── Cable manifest ───────────────────────────────────────────

function inferMedium(link: SchematicLink): PhysicalMedium {
  if (link.physicalMedium) return link.physicalMedium;
  // Infer from signal type
  switch (link.signalType) {
    case 'VIDEO': return 'HDMI';
    case 'AUDIO': return 'XLR';
    case 'USB': return 'USB';
    case 'NETWORK':
    case 'DANTE':
    case 'AES67':
    case 'CONTROL':
      return 'Cat6';
    case 'SDI': return 'HDMI'; // SDI uses coax, approximated
    case 'FIBER': return 'Fiber';
    case 'HDBASET': return 'Cat6A';
    case 'POWER': return 'Power';
    case 'SERIAL':
    case 'GPIO':
      return 'Control';
    default: return 'Cat6';
  }
}

function estimateCableLength(
  link: SchematicLink,
  room: { width: number; depth: number; height: number }
): number {
  if (link.lengthM != null && link.lengthM > 0) return link.lengthM;
  // Heuristic: diagonal of room + 2m slack
  return Number((Math.sqrt(room.width ** 2 + room.depth ** 2 + room.height ** 2) + 2).toFixed(1));
}

// ── Main analyze pipeline ────────────────────────────────────

/**
 * Analyze a parsed SchematicGraph:
 * 1. Run signal integrity validation.
 * 2. Resolve product matches from catalog.
 * 3. Compute 3D spatial placement targets.
 * 4. Generate cable manifest.
 * 5. Determine rack requirements.
 *
 * Returns a fully resolved AnalyzedSchematicPayload.
 */
export function analyzeSchematic(
  graph: SchematicGraph,
  catalog: EquipmentCatalog,
  roomContext?: RoomModel
): AnalyzedSchematicPayload {
  // 1. Validate signal integrity
  const validation: SchematicValidationResult = validateSchematicIntegrity(graph);

  // Room dimensions (from graph metadata or roomContext or defaults)
  const room = {
    width: roomContext?.width ?? graph.metadata.targetRoom?.widthM ?? 8,
    depth: roomContext?.depth ?? graph.metadata.targetRoom?.depthM ?? 6,
    height: roomContext?.height ?? graph.metadata.targetRoom?.heightM ?? 3
  };

  // 2. Classify nodes by mounting
  const mountMap = new Map<string, Placement3DTarget['mountingKind']>();
  for (const node of graph.nodes) {
    mountMap.set(node.id, inferMountingKind(node));
  }

  // Gather indices for spatial distribution
  const wallNodes = graph.nodes.filter((n) => mountMap.get(n.id) === 'wall');
  const ceilingNodes = graph.nodes.filter((n) => mountMap.get(n.id) === 'ceiling');

  // Ceiling-mounted items (speakers + ceiling mics) get ceiling placement
  const actualCeilingNodes = graph.nodes.filter((n) => {
    const mk = mountMap.get(n.id);
    return mk === 'ceiling' || (CEILING_MOUNT_CATEGORIES.has(n.category) && mk !== 'rack');
  });
  // Re-map ceiling items
  actualCeilingNodes.forEach((n) => mountMap.set(n.id, 'ceiling'));

  // Camera on presentation wall: treat like wall mount but above display
  const cameraNodes = graph.nodes.filter((n) => n.category === 'camera');
  cameraNodes.forEach((n) => {
    if (mountMap.get(n.id) !== 'rack') mountMap.set(n.id, 'wall');
  });

  const finalWallNodes = graph.nodes.filter((n) => mountMap.get(n.id) === 'wall');
  const finalCeilingNodes = graph.nodes.filter((n) => mountMap.get(n.id) === 'ceiling');

  // 3. Compute placements
  const placements: Placement3DTarget[] = [];
  let rackRUUsed = 0;

  for (const node of graph.nodes) {
    const mk = mountMap.get(node.id)!;
    const wallIdx = finalWallNodes.indexOf(node);
    const ceilIdx = finalCeilingNodes.indexOf(node);

    const { position, rotationY, wall } = resolvePosition(
      node, mk, room,
      wallIdx >= 0 ? wallIdx : 0,
      finalWallNodes.length || 1,
      ceilIdx >= 0 ? ceilIdx : 0,
      finalCeilingNodes.length || 1
    );

    const placement: Placement3DTarget = {
      nodeId: node.id,
      position,
      rotationY,
      wall,
      mountingKind: mk
    };

    if (mk === 'rack') {
      const ru = node.ruHeight ?? 1;
      placement.rackPositionRU = rackRUUsed + 1;
      rackRUUsed += ru;
    }

    placements.push(placement);
  }

  // 4. Rack requirement
  const rackNodes = graph.nodes.filter((n) => mountMap.get(n.id) === 'rack');
  const totalRU = rackNodes.reduce((sum, n) => sum + (n.ruHeight ?? 1), 0);
  const rackRequired = rackNodes.length > 0;
  const rackKind: 'floor' | 'wall' | undefined = rackRequired
    ? (totalRU >= 4 || rackNodes.length >= 2 ? 'floor' : 'wall')
    : undefined;

  // 5. Cable manifest
  const cableManifest = graph.links.map((link, idx) => ({
    linkId: link.id,
    cableId: `C-${String(idx + 1).padStart(3, '0')}`,
    medium: inferMedium(link),
    estimatedLengthM: estimateCableLength(link, room)
  }));

  return {
    graph,
    validation,
    placements,
    rackRequired,
    rackKind,
    totalRU,
    cableManifest
  };
}
