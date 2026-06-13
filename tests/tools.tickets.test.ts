import { createTicketTools } from '../src/tools/tickets'

describe('createTicketTools', () => {
  it('registers the expected 2 tools', () => {
    const tools = createTicketTools()
    expect(Object.keys(tools).sort()).toEqual([
      'fetch_ticket',
      'search_tickets',
    ])
  })

  describe('when LINEAR_API_KEY is not set', () => {
    beforeEach(() => {
      delete process.env.LINEAR_API_KEY
    })

    it('fetch_ticket returns a graceful error message', async () => {
      const tools = createTicketTools()
      const result = await tools.fetch_ticket.fn({ ticketId: 'FIR-1' })
      expect((result as { error: string }).error).toMatch(/LINEAR_API_KEY/)
    })

    it('search_tickets returns a graceful error message', async () => {
      const tools = createTicketTools()
      const result = await tools.search_tickets.fn({ query: 'auth' })
      expect((result as { error: string }).error).toMatch(/LINEAR_API_KEY/)
    })
  })
})
