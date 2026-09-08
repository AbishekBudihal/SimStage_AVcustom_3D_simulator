/**
 * ai-agent-service.ts
 * Abstracted AI assistant service with pluggable LLM provider.
 * Ships with a built-in deterministic offline engine for common
 * AV design intents. External LLM providers (Gemini, OpenAI,
 * Anthropic, Ollama) can be plugged in without rewriting core logic.
 *
 * Decoupled from rendering — operates through AppState methods only.
 */

import type { AppState } from '../app/AppState';
import type { EquipmentCatalog } from '../catalog/EquipmentCatalog';
import { loadDefaultCatalog } from '../catalog/loadCatalog';
import { enumerateSignalPaths } from '../system/SignalPathEngine';
import { evaluateRackRequirement } from '../av/RackRequirement';
import { validationReportFor } from '../av/validation/validationCache';
import { computeDesignHealth, generateClickToFix } from '../av/DesignHealth';
import { inventory } from '../autodesign/DesignPipeline';
import type {
  AIChatMessage,
  AIToolDefinition,
  AIToolCall,
  AICommandResult,
  LLMProvider,
  LLMProviderConfig,
  LLMResponse
} from './AIAgentTypes';

const catalog = loadDefaultCatalog();

// ── Tool definitions ─────────────────────────────────────────

/** Tool schemas the AI agent can invoke against the engineering model. */
export const AV_TOOL_DEFINITIONS: AIToolDefinition[] = [
  {
    name: 'add_device',
    description: 'Add an equipment device to the AV design from the catalog.',
    parameters: {
      category: { type: 'string', description: 'Equipment category (display, camera, microphone, speaker, dsp, amplifier, switcher, etc.)', required: true },
      manufacturer: { type: 'string', description: 'Manufacturer name filter (optional)' },
      model: { type: 'string', description: 'Model name filter (optional)' },
      wall: { type: 'string', description: 'Wall placement (front, back, left, right)', enum: ['front', 'back', 'left', 'right'] }
    }
  },
  {
    name: 'connect_devices',
    description: 'Connect two devices with an auto-detected compatible port pair.',
    parameters: {
      fromDevice: { type: 'string', description: 'Name or partial name of the source device.', required: true },
      toDevice: { type: 'string', description: 'Name or partial name of the destination device.', required: true }
    }
  },
  {
    name: 'audit_design',
    description: 'Audit the current AV design for signal flow completeness, rack requirements, and engineering issues.',
    parameters: {}
  },
  {
    name: 'auto_solve_findings',
    description: 'Automatically solve actionable engineering warnings and errors using deterministic click-to-fix rules.',
    parameters: {}
  },
  {
    name: 'recommend_bom',
    description: 'Analyze room and requirements to recommend missing equipment and Bill of Materials upgrades.',
    parameters: {}
  },
  {
    name: 'optimize_layout',
    description: 'Optimize spatial positioning of equipment such as centering front display or spacing mics.',
    parameters: {}
  },
  {
    name: 'list_equipment',
    description: 'List all equipment in the current design with their categories and connection status.',
    parameters: {}
  },
  {
    name: 'set_room',
    description: 'Set the room dimensions.',
    parameters: {
      widthM: { type: 'number', description: 'Room width in meters.', required: true },
      depthM: { type: 'number', description: 'Room depth in meters.', required: true },
      heightM: { type: 'number', description: 'Room height in meters.' }
    }
  }
];

// ── Tool execution engine ────────────────────────────────────

/**
 * Execute a tool call against the live AppState.
 * Uses standard AppState API methods — never bypasses the model.
 */
