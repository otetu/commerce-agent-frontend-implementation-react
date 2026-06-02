import { computed, inject, Injectable, signal } from '@angular/core';
import { EMPTY, catchError, finalize, tap } from 'rxjs';
import {
  applyActivitySnapshot,
  createEmptySurfaceState,
  getRenderableSurfaces,
} from '../a2ui-parser';
import {
  ConversationViewModel,
  PersistedConversation,
  SurfaceState,
  ToolActivity,
} from '../conversation.interfaces';
import { demoAgentConfig, DemoAgentMode } from '../demo-agent.config';
import { AgUiEvent, ChatMessage, RenderableCommerceSurface } from '../models';
import { AgentDemoService } from './agent-demo.service';

@Injectable({ providedIn: 'root' })
export class DemoConversationFacade {
  private readonly agent = inject(AgentDemoService);

  readonly draft = signal('');
  readonly busy = signal(false);
  readonly status = signal('Ready');
  readonly agentMode = signal<DemoAgentMode>(demoAgentConfig.mode);
  readonly latestSnapshot = signal<Record<string, unknown> | null>(null);
  readonly conversationToken = signal<string | null>(null);
  readonly reasoningText = signal('');
  readonly toolActivity = signal<ToolActivity[]>([]);
  readonly threadId = signal(this.createId());
  readonly messages = signal<ChatMessage[]>([]);
  readonly surfaceState = signal<SurfaceState>(createEmptySurfaceState());

  readonly surfaces = computed(() => getRenderableSurfaces(this.surfaceState()));
  readonly historyCount = computed(() => this.messages().length);
  readonly modeLabel = computed(() =>
    this.agentMode() === 'mock' ? 'Mock AG-UI stream' : `Live via ${this.agent.getLiveTransport()}`,
  );
  readonly vm = computed<ConversationViewModel>(() => ({
    draft: this.draft(),
    busy: this.busy(),
    status: this.status(),
    agentMode: this.agentMode(),
    modeLabel: this.modeLabel(),
    threadId: this.threadId(),
    historyCount: this.historyCount(),
    messages: this.messages(),
    reasoningText: this.reasoningText(),
    toolActivity: this.toolActivity(),
    surfaces: this.surfaces(),
    latestSnapshot: this.latestSnapshot(),
  }));
  readonly persistenceSnapshot = computed<PersistedConversation>(() => ({
    agentMode: this.agentMode(),
    threadId: this.threadId(),
    conversationToken: this.conversationToken(),
    messages: this.messages(),
    surfaces: this.surfaces(),
    latestSnapshot: this.latestSnapshot(),
    reasoningText: this.reasoningText(),
    toolActivity: this.toolActivity(),
  }));

  hydrate(conversation: PersistedConversation | null): void {
    if (!conversation) {
      return;
    }

    this.agentMode.set(conversation.agentMode);
    this.threadId.set(conversation.threadId);
    this.conversationToken.set(conversation.conversationToken);
    this.messages.set(conversation.messages);
    this.surfaceState.set(this.createRestoredSurfaceState(conversation.surfaces));
    this.latestSnapshot.set(conversation.latestSnapshot);
    this.reasoningText.set(conversation.reasoningText);
    this.toolActivity.set(conversation.toolActivity);
  }

  setDraft(value: string): void {
    this.draft.set(value);
  }

  submitPrompt(prompt = this.draft().trim()): void {
    const message = prompt.trim();
    let runFinished = false;
    let failed = false;

    if (!message || this.busy()) {
      return;
    }

    if (demoAgentConfig.logConversation) {
      console.log('[conversation]', { timestamp: new Date().toISOString(), threadId: this.threadId(), prompt: message });
    }

    this.startRun(message);

    this.agent
      .streamTurn(
        {
          threadId: this.threadId(),
          conversationSessionId: this.threadId(),
          conversationToken: this.conversationToken() ?? undefined,
          prompt: message,
        },
        this.agentMode(),
      )
      .pipe(
        tap((event) => {
          runFinished = this.handleEvent(event) || runFinished;
        }),
        catchError((error: unknown) => {
          failed = true;
          this.handleSubmitError(error);
          return EMPTY;
        }),
        finalize(() => {
          this.finalizeSubmit(runFinished, failed);
        }),
      )
      .subscribe();
  }

  useQuickAction(action: string): void {
    this.submitPrompt(action);
  }

  resetConversation(): void {
    this.threadId.set(this.createId());
    this.conversationToken.set(null);
    this.messages.set([]);
    this.surfaceState.set(createEmptySurfaceState());
    this.latestSnapshot.set(null);
    this.reasoningText.set('');
    this.toolActivity.set([]);
    this.status.set('Ready');
    this.busy.set(false);
  }

  toggleAgentMode(enabled: boolean): void {
    if (this.busy()) {
      return;
    }

    this.agentMode.set(enabled ? 'live' : 'mock');
  }

  private startRun(message: string): void {
    this.draft.set('');
    this.busy.set(true);
    this.status.set('Starting run');
    this.appendMessage({ id: this.createId(), role: 'user', text: message });
    this.surfaceState.set(createEmptySurfaceState());
    this.latestSnapshot.set(null);
    this.reasoningText.set('');
    this.toolActivity.set([]);
  }

