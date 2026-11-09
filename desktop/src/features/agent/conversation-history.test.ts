/* @vitest-environment jsdom */
import { beforeEach, expect, it, vi } from 'vitest'
import { readConversationHistory, writeConversationHistory } from './conversation-history'
vi.mock('./chat-api', () => ({ usesSharedAgent: () => true }))
beforeEach(() => sessionStorage.clear())
const history = { activeId: 'conversation', conversations: [{
  id: 'conversation', session: 'as_legacy', entries: [{ id: 'message', role: 'assistant' as const, text: 'previous answer' }],
  draft: '', error: '', needsNew: false, updatedAt: 1,
}] }
it('retains old transcripts without resuming Field-labelled legacy sessions', () => {
  sessionStorage.setItem('history', JSON.stringify({ version: 1, ...history }))
  const restored = readConversationHistory('history')!
  expect(restored.conversations[0].entries).toEqual(history.conversations[0].entries)
  expect(restored.conversations[0].session).toBeNull()
  expect(restored.conversations[0].needsNew).toBe(true)
})
it('resumes sessions from the shared profile scope', () => {
  writeConversationHistory('history', history)
  expect(readConversationHistory('history')!.conversations[0].session).toBe('as_legacy')
})