export function executeToolCall(
  call: AIToolCall,
  state: AppState
): AICommandResult {
  switch (call.name) {
    case 'add_device': {
      const args = call.arguments as { category?: string; manufacturer?: string; model?: string; wall?: string };
      if (!args.category) return { success: false, message: 'Category is required.' };

      const products = catalog.search({
        category: args.category as any,
        manufacturer: args.manufacturer,
        text: args.model
      });

      if (!products.length) {
        return { success: false, message: `No products found for category "${args.category}"${args.manufacturer ? ` by ${args.manufacturer}` : ''}.` };
      }

      const product = products[0];
      const instanceId = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      state.addEquipment({
        instanceId,
        productId: product.id,
        name: `${product.manufacturer} ${product.model}`,
        position: { x: 0, y: 1, z: 0 },
        rotationY: 0,
        wall: (args.wall as any) ?? undefined,
        placementMode: 'smart',
        origin: 'auto'
      });
      state.select('equipment', instanceId);

      return {
        success: true,
        message: `Added ${product.manufacturer} ${product.model} (${product.category}).`,
        modifiedEntityIds: [instanceId],
        suggestedFollowUp: ['Connect this device to another', 'Add more equipment']
      };
    }

    case 'connect_devices': {
      const args = call.arguments as { fromDevice?: string; toDevice?: string };
      if (!args.fromDevice || !args.toDevice) return { success: false, message: 'Both fromDevice and toDevice are required.' };

      const from = state.equipment.find((e) => e.name.toLowerCase().includes(args.fromDevice!.toLowerCase()));
      const to = state.equipment.find((e) => e.name.toLowerCase().includes(args.toDevice!.toLowerCase()));

      if (!from) return { success: false, message: `Device matching "${args.fromDevice}" not found in design.` };
      if (!to) return { success: false, message: `Device matching "${args.toDevice}" not found in design.` };

      const ok = state.connectCompatiblePair(from.instanceId, to.instanceId);
      if (ok) {
        return {
          success: true,
          message: `Connected ${from.name} → ${to.name}.`,
          modifiedEntityIds: [from.instanceId, to.instanceId]
        };
      }
      return { success: false, message: `No compatible free ports between ${from.name} and ${to.name}.` };
    }

    case 'audit_design': {
      const rackReq = evaluateRackRequirement(state.equipment, catalog);
      const paths = enumerateSignalPaths(state.equipment, state.connections, catalog, state.routes);
      const completePaths = paths.filter((p) => p.complete).length;
      const brokenPaths = paths.filter((p) => !p.complete).length;
      const unconnected = state.equipment.filter((e) => {
        return !state.connections.some((c) => c.fromInstanceId === e.instanceId || c.toInstanceId === e.instanceId);
      });

      const lines = [
        `📊 Design Audit`,
        `Equipment: ${state.equipment.length} devices`,
        `Connections: ${state.connections.length}`,
        `Signal paths: ${completePaths} complete, ${brokenPaths} broken`,
        `Unconnected devices: ${unconnected.length}`,
        `Rack: ${rackReq.required ? `Required (${rackReq.totalRU} RU, ${rackReq.suggestedRackType})` : 'Not required'}`,
      ];
      if (unconnected.length > 0) {
        lines.push(`⚠ Unconnected: ${unconnected.map((e) => e.name).join(', ')}`);
      }
      if (brokenPaths > 0) {
        lines.push(`⚠ ${brokenPaths} signal path(s) are incomplete.`);
      }

      return { success: true, message: lines.join('\n') };
    }

    case 'auto_solve_findings': {
      const report = validationReportFor(state);
      const actionables = report.findings
        .filter((f) => f.severity === 'error' || f.severity === 'warning')
        .map((f) => generateClickToFix(f, catalog))
        .filter((act): act is NonNullable<typeof act> => Boolean(act));

      if (!actionables.length) {
        return { success: true, message: 'No active actionable findings to solve. System health is clean!' };
      }

      let solvedCount = 0;
      const solvedLabels: string[] = [];
      for (const act of actionables) {
        const ok = state.applyClickToFix(act);
        if (ok) {
          solvedCount++;
          solvedLabels.push(act.label);
        }
      }

      const updatedReport = validationReportFor(state);
      const updatedHealth = computeDesignHealth(updatedReport, state.equipment, state.seats, catalog);

      return {
        success: solvedCount > 0,
        message: solvedCount > 0
          ? `⚡ Resolved ${solvedCount} issue(s):\n• ${solvedLabels.join('\n• ')}\n\nCurrent Health Score: ${updatedHealth.score}/100.`
          : 'Could not automatically resolve remaining findings.',
        suggestedFollowUp: ['Audit design', 'List equipment']
      };
    }

    case 'recommend_bom': {
      const inv = inventory(
        {
          room: state.room,
          seats: state.seats,
          tables: state.tables,
          equipment: state.equipment,
          connections: state.connections,
          routes: state.routes
        },
        catalog
      );

      const recommendations: string[] = [];
      if (!inv.display) {
        recommendations.push('• Primary Display: Add commercial 75"–86" 4K display on front wall');
      }
      if (!inv.camera) {
        recommendations.push('• Camera: Add optical 4K auto-framing conference camera at front wall');
      }
      if (!inv.microphones) {
        recommendations.push('• Microphones: Add beamforming ceiling array or tabletop boundary mics');
      }
      if (!inv.audio) {
        recommendations.push('• Audio: Add distributed ceiling speakers or front soundbar for even coverage');
      }

      const rackReq = evaluateRackRequirement(state.equipment, catalog);
      if (rackReq.required && !state.racks.length) {
        recommendations.push(`• Equipment Rack: Add ${rackReq.totalRU} RU rack enclosure for ${rackReq.devices.length} rack device(s)`);
      }

      if (!recommendations.length) {
        return {
          success: true,
          message: '✓ Bill of Materials is complete for standard conferencing and presentation requirements!',
          suggestedFollowUp: ['Audit design', 'Connect devices']
        };
      }

      return {
        success: true,
        message: `📋 Recommended BOM Additions:\n${recommendations.join('\n')}`,
        suggestedFollowUp: ['Add display', 'Add camera', 'Add microphone', 'Add rack']
      };
    }

    case 'optimize_layout': {
      const display = state.equipment.find((e) => {
        const prod = catalog.get(e.productId);
        return prod?.category === 'display' || (e.name && e.name.toLowerCase().includes('display'));
      });
      const room = state.room ?? { width: 8, depth: 6, height: 3 };

      let optimized = false;
      const changes: string[] = [];

      // Center display on presentation wall
      if (display) {
        const wall = display.wall ?? 'front';
        let targetX = 0;
        let targetZ = display.position.z;
        let targetRot = display.rotationY;

        if (wall === 'front') {
          targetX = 0;
          targetZ = -room.depth / 2 + 0.08;
          targetRot = 0;
        } else if (wall === 'back') {
          targetX = 0;
          targetZ = room.depth / 2 - 0.08;
          targetRot = Math.PI;
        } else if (wall === 'left') {
          targetX = -room.width / 2 + 0.08;
          targetZ = 0;
          targetRot = Math.PI / 2;
        } else if (wall === 'right') {
          targetX = room.width / 2 - 0.08;
          targetZ = 0;
          targetRot = -Math.PI / 2;
        }

        state.updateEquipment(display.instanceId, {
          position: { x: targetX, y: Math.max(1.4, Math.min(1.8, display.position.y)), z: targetZ },
          rotationY: targetRot
        });
        optimized = true;
        const displayName = display.name || 'Display';
        changes.push(`Centered ${displayName} on ${wall} wall at ergonomic presentation height.`);
      }

      if (optimized) {
        return {
          success: true,
          message: `🎯 Layout Optimized:\n• ${changes.join('\n• ')}`,
          suggestedFollowUp: ['Audit design', 'Check sightlines']
        };
      }

      return { success: true, message: 'Layout is already well aligned to room axes.' };
    }

    case 'list_equipment': {
      if (!state.equipment.length) return { success: true, message: 'No equipment in the design.' };
      const lines = state.equipment.map((e) => {
        const product = catalog.get(e.productId);
        const conns = state.connections.filter((c) => c.fromInstanceId === e.instanceId || c.toInstanceId === e.instanceId);
        return `• ${e.name} [${product?.category ?? 'unknown'}] — ${conns.length} connection(s)${e.rackId ? ' (racked)' : ''}`;
      });
      return { success: true, message: lines.join('\n') };
    }

    case 'set_room': {
      const args = call.arguments as { widthM?: number; depthM?: number; heightM?: number };
      if (!args.widthM || !args.depthM) return { success: false, message: 'widthM and depthM are required.' };
      if (state.room) {
        state.setRoom({
          ...state.room,
          width: args.widthM,
          depth: args.depthM,
          height: args.heightM ?? state.room.height
        });
        return { success: true, message: `Room set to ${args.widthM}m × ${args.depthM}m × ${args.heightM ?? state.room.height}m.` };
      }
      return { success: false, message: 'No room exists yet. Create a project first.' };
    }

    default:
      return { success: false, message: `Unknown tool: ${call.name}` };
  }
}

