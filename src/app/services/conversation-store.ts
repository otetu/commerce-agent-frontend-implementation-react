// React port of the Angular DemoConversationFacade: owns the conversation
// state (messages, surfaces, reasoning, tool activity, completed turns) and
// is the single entry point for the UI.
import {
  applyActivitySnapshot,
  createEmptySurfaceState,
  getRenderableSurfaces,
} from '../a2ui-parser';
import type {
  ConversationTurn,
  PersistedConversation,
  SurfaceState,
  ToolActivity,
} from '../conversation.interfaces';
import { demoAgentConfig, type DemoAgentMode } from '../demo-agent.config';
import type { AgUiEvent, ChatMessage, RenderableCommerceSurface } from '../models';
import { Store } from '../store';
import { getLiveTransport, streamTurn, type Unsubscribe } from './agent-demo.service';

export type ConversationState = {
  draft: string;
  busy: boolean;
  status: string;
  agentMode: DemoAgentMode;
  latestSnapshot: Record<string, unknown> | null;
  conversationToken: string | null;
  reasoningText: string;
  toolActivity: ToolActivity[];
  threadId: string;
  conversationId: string | null;
  messages: ChatMessage[];
  surfaceState: SurfaceState;
  /** Derived from `surfaceState`; recomputed on every surface update. */
  surfaces: RenderableCommerceSurface[];
  completedTurns: ConversationTurn[];
};

export class ConversationStore extends Store<ConversationState> {
  private activeStream: Unsubscribe | null = null;

  constructor() {
    super({
      draft: '',
      busy: false,
      status: 'Ready',
      agentMode: demoAgentConfig.mode,
      latestSnapshot: null,
      conversationToken: null,
      reasoningText: '',
      toolActivity: [],
      threadId: createId(),
      conversationId: null,
      messages: [],
      surfaceState: createEmptySurfaceState(),
      surfaces: [],
      completedTurns: [],
    });
  }

  modeLabel(): string {
    return this.getState().agentMode === 'mock'
      ? 'Mock AG-UI stream'
      : `Live via ${getLiveTransport()}`;
  }

  historyCount(): number {
    return this.getState().messages.length;
  }

  persistenceSnapshot(): PersistedConversation {
    const state = this.getState();
    return {
      agentMode: state.agentMode,
      threadId: state.threadId,
      conversationId: state.conversationId,
      conversationToken: state.conversationToken,
      messages: state.messages,
      surfaces: state.surfaces,
      latestSnapshot: state.latestSnapshot,
      reasoningText: state.reasoningText,
      toolActivity: state.toolActivity,
      completedTurns: state.completedTurns,
    };
  }

  hydrate(conversation: PersistedConversation | null): void {
    if (!conversation) {
      return;
    }

    const surfaceState = createRestoredSurfaceState(conversation.surfaces);
    this.setState({
      agentMode: conversation.agentMode,
      threadId: conversation.threadId,
      conversationId: conversation.conversationId ?? null,
      conversationToken: conversation.conversationToken,
      messages: conversation.messages,
      surfaceState,
      surfaces: getRenderableSurfaces(surfaceState),
      latestSnapshot: conversation.latestSnapshot,
      reasoningText: conversation.reasoningText,
      toolActivity: conversation.toolActivity,
      completedTurns: conversation.completedTurns ?? [],
    });
  }

  setDraft(value: string): void {
    this.setState({ draft: value });
  }

  submitPrompt(prompt?: string): void {
    const message = (prompt ?? this.getState().draft).trim();
    let runFinished = false;
    let failed = false;

    if (!message || this.getState().busy) {
      return;
    }

    this.startRun(message);

    this.activeStream = streamTurn(
      {
        threadId: this.getState().threadId,
        conversationSessionId: this.getState().threadId,
        conversationToken: this.getState().conversationToken ?? undefined,
        prompt: message,
      },
      this.getState().agentMode,
      {
        next: (event) => {
          runFinished = this.handleEvent(event) || runFinished;
        },
        error: (error) => {
          failed = true;
          this.handleSubmitError(error);
          this.activeStream = null;
          this.finalizeSubmit(runFinished, failed);
        },
        complete: () => {
          this.activeStream = null;
          this.finalizeSubmit(runFinished, failed);
        },
      },
    );
  }

  useQuickAction(action: string): void {
    this.submitPrompt(action);
  }

