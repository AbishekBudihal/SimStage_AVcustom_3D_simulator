import { EquipmentCategory } from '../catalog/EquipmentCatalog';
import { SignalType } from '../system/SystemTypes';

/**
 * Role of the message in an AI conversation
 */
export type AIMessageRole = 'user' | 'assistant' | 'system' | 'tool';

/**
 * Status of an AI tool call
 */
export type AIToolCallStatus = 'pending' | 'success' | 'error';

/**
 * Represents a tool call made by the AI
 */
export interface AIToolCall {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
    status: AIToolCallStatus;
    result?: unknown;
}

/**
 * Represents a single message in an AI chat
 */
export interface AIChatMessage {
    role: AIMessageRole;
    content: string;
    toolCalls?: AIToolCall[];
    timestamp: number;
}

/**
 * Definition of an AI tool available for the agent
 */
export interface AIToolDefinition {
    name: string;
    description: string;
    parameters: Record<string, { type: string; description: string; required?: boolean; enum?: string[] }>;
}

/**
 * Result of an AI executed command
 */
export interface AICommandResult {
    success: boolean;
    message: string;
    modifiedEntityIds?: string[];
    suggestedFollowUp?: string[];
}

/**
 * AI recommendation for Bill of Materials
 */
export interface AIBOMRecommendation {
    action: 'add' | 'remove' | 'replace';
    category: EquipmentCategory;
    productId?: string;
    reason: string;
    quantity: number;
}

/**
 * AI design audit results
 */
export interface AIDesignAudit {
    overallScore: number;
    findings: Array<{ area: string; severity: 'error' | 'warning' | 'info'; message: string }>;
    recommendations: string[];
}

/**
 * Configuration for an LLM provider
 */
export interface LLMProviderConfig {
    provider: 'gemini' | 'openai' | 'anthropic' | 'ollama' | 'offline';
    apiKey?: string;
    endpoint?: string;
    model?: string;
    maxTokens?: number;
    temperature?: number;
}

/**
 * Response from an LLM provider
 */
export interface LLMResponse {
    content: string;
    toolCalls?: AIToolCall[];
    tokensUsed?: number;
    finishReason?: 'stop' | 'tool_call' | 'length' | 'error';
}

/**
 * LLM Provider interface
 */
export interface LLMProvider {
    call(messages: AIChatMessage[], tools?: AIToolDefinition[]): Promise<LLMResponse>;
    readonly name: string;
}