  private handleSubmitError(error: unknown): void {
    const messageText = error instanceof Error ? error.message : 'The agent request failed.';
    this.appendMessage({
      id: this.createId(),
      role: 'assistant',
      text: `I could not complete that request. ${messageText}`,
    });
    this.status.set('Failed');
  }

  private finalizeSubmit(runFinished: boolean, failed: boolean): void {
    if (!runFinished) {
      this.busy.set(false);
    }

    if (!runFinished && !failed) {
      this.status.set('Ready');
    }
  }

  private handleEvent(event: AgUiEvent): boolean {
    switch (event.type) {
      case 'RUN_STARTED':
        this.syncConversationContext(event);
        this.status.set('Run started');
        return false;
      case 'RUN_FINISHED':
        this.syncConversationContext(event);
        this.status.set('Ready');
        this.busy.set(false);
        return true;
      case 'RUN_ERROR':
        this.syncConversationContext(event);
        this.handleSubmitError(event.message);
        this.busy.set(false);
        return true;
      case 'TEXT_MESSAGE_START':
        this.ensureAssistantMessage(event.messageId);
        return false;
      case 'TEXT_MESSAGE_CONTENT':
        this.appendAssistantText(event.messageId, event.delta);
        return false;
      case 'STATE_SNAPSHOT':
        this.latestSnapshot.set(event.snapshot);
        this.status.set(this.extractStatusLabel(event.snapshot) ?? 'Updating storefront');
        return false;
      case 'ACTIVITY_SNAPSHOT':
        this.surfaceState.update((state) => applyActivitySnapshot(state, event.content));
        return false;
      case 'TOOL_CALL_START':
        this.startToolActivity(
          event.toolCallId ?? event.toolUseId ?? this.createId(),
          event.toolName ?? event.toolCallName ?? 'tool',
        );
        this.status.set(this.describeTool(event.toolName ?? event.toolCallName ?? 'tool'));
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
        this.reasoningText.set('');
        return false;
      case 'REASONING_MESSAGE_CONTENT':
        this.reasoningText.update((text) => `${text}${event.delta}`);
        return false;
      default:
        return false;
    }
  }

  private appendMessage(message: ChatMessage): void {
    this.messages.update((messages) => [...messages, message]);
  }

  private ensureAssistantMessage(id: string): void {
    this.messages.update((messages) => {
      if (messages.some((message) => message.id === id)) {
        return messages;
      }

      return [...messages, { id, role: 'assistant', text: '' }];
    });
  }

  private appendAssistantText(id: string, text: string): void {
    this.messages.update((messages) => {
      const index = messages.findIndex((message) => message.id === id);

      if (index === -1) {
        return [...messages, { id, role: 'assistant', text }];
      }

      const nextMessages = [...messages];
      nextMessages[index] = {
        ...nextMessages[index],
        text: `${nextMessages[index].text}${text}`,
      };
      return nextMessages;
    });
  }

  private createRestoredSurfaceState(surfaces: RenderableCommerceSurface[]): SurfaceState {
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

  private startToolActivity(id: string, name: string): void {
    this.toolActivity.update((items) => [
      ...items,
      {
        id,
        name,
        status: 'running',
        argsPreview: '',
        resultPreview: '',
      },
    ]);
  }

  private updateToolActivityArgs(id: string | undefined, argsDelta: string): void {
    if (!id || !argsDelta) {
      return;
    }

    this.toolActivity.update((items) =>
      items.map((item) =>
        item.id === id
          ? {
              ...item,
              argsPreview: trimPreview(`${item.argsPreview}${argsDelta}`),
            }
          : item,
      ),
    );
  }

  private updateToolActivityResult(id: string | undefined, result: string): void {
    if (!id || !result) {
      return;
    }

    this.toolActivity.update((items) =>
      items.map((item) =>
        item.id === id
          ? {
              ...item,
              resultPreview: trimPreview(result),
            }
          : item,
      ),
    );
  }

  private completeToolActivity(id: string | undefined): void {
    if (!id) {
      return;
    }

    this.toolActivity.update((items) =>
      items.map((item) =>
        item.id === id
          ? {
              ...item,
              status: 'completed',
            }
          : item,
      ),
    );
  }

  private extractStatusLabel(snapshot: Record<string, unknown>): string | null {
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

  private describeTool(toolName: string): string {
    const normalized = toolName.replace(/_/g, ' ');
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }

  private syncConversationContext(event: {
    threadId?: string;
    conversationSessionId?: string;
    conversationToken?: string;
  }): void {
    const conversationSessionId = event.conversationSessionId ?? event.threadId;
    if (conversationSessionId) {
      this.threadId.set(conversationSessionId);
    }

    if (event.conversationToken) {
      this.conversationToken.set(event.conversationToken);
    }
  }

  private createId(): string {
    return crypto.randomUUID();
  }
}

function trimPreview(value: string, maxLength = 120): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}...` : normalized;
}
