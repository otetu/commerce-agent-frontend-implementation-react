// =============================================================================
// Conversation history — local (localStorage) chat-history logic
// =============================================================================
//
// Owns the localStorage-backed list of past conversations and which one is
// active. The single active conversation's live state lives in
// `conversationStore`; this store snapshots it into the saved list and
// hydrates the conversation store when the shopper switches conversations.
//
// The logic is intentionally framework-light — the five pieces that matter
// when re-creating it elsewhere:
//
//   1. STORAGE SHAPE — persist an ARRAY of conversations, not just one.
//      Each record = the full conversation state you already persist
//      (messages / turns / tokens) PLUS three history fields:
//        • id        — stable local id, independent of any server session id
//        • title     — derived from the first user message (see deriveTitle)
//        • createdAt / updatedAt — ISO timestamps, used for sort + display
//      See the `StoredConversation` type in conversation.interfaces.ts.
//
//   2. STORAGE KEY — a single key holding the JSON array:
//        • New:    `discovery-demo-conversations`
//        • Legacy: `discovery-demo-conversation` (the pre-history,
//          single-conversation key) is migrated on first load and then
//          removed — see `migrateLegacy()`.
//      Newest first, capped at `historyCopy.maxConversations` (default 50).
//
//   3. LOAD + MIGRATE on startup (`load()` / `migrateLegacy()`), then
//      hydrate the live conversation state from the most recent record.
//
//   4. CAPTURE on every change — whenever the active conversation's state
//      changes, upsert it into the array (creating a record lazily on the
//      first user message) and re-save. Here that's the subscription on
//      `conversationStore` → `captureActive()`.
//
//   5. PUBLIC ACTIONS for the history UI: `startNew()`, `select(id)`,
//      `delete(id)` — each updates `activeId` and re-hydrates the live
//      conversation. The header dropdown (`ConversationHistory.tsx`) is a
//      thin renderer over `summaries` + these three actions.
// =============================================================================

import { historyCopy } from '../discovery-config';
import type {
  ConversationSummary,
  PersistedConversation,
  StoredConversation,
  ToolActivity,
} from '../conversation.interfaces';
import type { RenderableCommerceSurface } from '../models';
import { Store } from '../store';
import { conversationStore } from './conversation-store';

const STORAGE_KEY = 'discovery-demo-conversations';
const LEGACY_KEY = 'discovery-demo-conversation';

export type ConversationHistoryState = {
  conversations: StoredConversation[];
  /** Local id of the conversation currently loaded into the live store. */
  activeId: string | null;
  /** Sorted, lightweight rows for the history dropdown (newest first). */
  summaries: ConversationSummary[];
};

export class ConversationHistoryStore extends Store<ConversationHistoryState> {
  /** Set true to make the next capture run a no-op (after a programmatic hydrate). */
  private skipNextCapture = false;
  private lastCaptured: PersistedConversation | null = null;

  constructor() {
    super({ conversations: [], activeId: null, summaries: [] });

    const loaded = load();
    this.setConversations(loaded, null);

    if (loaded.length > 0) {
      const mostRecent = sortByRecency(loaded)[0];
      this.setState((state) => ({ ...state, activeId: mostRecent.id }));
      this.skipNextCapture = true;
      this.lastCaptured = conversationStore.persistenceSnapshot();
      conversationStore.hydrate(mostRecent);
    }

    // Snapshot the active conversation into the saved list whenever the
    // conversation store's persisted state changes (the React equivalent of
    // the Angular effect). Draft edits and other non-persisted fields are
    // skipped via a shallow compare of the snapshot's fields.
    conversationStore.subscribe(() => {
      const snapshot = conversationStore.persistenceSnapshot();
      if (this.lastCaptured && shallowEqualSnapshot(snapshot, this.lastCaptured)) {
        return;
      }
      this.lastCaptured = snapshot;
      this.captureActive(snapshot);
    });
  }

  count(): number {
    return this.getState().conversations.length;
  }

  /** Snapshot the current conversation (already saved) and start a blank one. */
  startNew(): void {
    this.skipNextCapture = true;
    conversationStore.resetConversation();
    this.setState((state) => ({ ...state, activeId: null }));
  }

  /** Load a saved conversation into the live conversation store. */
  select(id: string): void {
    if (id === this.getState().activeId) {
      return;
    }
    const record = this.getState().conversations.find((conversation) => conversation.id === id);
    if (!record) {
      return;
    }
    this.setState((state) => ({ ...state, activeId: id }));
    this.skipNextCapture = true;
    conversationStore.hydrate(record);
  }

  /** Remove a saved conversation; if it was active, fall back to the next one. */
  delete(id: string): void {
    const remaining = this.getState().conversations.filter(
      (conversation) => conversation.id !== id,
    );
    this.setConversations(remaining, this.getState().activeId);
    this.persist();

    if (id !== this.getState().activeId) {
      return;
    }

    const next = sortByRecency(remaining)[0];
    if (next) {
      this.setState((state) => ({ ...state, activeId: next.id }));
      this.skipNextCapture = true;
      conversationStore.hydrate(next);
    } else {
      this.startNew();
    }
  }