// ── Offline deterministic engine ─────────────────────────────

/**
 * Simple intent parser for common AV design commands.
 * No external API required — works entirely offline.
 */
export function parseOfflineIntent(userMessage: string): AIToolCall | null {
  const msg = userMessage.toLowerCase().trim();

  // "add [size?] display/camera/mic/speaker/dsp/amplifier [on wall?]"
  const addMatch = msg.match(/add\s+(?:a\s+)?(?:(\d+)\s*(?:inch|")\s+)?(\w+)(?:\s+(?:on|to)\s+(\w+)\s+wall)?/);
  if (addMatch) {
    const [, , category, wall] = addMatch;
    const catMap: Record<string, string> = {
      display: 'display', screen: 'display', monitor: 'display', tv: 'display',
      camera: 'camera', cam: 'camera', ptz: 'camera',
      mic: 'microphone', microphone: 'microphone',
      speaker: 'speaker', speakers: 'speaker',
      dsp: 'dsp', processor: 'dsp',
      amp: 'amplifier', amplifier: 'amplifier',
      switcher: 'switcher', matrix: 'switcher',
    };
    const resolved = catMap[category ?? ''];
    if (resolved) {
      return {
        id: `intent-${Date.now()}`,
        name: 'add_device',
        arguments: { category: resolved, wall: wall ?? undefined },
        status: 'pending'
      };
    }
  }

  // "connect X to Y"
  const connectMatch = msg.match(/connect\s+(.+?)\s+to\s+(.+)/);
  if (connectMatch) {
    return {
      id: `intent-${Date.now()}`,
      name: 'connect_devices',
      arguments: { fromDevice: connectMatch[1].trim(), toDevice: connectMatch[2].trim() },
      status: 'pending'
    };
  }

  // "audit" / "check design" / "validate"
  if (/audit|check\s+design|validate|review/.test(msg)) {
    return {
      id: `intent-${Date.now()}`,
      name: 'audit_design',
      arguments: {},
      status: 'pending'
    };
  }

  // "fix" / "auto fix" / "solve" / "resolve"
  if (/fix|solve|resolve\s+(?:all|issues|findings|warnings)|click\s+to\s+fix/.test(msg)) {
    return {
      id: `intent-${Date.now()}`,
      name: 'auto_solve_findings',
      arguments: {},
      status: 'pending'
    };
  }

  // "recommend" / "bom" / "what am i missing" / "suggest equipment"
  if (/recommend|suggest|what(?:\s+am\s+i|\s+is)?\s+missing|bom|bill\s+of\s+materials/.test(msg)) {
    return {
      id: `intent-${Date.now()}`,
      name: 'recommend_bom',
      arguments: {},
      status: 'pending'
    };
  }

  // "optimize" / "center display" / "align layout"
  if (/optimize|center\s+display|align\s+layout|clean\s+layout/.test(msg)) {
    return {
      id: `intent-${Date.now()}`,
      name: 'optimize_layout',
      arguments: {},
      status: 'pending'
    };
  }

  // "list equipment" / "show devices"
  if (/list\s+(?:equipment|devices)|show\s+(?:equipment|devices)/.test(msg)) {
    return {
      id: `intent-${Date.now()}`,
      name: 'list_equipment',
      arguments: {},
      status: 'pending'
    };
  }

  return null;
}

// ── AIAssistantService class ─────────────────────────────────

/**
 * AI assistant service with pluggable LLM provider.
 * Falls back to the deterministic offline engine when no provider is configured.
 */
export class AIAssistantService {
  private provider: LLMProvider | null = null;
  private history: AIChatMessage[] = [];

  constructor(private state: AppState) {}

  /** Plug in an external LLM provider. */
  setProvider(provider: LLMProvider): void {
    this.provider = provider;
  }

  /** Get conversation history. */
  getHistory(): readonly AIChatMessage[] {
    return this.history;
  }

  /** Clear conversation history. */
  clearHistory(): void {
    this.history = [];
  }

  /**
   * Process a user message. Uses LLM if available, otherwise
   * falls back to the deterministic offline intent engine.
   */
  async processMessage(userContent: string): Promise<AIChatMessage> {
    const userMsg: AIChatMessage = {
      role: 'user',
      content: userContent,
      timestamp: Date.now()
    };
    this.history.push(userMsg);

    // Try LLM provider first
    if (this.provider) {
      try {
        const response = await this.provider.call(
          this.history,
          AV_TOOL_DEFINITIONS
        );

        if (response.toolCalls?.length) {
          const results: string[] = [];
          for (const tc of response.toolCalls) {
            const result = executeToolCall(tc, this.state);
            tc.status = result.success ? 'success' : 'error';
            tc.result = result;
            results.push(result.message);
          }
          const reply: AIChatMessage = {
            role: 'assistant',
            content: results.join('\n\n'),
            toolCalls: response.toolCalls,
            timestamp: Date.now()
          };
          this.history.push(reply);
          return reply;
        }

        const reply: AIChatMessage = {
          role: 'assistant',
          content: response.content,
          timestamp: Date.now()
        };
        this.history.push(reply);
        return reply;
      } catch (e) {
        // Fall through to offline engine
      }
    }

    // Offline deterministic engine
    const intent = parseOfflineIntent(userContent);
    if (intent) {
      const result = executeToolCall(intent, this.state);
      intent.status = result.success ? 'success' : 'error';
      intent.result = result;
      const reply: AIChatMessage = {
        role: 'assistant',
        content: result.message,
        toolCalls: [intent],
        timestamp: Date.now()
      };
      this.history.push(reply);
      return reply;
    }

    // No recognized intent
    const fallback: AIChatMessage = {
      role: 'assistant',
      content: `I can help with AV design tasks. Try:\n• "Auto fix issues"\n• "Recommend BOM"\n• "Optimize layout"\n• "Add display on front wall"\n• "Connect switcher to display"\n• "Audit design"\n• "List equipment"`,
      timestamp: Date.now()
    };
    this.history.push(fallback);
    return fallback;
  }
}
