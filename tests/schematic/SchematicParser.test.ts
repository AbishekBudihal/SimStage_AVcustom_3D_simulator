import { describe, it, expect } from 'vitest';
import { parseSchematicJson, validateSchematicIntegrity } from '../../src/schematic/SchematicParser';
import { boardroomSchematic, huddleSchematic } from '../../src/schematic/demoSchematics';

describe('SchematicParser', () => {
  describe('parseSchematicJson', () => {
    it('parses valid JSON schematic', () => {
      const result = parseSchematicJson(JSON.stringify(boardroomSchematic()));
      expect(result.errors).toEqual([]);
      expect(result.graph).not.toBeNull();
      expect(result.graph!.nodes.length).toBe(9);
      expect(result.graph!.links.length).toBe(7);
    });

    it('rejects invalid JSON string', () => {
      const result = parseSchematicJson('not valid json {{{');
      expect(result.graph).toBeNull();
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Invalid JSON');
    });

    it('rejects non-object JSON', () => {
      const result = parseSchematicJson('"just a string"');
      expect(result.graph).toBeNull();
      expect(result.errors[0]).toContain('JSON object');
    });

    it('rejects missing metadata', () => {
      const result = parseSchematicJson({ nodes: [], links: [] });
      expect(result.graph).toBeNull();
      expect(result.errors.some((e) => e.includes('metadata'))).toBe(true);
    });

    it('rejects duplicate node IDs', () => {
      const result = parseSchematicJson({
        metadata: { title: 'Test' },
        nodes: [
          { id: 'n1', label: 'A', category: 'display', ports: [] },
          { id: 'n1', label: 'B', category: 'camera', ports: [] }
        ],
        links: []
      });
      expect(result.errors.some((e) => e.includes('duplicate'))).toBe(true);
    });

    it('accepts valid object input directly', () => {
      const result = parseSchematicJson(huddleSchematic());
      expect(result.errors).toEqual([]);
      expect(result.graph!.nodes.length).toBe(2);
    });
  });

  describe('validateSchematicIntegrity', () => {
    it('validates boardroom schematic without errors', () => {
      const result = validateSchematicIntegrity(boardroomSchematic());
      const errors = result.issues.filter((i) => i.severity === 'error');
      expect(errors.length).toBe(0);
      expect(result.valid).toBe(true);
    });

    it('computes power summary for boardroom', () => {
      const result = validateSchematicIntegrity(boardroomSchematic());
      expect(result.powerSummary.totalWatts).toBeGreaterThan(0);
      expect(result.powerSummary.poeDeviceCount).toBe(1); // Shure MXA920
      expect(result.powerSummary.acDeviceCount).toBeGreaterThanOrEqual(3);
    });

    it('counts signal chains (source nodes)', () => {
      const result = validateSchematicIntegrity(boardroomSchematic());
      expect(result.signalChainCount).toBeGreaterThanOrEqual(2); // laptop + mic
    });

    it('detects port-missing on invalid link', () => {
      const graph = huddleSchematic();
      graph.links.push({
        id: 'bad-link',
        fromNodeId: 'display-h1',
        fromPortId: 'nonexistent-port',
        toNodeId: 'bar-h1',
        toPortId: 'usb-up',
        signalType: 'VIDEO'
      });
      const result = validateSchematicIntegrity(graph);
      expect(result.issues.some((i) => i.code === 'PORT-MISSING')).toBe(true);
      expect(result.valid).toBe(false);
    });

    it('detects direction mismatch', () => {
      const graph = huddleSchematic();
      // Try to connect two inputs
      graph.links.push({
        id: 'bad-dir',
        fromNodeId: 'display-h1',
        fromPortId: 'hdmi-in',
        toNodeId: 'bar-h1',
        toPortId: 'usb-up',
        signalType: 'VIDEO'
      });
      const result = validateSchematicIntegrity(graph);
      expect(result.issues.some((i) => i.code === 'DIRECTION-MISMATCH')).toBe(true);
    });

    it('detects dangling nodes', () => {
      const graph = huddleSchematic();
      graph.nodes.push({
        id: 'orphan',
        label: 'Orphan Device',
        category: 'dsp',
        position2D: { x: 0, y: 0 },
        ports: []
      });
      const result = validateSchematicIntegrity(graph);
      expect(result.danglingNodeCount).toBeGreaterThanOrEqual(1);
      expect(result.issues.some((i) => i.code === 'DANGLING-NODE')).toBe(true);
    });

    it('detects connector mismatch', () => {
      const graph = {
        metadata: { title: 'Test' },
        nodes: [
          { id: 'n1', label: 'Source', category: 'source' as const, position2D: { x: 0, y: 0 },
            ports: [{ id: 'p1', label: 'HDMI OUT', direction: 'output' as const, signalTypes: ['VIDEO' as const], connector: 'hdmi' as const }]
          },
          { id: 'n2', label: 'Sink', category: 'display' as const, position2D: { x: 100, y: 0 },
            ports: [{ id: 'p1', label: 'XLR IN', direction: 'input' as const, signalTypes: ['VIDEO' as const], connector: 'xlr' as const }]
          }
        ],
        links: [
          { id: 'l1', fromNodeId: 'n1', fromPortId: 'p1', toNodeId: 'n2', toPortId: 'p1', signalType: 'VIDEO' as const }
        ]
      };
      const result = validateSchematicIntegrity(graph);
      expect(result.issues.some((i) => i.code === 'CONNECTOR-MISMATCH')).toBe(true);
    });

    it('huddle schematic validates cleanly', () => {
      const result = validateSchematicIntegrity(huddleSchematic());
      expect(result.valid).toBe(true);
      expect(result.signalChainCount).toBe(1);
    });
  });
});