  private captureActive(snapshot: PersistedConversation): void {
    if (this.skipNextCapture) {
      this.skipNextCapture = false;
      return;
    }

    if (!hasContent(snapshot)) {
      return;
    }

    const id = this.getState().activeId ?? createId();

    const now = new Date().toISOString();
    const list = this.getState().conversations;
    const existing = list.find((conversation) => conversation.id === id);
    const record: StoredConversation = {
      ...snapshot,
      id,
      title: deriveTitle(snapshot),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    const others = list.filter((conversation) => conversation.id !== id);
    const next = sortByRecency([record, ...others]).slice(0, historyCopy.maxConversations);
    this.setConversations(next, id);

    this.persist();
  }

  private setConversations(conversations: StoredConversation[], activeId: string | null): void {
    this.setState((state) => ({
      ...state,
      conversations,
      activeId,
      summaries: sortByRecency(conversations).map((conversation) => ({
        id: conversation.id,
        title: conversation.title,
        updatedAt: conversation.updatedAt,
        messageCount:
          conversation.completedTurns.length + (conversation.messages.length ? 1 : 0),
      })),
    }));
  }

  private persist(): void {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.getState().conversations));
    } catch {
      // localStorage unavailable (private mode / quota) — degrade silently.
    }
  }
}

function shallowEqualSnapshot(a: PersistedConversation, b: PersistedConversation): boolean {
  return (
    a.agentMode === b.agentMode &&
    a.threadId === b.threadId &&
    a.conversationId === b.conversationId &&
    a.conversationToken === b.conversationToken &&
    a.messages === b.messages &&
    a.surfaces === b.surfaces &&
    a.latestSnapshot === b.latestSnapshot &&
    a.reasoningText === b.reasoningText &&
    a.toolActivity === b.toolActivity &&
    a.completedTurns === b.completedTurns
  );
}

function load(): StoredConversation[] {
  if (typeof window === 'undefined') {
    return [];
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed
            .map(normalizeStored)
            .filter((conversation): conversation is StoredConversation => conversation !== null)
        : [];
    } catch {
      return [];
    }
  }

  return migrateLegacy();
}

function migrateLegacy(): StoredConversation[] {
  const raw = window.localStorage.getItem(LEGACY_KEY);
  if (!raw) {
    return [];
  }
  try {
    const persisted = normalizePersisted(JSON.parse(raw) as Partial<PersistedConversation>);
    if (!hasContent(persisted)) {
      window.localStorage.removeItem(LEGACY_KEY);
      return [];
    }
    const now = new Date().toISOString();
    const migrated: StoredConversation = {
      ...persisted,
      id: createId(),
      title: deriveTitle(persisted),
      createdAt: now,
      updatedAt: now,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([migrated]));
    window.localStorage.removeItem(LEGACY_KEY);
    return [migrated];
  } catch {
    return [];
  }
}

function sortByRecency(list: StoredConversation[]): StoredConversation[] {
  return [...list].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function hasContent(snapshot: PersistedConversation): boolean {
  return snapshot.messages.length > 0 || snapshot.completedTurns.length > 0;
}

function deriveTitle(snapshot: PersistedConversation): string {
  const firstTurn = snapshot.completedTurns[0]?.userText;
  const firstUserMessage = snapshot.messages.find((message) => message.role === 'user')?.text;
  const text = (firstTurn ?? firstUserMessage ?? '').replace(/\s+/g, ' ').trim();
  if (!text) {
    return historyCopy.untitledLabel;
  }
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
}

function normalizePersisted(parsed: Partial<PersistedConversation>): PersistedConversation {
  return {
    // The demo persists the agent mode (mock / live) per conversation.
    agentMode: parsed.agentMode === 'live' ? 'live' : 'mock',
    threadId:
      typeof parsed.threadId === 'string' && parsed.threadId ? parsed.threadId : createId(),
    conversationId:
      typeof parsed.conversationId === 'string' && parsed.conversationId
        ? parsed.conversationId
        : null,
    conversationToken:
      typeof parsed.conversationToken === 'string' && parsed.conversationToken
        ? parsed.conversationToken
        : null,
    messages: Array.isArray(parsed.messages) ? parsed.messages : [],
    surfaces: Array.isArray(parsed.surfaces)
      ? (parsed.surfaces as RenderableCommerceSurface[])
      : [],
    latestSnapshot:
      parsed.latestSnapshot && typeof parsed.latestSnapshot === 'object'
        ? (parsed.latestSnapshot as Record<string, unknown>)
        : null,
    reasoningText: typeof parsed.reasoningText === 'string' ? parsed.reasoningText : '',
    toolActivity: Array.isArray(parsed.toolActivity)
      ? (parsed.toolActivity as ToolActivity[])
      : [],
    completedTurns: Array.isArray(parsed.completedTurns) ? parsed.completedTurns : [],
  };
}

function normalizeStored(value: unknown): StoredConversation | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const raw = value as Partial<StoredConversation>;
  const persisted = normalizePersisted(raw);
  const now = new Date().toISOString();
  return {
    ...persisted,
    id: typeof raw.id === 'string' && raw.id ? raw.id : createId(),
    title: typeof raw.title === 'string' && raw.title ? raw.title : deriveTitle(persisted),
    createdAt: typeof raw.createdAt === 'string' && raw.createdAt ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt ? raw.updatedAt : now,
  };
}

function createId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : 'conv-' + Math.random().toString(36).slice(2, 14);
}

/** Singleton instance — instantiating it hydrates the conversation store
 * from localStorage and wires per-turn persistence of the saved list. */
export const conversationHistoryStore = new ConversationHistoryStore();
