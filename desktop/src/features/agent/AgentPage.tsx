import { useAuth } from '../../auth/AuthProvider'
import { AgentChat } from './AgentChat'

/** A tenant or user switch starts a new conversation and aborts the old one. */
export function AgentPage() {
  const { tenant, user } = useAuth()
  const identity = `${tenant?.id}:${user?.id}`
  return <AgentChat key={identity} historyKey={tenant && user ? `courseboard:agent-history:${identity}` : undefined} />
}
