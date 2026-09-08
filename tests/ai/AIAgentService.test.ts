import { describe, it, expect } from 'vitest';
import {
  parseOfflineIntent,
  executeToolCall,
  AV_TOOL_DEFINITIONS,
  AIAssistantService
} from '../../src/ai/ai-agent-service';
import { AppState } from '../../src/app/AppState';
import type { AIToolCall } from '../../src/ai/AIAgentTypes';

import { createDefaultRoom } from '../../src/room/RoomModel';

function freshState(): AppState {
  const state = new AppState();
  state.room = createDefaultRoom();
  return state;
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

    it('parses "auto fix issues" and synonyms', () => {
      const intent1 = parseOfflineIntent('auto fix issues');
      expect(intent1).not.toBeNull();
      expect(intent1!.name).toBe('auto_solve_findings');

      const intent2 = parseOfflineIntent('solve findings');
      expect(intent2).not.toBeNull();
      expect(intent2!.name).toBe('auto_solve_findings');

      const intent3 = parseOfflineIntent('click to fix');
      expect(intent3).not.toBeNull();
      expect(intent3!.name).toBe('auto_solve_findings');
    });

    it('parses "recommend bom" and synonyms', () => {
      const intent1 = parseOfflineIntent('recommend bom');
      expect(intent1).not.toBeNull();
      expect(intent1!.name).toBe('recommend_bom');

      const intent2 = parseOfflineIntent('what am i missing');
      expect(intent2).not.toBeNull();
      expect(intent2!.name).toBe('recommend_bom');

      const intent3 = parseOfflineIntent('suggest equipment');
      expect(intent3).not.toBeNull();
      expect(intent3!.name).toBe('recommend_bom');
    });

    it('parses "optimize layout" and synonyms', () => {
      const intent1 = parseOfflineIntent('optimize layout');
      expect(intent1).not.toBeNull();
      expect(intent1!.name).toBe('optimize_layout');

      const intent2 = parseOfflineIntent('center display');
      expect(intent2).not.toBeNull();
      expect(intent2!.name).toBe('optimize_layout');
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
      expect(state.equipment.length).toBeGreaterThanOrEqual(1);
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
      expect(result.message).toContain('Equipment');
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
      expect(result.message.length).toBeGreaterThan(0);
    });

    it('executes recommend_bom tool', () => {
      const state = freshState();
      const call: AIToolCall = {
        id: 'test-bom',
        name: 'recommend_bom',
        arguments: {},
        status: 'pending'
      };
      const result = executeToolCall(call, state);
      expect(result.success).toBe(true);
      expect(result.message).toMatch(/(Recommended BOM Additions|complete)/);
    });

    it('executes optimize_layout tool to center display', () => {
      const state = freshState();
      // Add a display off-center
      state.addEquipment({
        instanceId: 'disp-test-1',
        productId: 'samsung-qm75b',
        name: 'Samsung QM75B',
        position: { x: 1.5, y: 1.5, z: -2.9 },
        rotationY: 0,
        wall: 'front'
      });
      const call: AIToolCall = {
        id: 'test-opt',
        name: 'optimize_layout',
        arguments: {},
        status: 'pending'
      };
      const result = executeToolCall(call, state);
      expect(result.success).toBe(true);
      expect(result.message).toContain('Layout Optimized');
      // Display should now be centered at x=0
      const display = state.equipment.find((e) => e.productId.includes('qm75b'));
      expect(display).toBeDefined();
      expect(display!.position.x).toBe(0);
    });

    it('executes auto_solve_findings tool', () => {
      const state = freshState();
      const call: AIToolCall = {
        id: 'test-solve',
        name: 'auto_solve_findings',
        arguments: {},
        status: 'pending'
      };
      const result = executeToolCall(call, state);
      expect(result).toBeDefined();
      expect(typeof result.success).toBe('boolean');
      expect(result.message.length).toBeGreaterThan(0);
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
      const initialCount = state.equipment.length;
      const service = new AIAssistantService(state);
      const reply = await service.processMessage('add display');
      expect(reply.role).toBe('assistant');
      expect(state.equipment.length).toBeGreaterThan(initialCount);
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

  describe('AppState Copilot Integration', () => {
    it('toggles assistant tabs between copilot and checklist', () => {
      const state = freshState();
      expect(state.assistantTab).toBe('copilot');
      state.setAssistantTab('checklist');
      expect(state.assistantTab).toBe('checklist');
      state.setAssistantTab('copilot');
      expect(state.assistantTab).toBe('copilot');
    });

    it('dispatches copilot message and updates history in AppState', async () => {
      const state = freshState();
      expect(state.copilotMessages.length).toBe(0);
      expect(state.copilotTyping).toBe(false);

      await state.sendCopilotMessage('recommend bom');

      expect(state.copilotTyping).toBe(false);
      expect(state.copilotMessages.length).toBe(2);
      expect(state.copilotMessages[0].role).toBe('user');
      expect(state.copilotMessages[0].content).toBe('recommend bom');
      expect(state.copilotMessages[1].role).toBe('assistant');
      expect(state.copilotMessages[1].content).toMatch(/(BOM|complete)/);
    });

    it('clears copilot conversation history', async () => {
      const state = freshState();
      await state.sendCopilotMessage('audit design');
      expect(state.copilotMessages.length).toBe(2);

      state.clearCopilotHistory();
      expect(state.copilotMessages.length).toBe(0);
      expect(state.getAssistantService().getHistory().length).toBe(0);
    });
  });

  describe('AV_TOOL_DEFINITIONS', () => {
    it('defines expected tools', () => {
      const names = AV_TOOL_DEFINITIONS.map((t) => t.name);
      expect(names).toContain('add_device');
      expect(names).toContain('connect_devices');
      expect(names).toContain('audit_design');
      expect(names).toContain('auto_solve_findings');
      expect(names).toContain('recommend_bom');
      expect(names).toContain('optimize_layout');
      expect(names).toContain('list_equipment');
      expect(names).toContain('set_room');
    });
  });
});
