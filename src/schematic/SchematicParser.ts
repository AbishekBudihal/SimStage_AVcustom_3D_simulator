/**
 * SchematicParser.ts
 * Parses and validates schematic graph JSON.
 * Signal integrity, port compatibility, direction, connector matching,
 * loop detection, power budgets — no invented specs.
 */

import type {
  SchematicGraph,
  SchematicNode,
  SchematicLink,
  SchematicIssue,
  SchematicValidationResult,
  PowerSummary,
  SchematicIssueSeverity,
  SchematicIssueCode
} from './SchematicTypes';

// ── JSON parsing ────────────────────────────────────────────

export interface ParseResult {
  graph: SchematicGraph | null;
  errors: string[];
}

/**
 * Parse raw JSON (string or object) into a SchematicGraph.
 * Reports structural errors without throwing.
 */
export function parseSchematicJson(input: string | object): ParseResult {
  let raw: unknown;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch (e) {
      return { graph: null, errors: [`Invalid JSON: ${(e as Error).message}`] };
    }
  } else {
    raw = input;
  }

  const errors: string[] = [];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { graph: null, errors: ['Schematic must be a JSON object with metadata, nodes, links.'] };
  }

  const obj = raw as Record<string, unknown>;

  // Metadata
  if (!obj.metadata || typeof obj.metadata !== 'object') {
    errors.push('Missing required field: metadata');
  } else {
    const meta = obj.metadata as Record<string, unknown>;
    if (typeof meta.title !== 'string' || !meta.title) {
      errors.push('metadata.title is required and must be a non-empty string.');
    }
  }

  // Nodes
  if (!Array.isArray(obj.nodes)) {
    errors.push('Missing required field: nodes (must be an array).');
  } else {
    const nodeIds = new Set<string>();
    for (let i = 0; i < obj.nodes.length; i++) {
      const n = obj.nodes[i] as Record<string, unknown>;
      if (!n.id || typeof n.id !== 'string') {
        errors.push(`nodes[${i}]: missing or invalid id.`);
        continue;
      }
      if (nodeIds.has(n.id)) {
        errors.push(`nodes[${i}]: duplicate node id "${n.id}".`);
      }
      nodeIds.add(n.id);
      if (!n.label || typeof n.label !== 'string') errors.push(`nodes[${i}] "${n.id}": missing label.`);
      if (!n.category || typeof n.category !== 'string') errors.push(`nodes[${i}] "${n.id}": missing category.`);
      if (!Array.isArray(n.ports)) errors.push(`nodes[${i}] "${n.id}": ports must be an array.`);
    }
  }

  // Links
  if (!Array.isArray(obj.links)) {
    errors.push('Missing required field: links (must be an array).');
  } else {
    const linkIds = new Set<string>();
    for (let i = 0; i < obj.links.length; i++) {
      const l = obj.links[i] as Record<string, unknown>;
      if (!l.id || typeof l.id !== 'string') {
        errors.push(`links[${i}]: missing or invalid id.`);
        continue;
      }
      if (linkIds.has(l.id)) {
        errors.push(`links[${i}]: duplicate link id "${l.id}".`);
      }
      linkIds.add(l.id);
      for (const f of ['fromNodeId', 'fromPortId', 'toNodeId', 'toPortId', 'signalType']) {
        if (!l[f] || typeof l[f] !== 'string') errors.push(`links[${i}] "${l.id}": missing ${f}.`);
      }
    }
  }

  if (errors.length > 0) {
    return { graph: null, errors };
  }

  return { graph: obj as unknown as SchematicGraph, errors: [] };
}

// ── Signal integrity validation ─────────────────────────────

function issue(
  code: SchematicIssueCode,
  severity: SchematicIssueSeverity,
  message: string,
  nodeIds: string[] = [],
  linkIds: string[] = []
): SchematicIssue {
  return { code, severity, message, affectedNodeIds: nodeIds, affectedLinkIds: linkIds };
}

/**
 * Validate signal integrity, port compatibility, power budgets,
 * and structural soundness of a parsed SchematicGraph.
 */
