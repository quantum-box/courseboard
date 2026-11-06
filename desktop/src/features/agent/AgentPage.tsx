import { useAuth } from '../../auth/AuthProvider'
import { AgentChat } from './AgentChat'

/** A tenant or user switch starts a new conversation and aborts the old one. */
export function AgentPage() {
  const { tenant, user } = useAuth()
  return <AgentChat key={`${tenant?.id}:${user?.id}`} />
}
