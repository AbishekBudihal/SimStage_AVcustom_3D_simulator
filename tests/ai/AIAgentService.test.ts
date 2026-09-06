import { describe, it, expect } from 'vitest';
import {
  parseOfflineIntent,
  executeToolCall,
  AV_TOOL_DEFINITIONS,
  AIAssistantService
} from '../../src/ai/ai-agent-service';
import { AppState } from '../../src/app/AppState';
import type { AIToolCall } from '../../src/ai/AIAgentTypes';

function freshState(): AppState {
  return new AppState();
}

describe('AI Agent Service', () => {
  describe('parseOfflineIntent', () => {
    it('parses "add display on front wall"', () => {
      const intent = parseOfflineIntent('add display on front wall');
      expect(intent).not.toBeNull();
      expect(intent!.name).toBe('add_device');
      expect(intent!.arguments).toEqual(expect.objectContaining({ category: 'display', wall: 'front' }));
    });

    it('parses "add a camera"', () => {
      const intent = parseOfflineIntent('add a camera');
      expect(intent).not.toBeNull();
      expect(intent!.name).toBe('add_device');
      expect((intent!.arguments as any).category).toBe('camera');
    });

    it('parses "connect switcher to display"', () => {
      const intent = parseOfflineIntent('connect switcher to display');
      expect(intent).not.toBeNull();
      expect(intent!.name).toBe('connect_devices');
      expect((intent!.arguments as any).fromDevice).toBe('switcher');
      expect((intent!.arguments as any).toDevice).toBe('display');
    });

    it('parses "audit design"', () => {
      const intent = parseOfflineIntent('audit design');
      expect(intent).not.toBeNull();
      expect(intent!.name).toBe('audit_design');
    });

    it('parses "list equipment"', () => {
      const intent = parseOfflineIntent('list equipment');
      expect(intent).not.toBeNull();
      expect(intent!.name).toBe('list_equipment');
    });

    it('returns null for unrecognized input', () => {
      expect(parseOfflineIntent('hello world')).toBeNull();
    });

    it('handles synonyms: "add mic"', () => {
      const intent = parseOfflineIntent('add mic');
      expect(intent).not.toBeNull();
      expect((intent!.arguments as any).category).toBe('microphone');
    });

    it('handles "validate" as audit intent', () => {
      const intent = parseOfflineIntent('validate');
      expect(intent).not.toBeNull();
      expect(intent!.name).toBe('audit_design');
    });
  });

  describe('executeToolCall', () => {
    it('adds a device to AppState', () => {
      const state = freshState();
      const call: AIToolCall = {
        id: 'test-1',
        name: 'add_device',
        arguments: { category: 'display' },
        status: 'pending'
      };
      const result = executeToolCall(call, state);
      expect(result.success).toBe(true);
      expect(state.equipment.length).toBe(1);
    });

    it('audits an empty design', () => {
      const state = freshState();
      const call: AIToolCall = {
        id: 'test-2',
        name: 'audit_design',
        arguments: {},
        status: 'pending'
      };
      const result = executeToolCall(call, state);
      expect(result.success).toBe(true);
      expect(result.message).toContain('Equipment: 0');
    });

    it('lists equipment in design', () => {
      const state = freshState();
      const call: AIToolCall = {
        id: 'test-3',
        name: 'list_equipment',
        arguments: {},
        status: 'pending'
      };
      const result = executeToolCall(call, state);
      expect(result.success).toBe(true);
      expect(result.message).toContain('No equipment');
    });

    it('rejects unknown tool', () => {
      const state = freshState();
      const call: AIToolCall = {
        id: 'test-4',
        name: 'unknown_tool',
        arguments: {},
        status: 'pending'
      };
      const result = executeToolCall(call, state);
      expect(result.success).toBe(false);
      expect(result.message).toContain('Unknown tool');
    });
  });

  describe('AIAssistantService', () => {
    it('processes message via offline engine', async () => {
      const state = freshState();
      const service = new AIAssistantService(state);
      const reply = await service.processMessage('add display');
      expect(reply.role).toBe('assistant');
      expect(state.equipment.length).toBe(1);
    });

    it('returns help for unrecognized input', async () => {
      const state = freshState();
      const service = new AIAssistantService(state);
      const reply = await service.processMessage('asdfghjkl');
      expect(reply.content).toContain('I can help');
    });

    it('maintains conversation history', async () => {
      const state = freshState();
      const service = new AIAssistantService(state);
      await service.processMessage('add display');
      await service.processMessage('list equipment');
      expect(service.getHistory().length).toBe(4); // 2 user + 2 assistant
    });
  });

  describe('AV_TOOL_DEFINITIONS', () => {
    it('defines expected tools', () => {
      const names = AV_TOOL_DEFINITIONS.map((t) => t.name);
      expect(names).toContain('add_device');
      expect(names).toContain('connect_devices');
      expect(names).toContain('audit_design');
      expect(names).toContain('list_equipment');
      expect(names).toContain('set_room');
    });
  });
});