export function validateSchematicIntegrity(graph: SchematicGraph): SchematicValidationResult {
  const issues: SchematicIssue[] = [];
  const nodeMap = new Map<string, SchematicNode>();
  graph.nodes.forEach((n) => nodeMap.set(n.id, n));

  // ── Duplicate node IDs ──
  const seenNodeIds = new Set<string>();
  for (const n of graph.nodes) {
    if (seenNodeIds.has(n.id)) {
      issues.push(issue('DUPLICATE-ID', 'error', `Duplicate node id "${n.id}".`, [n.id]));
    }
    seenNodeIds.add(n.id);
  }

  // ── Duplicate link IDs ──
  const seenLinkIds = new Set<string>();
  for (const l of graph.links) {
    if (seenLinkIds.has(l.id)) {
      issues.push(issue('DUPLICATE-ID', 'error', `Duplicate link id "${l.id}".`, [], [l.id]));
    }
    seenLinkIds.add(l.id);
  }

  // ── Per-link validation ──
  const portUsage = new Map<string, number>(); // "nodeId:portId" → count
  for (const link of graph.links) {
    const fromNode = nodeMap.get(link.fromNodeId);
    const toNode = nodeMap.get(link.toNodeId);

    // Node existence
    if (!fromNode) {
      issues.push(issue('SCHEMA-001', 'error', `Link "${link.id}": fromNodeId "${link.fromNodeId}" does not exist.`, [], [link.id]));
      continue;
    }
    if (!toNode) {
      issues.push(issue('SCHEMA-001', 'error', `Link "${link.id}": toNodeId "${link.toNodeId}" does not exist.`, [], [link.id]));
      continue;
    }

    // Port existence
    const fromPort = fromNode.ports.find((p) => p.id === link.fromPortId);
    const toPort = toNode.ports.find((p) => p.id === link.toPortId);
    if (!fromPort) {
      issues.push(issue('PORT-MISSING', 'error', `Link "${link.id}": port "${link.fromPortId}" not found on node "${fromNode.label}".`, [link.fromNodeId], [link.id]));
      continue;
    }
    if (!toPort) {
      issues.push(issue('PORT-MISSING', 'error', `Link "${link.id}": port "${link.toPortId}" not found on node "${toNode.label}".`, [link.toNodeId], [link.id]));
      continue;
    }

    // Direction check
    const fromOut = fromPort.direction === 'output' || fromPort.direction === 'bidirectional';
    const toIn = toPort.direction === 'input' || toPort.direction === 'bidirectional';
    if (!fromOut) {
      issues.push(issue('DIRECTION-MISMATCH', 'error', `Link "${link.id}": source port "${fromPort.label}" is ${fromPort.direction}, cannot output.`, [link.fromNodeId], [link.id]));
    }
    if (!toIn) {
      issues.push(issue('DIRECTION-MISMATCH', 'error', `Link "${link.id}": destination port "${toPort.label}" is ${toPort.direction}, cannot accept input.`, [link.toNodeId], [link.id]));
    }

    // Signal type match
    if (!fromPort.signalTypes.includes(link.signalType) && !toPort.signalTypes.includes(link.signalType)) {
      issues.push(issue('SIGNAL-MISMATCH', 'warning', `Link "${link.id}": signal type ${link.signalType} not supported by either port.`, [link.fromNodeId, link.toNodeId], [link.id]));
    }

    // Connector match
    if (fromPort.connector !== toPort.connector) {
      issues.push(issue('CONNECTOR-MISMATCH', 'error', `Link "${link.id}": connector mismatch ${fromPort.connector} → ${toPort.connector}.`, [link.fromNodeId, link.toNodeId], [link.id]));
    }

    // Multi-drop tracking
    const fromKey = `${link.fromNodeId}:${link.fromPortId}`;
    const toKey = `${link.toNodeId}:${link.toPortId}`;
    portUsage.set(fromKey, (portUsage.get(fromKey) ?? 0) + 1);
    portUsage.set(toKey, (portUsage.get(toKey) ?? 0) + 1);
  }

  // Multi-drop violations
  for (const [key, count] of portUsage) {
    if (count <= 1) continue;
    const [nodeId, portId] = key.split(':');
    const node = nodeMap.get(nodeId);
    const port = node?.ports.find((p) => p.id === portId);
    const max = port?.maxConnections ?? 1;
    if (count > max) {
      issues.push(issue('MULTI-DROP', 'error', `Port "${port?.label ?? portId}" on "${node?.label ?? nodeId}" has ${count} connections but allows ${max}.`, [nodeId], []));
    }
  }

  // ── Dangling nodes (no links at all) ──
  const linkedNodeIds = new Set<string>();
  for (const l of graph.links) {
    linkedNodeIds.add(l.fromNodeId);
    linkedNodeIds.add(l.toNodeId);
  }
  let danglingNodeCount = 0;
  for (const n of graph.nodes) {
    if (!linkedNodeIds.has(n.id)) {
      danglingNodeCount++;
      issues.push(issue('DANGLING-NODE', 'warning', `Node "${n.label}" has no signal connections.`, [n.id]));
    }
  }

  // ── Loop detection (DFS) ──
  const adjacency = new Map<string, string[]>();
  for (const l of graph.links) {
    if (!adjacency.has(l.fromNodeId)) adjacency.set(l.fromNodeId, []);
    adjacency.get(l.fromNodeId)!.push(l.toNodeId);
  }
  const visited = new Set<string>();
  const stack = new Set<string>();
  function dfs(nodeId: string): boolean {
    if (stack.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;
    visited.add(nodeId);
    stack.add(nodeId);
    for (const neighbor of adjacency.get(nodeId) ?? []) {
      if (dfs(neighbor)) return true;
    }
    stack.delete(nodeId);
    return false;
  }
  for (const n of graph.nodes) {
    if (dfs(n.id)) {
      issues.push(issue('LOOP-DETECTED', 'error', `Signal loop detected involving node "${n.label}".`, [n.id]));
      break; // One loop warning is sufficient
    }
  }

  // ── Power summary ──
  let totalWatts = 0;
  let poeDeviceCount = 0;
  let poeTotalWatts = 0;
  let acDeviceCount = 0;
  for (const n of graph.nodes) {
    if (n.powerWatts != null && n.powerWatts > 0) {
      totalWatts += n.powerWatts;
      if (n.poeClass) {
        poeDeviceCount++;
        poeTotalWatts += n.powerWatts;
      } else {
        acDeviceCount++;
      }
    }
  }

  // ── Signal chain count (source nodes with outgoing links only) ──
  let signalChainCount = 0;
  for (const n of graph.nodes) {
    const hasOut = graph.links.some((l) => l.fromNodeId === n.id);
    const hasIn = graph.links.some((l) => l.toNodeId === n.id);
    if (hasOut && !hasIn) signalChainCount++;
  }

  const hasErrors = issues.some((i) => i.severity === 'error');
  const powerSummary: PowerSummary = { totalWatts, poeDeviceCount, poeTotalWatts, acDeviceCount };

  return {
    valid: !hasErrors,
    issues,
    powerSummary,
    signalChainCount,
    danglingNodeCount
  };
}
