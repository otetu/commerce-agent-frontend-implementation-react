import type { createEmptySurfaceState } from './a2ui-parser';
import type { DemoAgentMode } from './demo-agent.config';
import type { ChatMessage, RenderableCommerceSurface } from './models';

export type SurfaceState = ReturnType<typeof createEmptySurfaceState>;

export type ToolActivity = {
  id: string;
  name: string;
  status: 'running' | 'completed';
  argsPreview: string;
  resultPreview: string;
};

export type ConversationTurn = {
  id: string;
  userText: string;
  assistantText: string;
  surfaces: RenderableCommerceSurface[];
  reasoningText: string;
  toolActivity: ToolActivity[];
};

export type PersistedConversation = {
  agentMode: DemoAgentMode;
  threadId: string;
  /** Conversation id echoed back by the agent response (null until it replies). */
  conversationId: string | null;
  conversationToken: string | null;
  messages: ChatMessage[];
  surfaces: RenderableCommerceSurface[];
  latestSnapshot: Record<string, unknown> | null;
  reasoningText: string;
  toolActivity: ToolActivity[];
  completedTurns: ConversationTurn[];
};

/**
 * One saved conversation in the localStorage history. Carries the full
 * persisted conversation state plus a stable local id, a derived title,
 * and timestamps used for sorting / display in the history dropdown.
 */
export type StoredConversation = PersistedConversation & {
  /** Stable local id, independent of the server-issued threadId. */
  id: string;
  /** Title derived from the first user message (or a fallback). */
  title: string;
  /** ISO timestamp when the conversation was first created. */
  createdAt: string;
  /** ISO timestamp of the most recent activity. */
  updatedAt: string;
};

/** Lightweight projection used to render the history dropdown rows. */
export type ConversationSummary = {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
};

export type ConversationViewModel = {
  draft: string;
  busy: boolean;
  status: string;
  agentMode: DemoAgentMode;
  modeLabel: string;
  threadId: string;
  conversationId: string | null;
  historyCount: number;
  messages: ChatMessage[];
  reasoningText: string;
  toolActivity: ToolActivity[];
  surfaces: RenderableCommerceSurface[];
  latestSnapshot: Record<string, unknown> | null;
  completedTurns: ConversationTurn[];
};
