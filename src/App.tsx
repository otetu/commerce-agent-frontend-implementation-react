import { useState } from 'react';
import { AuthTokenInput } from './app/components/AuthTokenInput';
import { ConversationHeader } from './app/components/ConversationHeader';
import { ConversationHistory } from './app/components/ConversationHistory';
import { PromptComposer } from './app/components/PromptComposer';
import { StorefrontSearchBox } from './app/components/StorefrontSearchBox';
import { TranscriptPanel } from './app/components/TranscriptPanel';
// Importing the history store hydrates the conversation store from
// localStorage and wires up per-turn persistence of the saved list.
import './app/services/conversation-history-store';
import { conversationStore } from './app/services/conversation-store';
import { useStoreState } from './app/store';

export default function App() {
  const conversation = useStoreState(conversationStore);
  const [searchExpanded, setSearchExpanded] = useState(false);
  // The canned conversation starters (empty-state chips + popular-queries
  // grid) describe the mock catalog, so they only render in mock mode.
  const showStarters = conversation.agentMode !== 'live';

  return (
    <main className="shell">
      <header className={`storefront-header${searchExpanded ? ' expanded' : ''}`}>
        <div className="storefront-brand">
          <span className="storefront-brand-name">Conversational Discovery</span>
          <span className="storefront-brand-sub">Commerce agent reference app</span>
        </div>
        <StorefrontSearchBox
          disabled={conversation.busy}
          showPopularQueries={showStarters}
          onSubmitGenerative={(prompt) => conversationStore.submitPrompt(prompt)}
          onExpandedChange={setSearchExpanded}
        />
        <div className="storefront-header-controls">
          {conversation.agentMode === 'live' && <AuthTokenInput />}
          <ConversationHeader
            threadId={conversation.threadId}
            conversationId={conversation.conversationId}
            status={conversation.status}
            historyCount={conversation.messages.length}
            agentMode={conversation.agentMode}
            busy={conversation.busy}
            onAgentModeChange={(enabled) => conversationStore.toggleAgentMode(enabled)}
          />
        </div>
      </header>

      <section className="workspace">
        <div className="workspace-controls">
          <ConversationHistory />
        </div>
        <article className="panel transcript-panel">
          <TranscriptPanel
            messages={conversation.messages}
            reasoningText={conversation.reasoningText}
            toolActivity={conversation.toolActivity}
            surfaces={conversation.surfaces}
            completedTurns={conversation.completedTurns}
            showQuickActions={showStarters}
            onResetConversation={() => conversationStore.resetConversation()}
            onQuickAction={(action) => conversationStore.useQuickAction(action)}
          />
        </article>
      </section>

      <div className="composer-bar">
        <PromptComposer
          draft={conversation.draft}
          busy={conversation.busy}
          status={conversation.status}
          onDraftChange={(value) => conversationStore.setDraft(value)}
          onSubmitPrompt={() => conversationStore.submitPrompt()}
        />
      </div>
    </main>
  );
}