  resetConversation(): void {
    this.activeStream?.();
    this.activeStream = null;
    this.setState({
      threadId: createId(),
      conversationId: null,
      conversationToken: null,
      messages: [],
      surfaceState: createEmptySurfaceState(),
      surfaces: [],
      latestSnapshot: null,
      reasoningText: '',
      toolActivity: [],
      completedTurns: [],
      status: 'Ready',
      busy: false,
    });
  }

  toggleAgentMode(enabled: boolean): void {
    if (this.getState().busy) {
      return;
    }

    this.setState({ agentMode: enabled ? 'live' : 'mock' });
  }

  private startRun(message: string): void {
    this.snapshotPreviousTurn();
    this.setState({
      draft: '',
      busy: true,
      status: 'Starting run',
      messages: [{ id: createId(), role: 'user', text: message }],
      surfaceState: createEmptySurfaceState(),
      surfaces: [],
      latestSnapshot: null,
      reasoningText: '',
      toolActivity: [],
    });
  }

  private snapshotPreviousTurn(): void {
    const state = this.getState();
    const userMessage = state.messages.find((m) => m.role === 'user');
    if (!userMessage) {
      return;
    }
    const assistantMessage = [...state.messages].reverse().find((m) => m.role === 'assistant');
    this.setState({
      completedTurns: [
        ...state.completedTurns,
        {
          id: userMessage.id,
          userText: userMessage.text,
          assistantText: assistantMessage?.text ?? '',
          surfaces: state.surfaces,
          reasoningText: state.reasoningText,
          toolActivity: state.toolActivity,
        },
      ],
    });
  }

  private handleSubmitError(error: unknown): void {
    const messageText = error instanceof Error ? error.message : 'The agent request failed.';
    this.appendMessage({
      id: createId(),
      role: 'assistant',
      text: `I could not complete that request. ${messageText}`,
    });
    this.setState({ status: 'Failed' });
  }

  private finalizeSubmit(runFinished: boolean, failed: boolean): void {
    if (!runFinished) {
      this.setState({ busy: false });
    }

    if (!runFinished && !failed) {
      this.setState({ status: 'Ready' });
    }
  }

  private handleEvent(event: AgUiEvent): boolean {
    switch (event.type) {
      case 'RUN_STARTED':
        this.syncConversationContext(event);
        this.setState({ status: 'Run started' });
        return false;
      case 'RUN_FINISHED':
        this.syncConversationContext(event);
        this.setState({ status: 'Ready', busy: false });
        return true;
      case 'RUN_ERROR':
        this.syncConversationContext(event);
        this.handleSubmitError(new Error(event.message));
        this.setState({ busy: false });
        return true;
      case 'TEXT_MESSAGE_START':
        this.ensureAssistantMessage(event.messageId);
        return false;
      case 'TEXT_MESSAGE_CONTENT':
        this.appendAssistantText(event.messageId, event.delta);
        return false;
      case 'STATE_SNAPSHOT':
        this.setState({
          latestSnapshot: event.snapshot,
          status: extractStatusLabel(event.snapshot) ?? 'Updating storefront',
        });
        return false;
      case 'ACTIVITY_SNAPSHOT':
        this.setState((state) => {
          const surfaceState = applyActivitySnapshot(state.surfaceState, event.content);
          return {
            ...state,
            surfaceState,
            surfaces: getRenderableSurfaces(surfaceState),
          };
        });
        return false;
      case 'TOOL_CALL_START':
        this.startToolActivity(
          event.toolCallId ?? event.toolUseId ?? createId(),
          event.toolName ?? event.toolCallName ?? 'tool',
        );
        this.setState({
          status: describeTool(event.toolName ?? event.toolCallName ?? 'tool'),
        });
        return false;
      case 'TOOL_CALL_ARGS':
        this.updateToolActivityArgs(
          event.toolCallId ?? event.toolUseId,
          event.delta ?? event.argsDelta ?? '',
        );
        return false;
      case 'TOOL_CALL_RESULT':
        this.updateToolActivityResult(event.toolCallId ?? event.toolUseId, event.content ?? '');
        return false;
      case 'TOOL_CALL_END':
        this.completeToolActivity(event.toolCallId ?? event.toolUseId);
        return false;
      case 'REASONING_MESSAGE_START':
        this.setState({ reasoningText: '' });
        return false;
      case 'REASONING_MESSAGE_CONTENT':
        this.setState((state) => ({
          ...state,
          reasoningText: `${state.reasoningText}${event.delta}`,
        }));
        return false;
      default:
        return false;
    }
  }

