import { z } from 'zod'
import type { ToolEntry } from '../harness/tools'

// ── Schemas ───────────────────────────────────────────────────────────────────

const FetchTicketSchema = z.object({
  ticketId: z.string(),
})

const SearchTicketsSchema = z.object({
  query: z.string(),
  teamKey: z.string().optional(),
  limit: z.number().optional(),
})

// ── Linear API client (lazy init) ─────────────────────────────────────────────

interface LinearClient {
  issue(id: string): Promise<{
    id: string
    title: string
    description: string | null
    state: { name: string } | null
    priority: number
    url: string
  }>
  issueSearch(
    query: string,
    options?: { first?: number }
  ): Promise<{
    nodes: Array<{
      id: string
      identifier: string
      title: string
      state: { name: string } | null
      url: string
    }>
  }>
}

function createLinearClient(): LinearClient | null {
  const key = process.env.LINEAR_API_KEY
  if (!key) return null

  // Lazy import to avoid loading the SDK when Linear isn't configured
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { LinearClient } = require('@linear/sdk')
  return new LinearClient({ apiKey: key }) as LinearClient
}

// ── Tool factory ──────────────────────────────────────────────────────────────

export function createTicketTools(): Record<string, ToolEntry> {
  const linear = createLinearClient()

  return {
    fetch_ticket: {
      description:
        'Fetch a Linear ticket by ID (e.g. "FIR-4"). Returns title, description, state, and URL. Returns an error if LINEAR_API_KEY is not set.',
      schema: FetchTicketSchema,
      fn: async ({ ticketId }) => {
        if (!linear) {
          return {
            error: 'LINEAR_API_KEY not configured — ticket fetch skipped',
          }
        }
        const issue = await linear.issue(ticketId)
        return {
          id: issue.id,
          title: issue.title,
          description: issue.description,
          state: issue.state?.name,
          priority: issue.priority,
          url: issue.url,
        }
      },
    },

    search_tickets: {
      description:
        'Search Linear tickets by keyword. Returns matching issue identifiers, titles, and states.',
      schema: SearchTicketsSchema,
      fn: async ({ query, limit }) => {
        if (!linear) {
          return {
            error: 'LINEAR_API_KEY not configured — ticket search skipped',
          }
        }
        const result = await linear.issueSearch(query, { first: limit ?? 10 })
        return result.nodes.map(n => ({
          id: n.id,
          identifier: n.identifier,
          title: n.title,
          state: n.state?.name,
          url: n.url,
        }))
      },
    },
  }
}
