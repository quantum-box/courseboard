import type { ReservationStatus } from './reservation-status'

export type Entry = {
  id: string
  role: 'user' | 'assistant' | 'activity' | 'reservation'
  text: string
  reservation?: ReservationStatus
  turnId?: string
  state?: 'running' | 'ok' | 'error'
  tool?: string
  input?: string
  output?: string
}

export type Conversation = {
  id: string
  session: string | null
  entries: Entry[]
  draft: string
  error: string
  needsNew: boolean
  updatedAt: number
}

export type ConversationHistory = { activeId: string; conversations: Conversation[] }

/** Histories stay in this browser tab and are scoped to the signed-in user and tenant. */
export function readConversationHistory(key?: string): ConversationHistory | undefined {
  if (!key) return
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? 'null')
    if (value?.version !== 1 || typeof value.activeId !== 'string' || !Array.isArray(value.conversations)) return
    const valid = value.conversations.every((conversation: Conversation) =>
      conversation && typeof conversation.id === 'string'
      && (conversation.session === null || typeof conversation.session === 'string')
      && typeof conversation.draft === 'string' && typeof conversation.error === 'string'
      && typeof conversation.needsNew === 'boolean' && Number.isFinite(conversation.updatedAt)
      && Number.isFinite(new Date(conversation.updatedAt).getTime())
      && Array.isArray(conversation.entries) && conversation.entries.every(entry =>
        entry && typeof entry.id === 'string' && typeof entry.text === 'string'
        && ['user', 'assistant', 'activity', 'reservation'].includes(entry.role)
        && [entry.tool, entry.input, entry.output].every(value => value === undefined || typeof value === 'string')
        && (entry.state === undefined || ['running', 'ok', 'error'].includes(entry.state))
        && (entry.role !== 'reservation' || (entry.reservation && Array.isArray(entry.reservation.courses)
          && entry.reservation.courses.every(course => course && typeof course.courseName === 'string')
          && entry.reservation.remainingCapacity))))
    if (valid) {
      const scope = 'field-courseboard-v1'
      if ((value.agentScope ?? 'legacy') !== scope) {
        // Keep the visible transcript, but never reuse a different app's session.
        value.conversations = value.conversations.map((conversation: Conversation) => ({
          ...conversation, session: null, needsNew: true,
        }))
      }
      return value
    }
  } catch {
    // Unavailable storage or an older/corrupt snapshot must not prevent chatting.
  }
}

export function writeConversationHistory(key: string | undefined, history: ConversationHistory) {
  if (!key) return
  try {
    sessionStorage.setItem(key, JSON.stringify({ version: 1, agentScope: 'field-courseboard-v1', ...history }))
  } catch {
    // The current conversation and in-memory history still work when storage is full.
  }
}