  private appendMessage(message: ChatMessage): void {
    this.setState((state) => ({ ...state, messages: [...state.messages, message] }));
  }

  private ensureAssistantMessage(id: string): void {
    this.setState((state) => {
      if (state.messages.some((message) => message.id === id)) {
        return state;
      }

      return { ...state, messages: [...state.messages, { id, role: 'assistant', text: '' }] };
    });
  }

  private appendAssistantText(id: string, text: string): void {
    this.setState((state) => {
      const index = state.messages.findIndex((message) => message.id === id);

      if (index === -1) {
        return { ...state, messages: [...state.messages, { id, role: 'assistant', text }] };
      }

      const nextMessages = [...state.messages];
      nextMessages[index] = {
        ...nextMessages[index],
        text: `${nextMessages[index].text}${text}`,
      };
      return { ...state, messages: nextMessages };
    });
  }

  private startToolActivity(id: string, name: string): void {
    this.setState((state) => ({
      ...state,
      toolActivity: [
        ...state.toolActivity,
        {
          id,
          name,
          status: 'running',
          argsPreview: '',
          resultPreview: '',
        },
      ],
    }));
  }

  private updateToolActivityArgs(id: string | undefined, argsDelta: string): void {
    if (!id || !argsDelta) {
      return;
    }

    this.setState((state) => ({
      ...state,
      toolActivity: state.toolActivity.map((item) =>
        item.id === id
          ? {
              ...item,
              argsPreview: trimPreview(`${item.argsPreview}${argsDelta}`),
            }
          : item,
      ),
    }));
  }

  private updateToolActivityResult(id: string | undefined, result: string): void {
    if (!id || !result) {
      return;
    }

    this.setState((state) => ({
      ...state,
      toolActivity: state.toolActivity.map((item) =>
        item.id === id
          ? {
              ...item,
              resultPreview: trimPreview(result),
            }
          : item,
      ),
    }));
  }

  private completeToolActivity(id: string | undefined): void {
    if (!id) {
      return;
    }

    this.setState((state) => ({
      ...state,
      toolActivity: state.toolActivity.map((item) =>
        item.id === id
          ? {
              ...item,
              status: 'completed' as const,
            }
          : item,
      ),
    }));
  }

  private syncConversationContext(event: {
    threadId?: string;
    conversationSessionId?: string;
    conversationToken?: string;
  }): void {
    const conversationSessionId = event.conversationSessionId ?? event.threadId;
    const patch: Partial<ConversationState> = {};
    if (conversationSessionId) {
      patch.threadId = conversationSessionId;
    }

    // The conversation id is whatever the server echoes back in the response,
    // independent of the locally-generated thread id we start each run with.
    if (event.conversationSessionId) {
      patch.conversationId = event.conversationSessionId;
    }

    if (event.conversationToken) {
      patch.conversationToken = event.conversationToken;
    }

    if (Object.keys(patch).length > 0) {
      this.setState(patch);
    }
  }
}

function createRestoredSurfaceState(surfaces: RenderableCommerceSurface[]): SurfaceState {
  const orderById = surfaces.reduce<Record<string, number>>((result, surface, index) => {
    result[surface.surfaceId] = index;
    return result;
  }, {});

  const surfacesById = surfaces.reduce<Record<string, RenderableCommerceSurface>>(
    (result, surface) => {
      result[surface.surfaceId] = surface;
      return result;
    },
    {},
  );

  return {
    orderById,
    surfacesById,
  };
}

function extractStatusLabel(snapshot: Record<string, unknown>): string | null {
  const directLabel = snapshot['label'];
  if (typeof directLabel === 'string' && directLabel) {
    return directLabel;
  }

  const execution = snapshot['policy_execution_state'];
  if (execution && typeof execution === 'object') {
    const currentState = (execution as Record<string, unknown>)['current_state'];
    if (typeof currentState === 'string' && currentState) {
      return currentState;
    }
  }

  return null;
}

function describeTool(toolName: string): string {
  const normalized = toolName.replace(/_/g, ' ');
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function createId(): string {
  return crypto.randomUUID();
}

function trimPreview(value: string, maxLength = 120): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}...` : normalized;
}

/** Singleton instance (equivalent of Angular's root-provided facade). */
export const conversationStore = new ConversationStore();
