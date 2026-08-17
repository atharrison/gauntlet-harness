import { z } from 'zod'
import {
  dispatch,
  toToolDefinitions,
  type ToolRegistry,
} from '../src/harness/tools'

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

const registry: ToolRegistry = {
  echo: {
    description: 'Echoes the input',
    schema: z.object({ message: z.string() }),
    fn: async ({ message }: { message: string }) => ({ echoed: message }),
  },
  fail: {
    description: 'Always fails',
    schema: z.object({}),
    fn: async () => {
      throw new Error('tool error')
    },
  },
}

describe('dispatch', () => {
  it('returns error-as-data for unknown tool', async () => {
    const result = await dispatch(
      { id: 'c1', name: 'nonexistent', args: {} },
      registry
    )
    const parsed = JSON.parse(result.content)
    expect(parsed.error).toMatch(/Unknown tool/)
  })

  it('returns error-as-data when Zod validation fails', async () => {
    const result = await dispatch(
      { id: 'c2', name: 'echo', args: { message: 123 } }, // wrong type
      registry
    )
    const parsed = JSON.parse(result.content)
    expect(parsed.error).toMatch(/Invalid arguments/)
  })

  it('executes known tool and returns result', async () => {
    const result = await dispatch(
      { id: 'c3', name: 'echo', args: { message: 'hello' } },
      registry
    )
    const parsed = JSON.parse(result.content)
    expect(parsed.echoed).toBe('hello')
    expect(result.toolName).toBe('echo')
    expect(result.toolCallId).toBe('c3')
  })

  it('returns error-as-data when tool throws (does not propagate)', async () => {
    const result = await dispatch(
      { id: 'c4', name: 'fail', args: {} },
      registry
    )
    const parsed = JSON.parse(result.content)
    expect(parsed.error).toMatch(/tool error/)
  })
})

describe('toToolDefinitions', () => {
  it('produces a ToolDefinition for each registered tool', () => {
    const defs = toToolDefinitions(registry)
    expect(defs).toHaveLength(2)
    expect(defs.find(d => d.name === 'echo')).toBeDefined()
  })

  it('maps all ZodType variants to JSON schema correctly', () => {
    const complexRegistry: ToolRegistry = {
      tool: {
        description: 'Complex schema tool',
        schema: z.object({
          numField: z.number(),
          boolField: z.boolean(),
          arrField: z.array(z.string()),
          optField: z.string().optional(),
          enumField: z.enum(['a', 'b']),
          nested: z.object({ x: z.string() }),
          fallback: z.date() as unknown as z.ZodString,
        }),
        fn: async () => ({}),
      },
    }
    const [def] = toToolDefinitions(complexRegistry)
    const props = (def.inputSchema as { properties: Record<string, unknown> })
      .properties
    expect(props.numField).toEqual({ type: 'number' })
    expect(props.boolField).toEqual({ type: 'boolean' })
    expect(props.arrField).toEqual({ type: 'array', items: { type: 'string' } })
    expect(props.optField).toEqual({ type: 'string' })
    expect(props.enumField).toMatchObject({ type: 'string', enum: ['a', 'b'] })
    expect(props.nested).toMatchObject({ type: 'object' })
    expect(props.fallback).toEqual({ type: 'string' })
  })
})

describe('dispatch — timeout path', () => {
  it('fires a timeout alarm and returns error-as-data when tool throws timed-out error', async () => {
    const timeoutRegistry: ToolRegistry = {
      slow: {
        description: 'Simulates a timed-out tool',
        schema: z.object({}),
        fn: async () => {
          throw new Error('Tool timed out after 30000ms')
        },
      },
    }
    const result = await dispatch(
      { id: 'c5', name: 'slow', args: {} },
      timeoutRegistry,
      'rev-1'
    )
    const parsed = JSON.parse(result.content)
    expect(parsed.error).toMatch(/timed out/)
  })
})
