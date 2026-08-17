import { createTicketTools } from '../src/tools/tickets'

// Mock @linear/sdk so tests run without a real API key
jest.mock('@linear/sdk', () => {
  const mockIssue = jest.fn()
  const mockIssueSearch = jest.fn()
  const MockLinearClient = jest.fn().mockImplementation(() => ({
    issue: mockIssue,
    issueSearch: mockIssueSearch,
  }))
  return {
    LinearClient: MockLinearClient,
    _mockIssue: mockIssue,
    _mockIssueSearch: mockIssueSearch,
  }
})

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

  describe('when LINEAR_API_KEY is set', () => {
    const { _mockIssue, _mockIssueSearch } = jest.requireMock('@linear/sdk')

    beforeEach(() => {
      process.env.LINEAR_API_KEY = 'test-key'
      jest.clearAllMocks()
    })

    afterEach(() => {
      delete process.env.LINEAR_API_KEY
    })

    it('fetch_ticket returns formatted issue data', async () => {
      _mockIssue.mockResolvedValue({
        id: 'abc-123',
        title: 'Fix the bug',
        description: 'A detailed description',
        state: { name: 'In Progress' },
        priority: 2,
        url: 'https://linear.app/team/issue/FIR-1',
      })
      const tools = createTicketTools()
      const result = await tools.fetch_ticket.fn({ ticketId: 'FIR-1' })
      expect(result).toMatchObject({
        id: 'abc-123',
        title: 'Fix the bug',
        description: 'A detailed description',
        state: 'In Progress',
        priority: 2,
        url: 'https://linear.app/team/issue/FIR-1',
      })
    })

    it('fetch_ticket handles null state gracefully', async () => {
      _mockIssue.mockResolvedValue({
        id: 'abc-456',
        title: 'No state issue',
        description: null,
        state: null,
        priority: 0,
        url: 'https://linear.app/team/issue/FIR-2',
      })
      const tools = createTicketTools()
      const result = await tools.fetch_ticket.fn({ ticketId: 'FIR-2' })
      expect((result as { state: unknown }).state).toBeUndefined()
    })

    it('search_tickets returns mapped issue list', async () => {
      _mockIssueSearch.mockResolvedValue({
        nodes: [
          {
            id: 'n1',
            identifier: 'FIR-10',
            title: 'Auth bug',
            state: { name: 'Todo' },
            url: 'https://linear.app/t/FIR-10',
          },
          {
            id: 'n2',
            identifier: 'FIR-11',
            title: 'Login flow',
            state: null,
            url: 'https://linear.app/t/FIR-11',
          },
        ],
      })
      const tools = createTicketTools()
      const result = (await tools.search_tickets.fn({
        query: 'auth',
      })) as Array<Record<string, unknown>>
      expect(result).toHaveLength(2)
      expect(result[0]).toMatchObject({
        id: 'n1',
        identifier: 'FIR-10',
        title: 'Auth bug',
        state: 'Todo',
      })
      expect(result[1].state).toBeUndefined()
    })

    it('search_tickets passes custom limit to the SDK', async () => {
      _mockIssueSearch.mockResolvedValue({ nodes: [] })
      const tools = createTicketTools()
      await tools.search_tickets.fn({ query: 'deploy', limit: 3 })
      expect(_mockIssueSearch).toHaveBeenCalledWith('deploy', { first: 3 })
    })

    it('search_tickets uses default limit of 10 when not specified', async () => {
      _mockIssueSearch.mockResolvedValue({ nodes: [] })
      const tools = createTicketTools()
      await tools.search_tickets.fn({ query: 'deploy' })
      expect(_mockIssueSearch).toHaveBeenCalledWith('deploy', { first: 10 })
    })
  })
})
