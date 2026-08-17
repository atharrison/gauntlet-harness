/**
 * Tests for src/harness/models.ts
 * Mocks @anthropic-ai/sdk so no real API calls are made.
 */

import { AnthropicClient, createModelClient } from '../src/harness/models'
import Anthropic from '@anthropic-ai/sdk'

jest.mock('@anthropic-ai/sdk')

const MockAnthropic = Anthropic as jest.MockedClass<typeof Anthropic>

let mockCreate: jest.Mock

beforeEach(() => {
  mockCreate = jest.fn()
  MockAnthropic.mockImplementation(
    () => ({ messages: { create: mockCreate } }) as unknown as Anthropic
  )
})

afterEach(() => jest.clearAllMocks())

// Helper: build an Anthropic-shaped response
function makeResponse(
  content: Anthropic.ContentBlock[],
  usage = { input_tokens: 100, output_tokens: 200 }
) {
  return {
    content,
    usage,
    model: 'claude-3-5-sonnet-20241022',
    stop_reason: 'end_turn',
  }
}

describe('AnthropicClient.chat', () => {
  it('returns text content from a text-only response', async () => {
    mockCreate.mockResolvedValue(
      makeResponse([{ type: 'text', text: 'Hello world' }])
    )
    const client = new AnthropicClient('test-key', 'claude-3-5-sonnet-20241022')
    const reply = await client.chat([{ role: 'user', content: 'Hi' }], [])
    expect(reply.text).toBe('Hello world')
    expect(reply.toolCalls).toEqual([])
    expect(reply.usage).toEqual({ inputTokens: 100, outputTokens: 200 })
    expect(reply.model).toBe('claude-3-5-sonnet-20241022')
    expect(reply.cost).toBeGreaterThan(0)
  })

  it('extracts tool_use blocks as toolCalls', async () => {
    mockCreate.mockResolvedValue(
      makeResponse([
        {
          type: 'tool_use',
          id: 'tu_1',
          name: 'search',
          input: { query: 'test' },
        },
      ])
    )
    const client = new AnthropicClient('test-key', 'claude-3-5-sonnet-20241022')
    const reply = await client.chat(
      [{ role: 'user', content: 'Search for something' }],
      []
    )
    expect(reply.toolCalls).toHaveLength(1)
    expect(reply.toolCalls[0]).toMatchObject({
      id: 'tu_1',
      name: 'search',
      args: { query: 'test' },
    })
    expect(reply.text).toBe('')
  })

  it('handles mixed text + tool_use response', async () => {
    mockCreate.mockResolvedValue(
      makeResponse([
        { type: 'text', text: 'Let me look that up' },
        {
          type: 'tool_use',
          id: 'tu_2',
          name: 'fetch',
          input: { url: 'https://example.com' },
        },
      ])
    )
    const client = new AnthropicClient('test-key', 'claude-3-5-sonnet-20241022')
    const reply = await client.chat(
      [{ role: 'user', content: 'Fetch this' }],
      []
    )
    expect(reply.text).toBe('Let me look that up')
    expect(reply.toolCalls).toHaveLength(1)
  })

  it('converts tool-role messages to tool_result user messages', async () => {
    mockCreate.mockResolvedValue(makeResponse([{ type: 'text', text: 'Done' }]))
    const client = new AnthropicClient('test-key', 'claude-3-5-sonnet-20241022')
    await client.chat(
      [
        { role: 'user', content: 'Run tool' },
        {
          role: 'tool',
          content: '{"result": 42}',
          toolCallId: 'tu_1',
          toolName: 'calc',
        },
      ],
      []
    )
    const [callArgs] = mockCreate.mock.calls[0]
    const messages = callArgs.messages as Anthropic.MessageParam[]
    const toolResultMsg = messages.find(
      m =>
        Array.isArray(m.content) &&
        (m.content as Anthropic.ContentBlockParam[])[0]?.type === 'tool_result'
    )
    expect(toolResultMsg).toBeDefined()
  })

  it('converts assistant messages with toolCalls to proper content blocks', async () => {
    mockCreate.mockResolvedValue(makeResponse([{ type: 'text', text: 'ok' }]))
    const client = new AnthropicClient('test-key', 'claude-3-5-sonnet-20241022')
    await client.chat(
      [
        {
          role: 'assistant',
          content: 'Let me call a tool',
          toolCalls: [{ id: 'tu_3', name: 'myTool', args: { x: 1 } }],
        },
      ],
      []
    )
    const [callArgs] = mockCreate.mock.calls[0]
    const messages = callArgs.messages as Anthropic.MessageParam[]
    const assistantMsg = messages.find(m => m.role === 'assistant')
    expect(Array.isArray(assistantMsg?.content)).toBe(true)
    const blocks = assistantMsg?.content as Anthropic.ContentBlockParam[]
    expect(blocks.some(b => b.type === 'tool_use')).toBe(true)
  })

  it('converts assistant messages without toolCalls to plain string content', async () => {
    mockCreate.mockResolvedValue(makeResponse([{ type: 'text', text: 'ok' }]))
    const client = new AnthropicClient('test-key', 'claude-3-5-sonnet-20241022')
    await client.chat([{ role: 'assistant', content: 'Just a reply' }], [])
    const [callArgs] = mockCreate.mock.calls[0]
    const messages = callArgs.messages as Anthropic.MessageParam[]
    const assistantMsg = messages.find(m => m.role === 'assistant')
    expect(assistantMsg?.content).toBe('Just a reply')
  })

  it('calculates cost using default rates for unknown model', async () => {
    mockCreate.mockResolvedValue(
      makeResponse([{ type: 'text', text: 'hi' }], {
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
      })
    )
    const client = new AnthropicClient('test-key', 'unknown-model-xyz')
    const reply = await client.chat([{ role: 'user', content: 'hi' }], [])
    // Default rates: input=3.0, output=15.0 → cost = 3 + 15 = 18
    expect(reply.cost).toBeCloseTo(18.0)
  })

  it('passes systemPrompt and tools to Anthropic when provided', async () => {
    mockCreate.mockResolvedValue(makeResponse([{ type: 'text', text: 'ok' }]))
    const client = new AnthropicClient('test-key', 'claude-3-5-sonnet-20241022')
    await client.chat(
      [{ role: 'user', content: 'hello' }],
      [
        {
          name: 'my_tool',
          description: 'does stuff',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
      'You are a helpful assistant'
    )
    const [callArgs] = mockCreate.mock.calls[0]
    expect(callArgs.system).toBe('You are a helpful assistant')
    expect(callArgs.tools).toHaveLength(1)
  })
})

describe('createModelClient', () => {
  it('returns an AnthropicClient for provider=anthropic', () => {
    const client = createModelClient({
      provider: 'anthropic',
      apiKey: 'key',
      model: 'claude-3-5-haiku-20241022',
    })
    expect(client).toBeInstanceOf(AnthropicClient)
  })

  it('throws when apiKey is missing for anthropic provider', () => {
    const orig = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    expect(() =>
      createModelClient({ provider: 'anthropic', apiKey: '' })
    ).toThrow('ANTHROPIC_API_KEY')
    process.env.ANTHROPIC_API_KEY = orig
  })

  it('throws for unsupported provider', () => {
    expect(() =>
      createModelClient({ provider: 'openai', apiKey: 'key' })
    ).toThrow('Unsupported LLM provider')
  })

  it('reads LLM_PROVIDER / LLM_MODEL from env when options are omitted', () => {
    process.env.LLM_PROVIDER = 'anthropic'
    process.env.LLM_MODEL = 'claude-3-5-haiku-20241022'
    process.env.ANTHROPIC_API_KEY = 'env-key'
    const client = createModelClient()
    expect(client).toBeInstanceOf(AnthropicClient)
    delete process.env.LLM_PROVIDER
    delete process.env.LLM_MODEL
    delete process.env.ANTHROPIC_API_KEY
  })
})
