import { z } from 'zod'
import { AlarmType, createAlarm, fireAlarm } from './alarms'
import type { Message, ToolCall, ToolDefinition } from './models'

// ── Types ─────────────────────────────────────────────────────────────────────

export type ToolFn<TInput> = (input: TInput) => Promise<unknown>

export interface ToolEntry<TInput = unknown> {
  // dispatch() always validates input via schema before calling fn, so any is safe here
  fn: (input: any) => Promise<unknown> // eslint-disable-line @typescript-eslint/no-explicit-any
  schema: z.ZodType<TInput>
  description: string
}

export type ToolRegistry = Record<string, ToolEntry>

const TOOL_TIMEOUT_MS = parseInt(process.env.TOOL_TIMEOUT_MS ?? '30000', 10)

// ── Helpers ───────────────────────────────────────────────────────────────────

function errMessage(toolCallId: string, error: string): Message {
  return {
    role: 'tool',
    content: JSON.stringify({ error }),
    toolCallId,
    toolName: 'unknown',
  }
}

function toolMessage(call: ToolCall, result: unknown): Message {
  return {
    role: 'tool',
    content: typeof result === 'string' ? result : JSON.stringify(result),
    toolCallId: call.id,
    toolName: call.name,
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Tool timed out after ${ms}ms`)),
      ms
    )
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer!)
  }
}

// ── dispatch() — the single guardrail choke point ─────────────────────────────
// Every tool call flows through here. No tool bypasses allow-list + validation + timeout.

export async function dispatch(
  call: ToolCall,
  registry: ToolRegistry,
  reviewId?: string
): Promise<Message> {
  // Allow-list check
  if (!(call.name in registry)) {
    return errMessage(call.id, `Unknown tool: ${call.name}`)
  }

  const entry = registry[call.name]

  // Zod argument validation
  const parsed = entry.schema.safeParse(call.args)
  if (!parsed.success) {
    return errMessage(
      call.id,
      `Invalid arguments for ${call.name}: ${parsed.error.message}`
    )
  }

  // Execute with timeout — failures are data, not exceptions
  try {
    const result = await withTimeout(entry.fn(parsed.data), TOOL_TIMEOUT_MS)
    return toolMessage(call, result)
  } catch (e) {
    const isTimeout = e instanceof Error && e.message.includes('timed out')
    if (isTimeout) {
      const alarm = createAlarm(
        AlarmType.TOOL_TIMEOUT,
        { toolName: call.name, timeoutMs: TOOL_TIMEOUT_MS },
        reviewId
      )
      fireAlarm(alarm)
    }
    return toolMessage(call, { error: String(e) })
  }
}

// ── toToolDefinitions() ───────────────────────────────────────────────────────
// Converts a ToolRegistry into the ToolDefinition[] the ModelClient expects.
// Uses Zod's built-in JSON schema output (Zod v3.23+).

export function toToolDefinitions(registry: ToolRegistry): ToolDefinition[] {
  return Object.entries(registry).map(([name, entry]) => ({
    name,
    description: entry.description,
    inputSchema: (entry.schema as z.ZodObject<z.ZodRawShape>).shape
      ? zodToJsonSchema(entry.schema as z.ZodObject<z.ZodRawShape>)
      : { type: 'object', properties: {} },
  }))
}

function zodToJsonSchema(
  schema: z.ZodObject<z.ZodRawShape>
): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  const required: string[] = []

  for (const [key, value] of Object.entries(schema.shape)) {
    const field = value as z.ZodTypeAny
    properties[key] = zodFieldToJsonSchema(field)
    if (!(field instanceof z.ZodOptional)) {
      required.push(key)
    }
  }

  return { type: 'object', properties, required }
}

function zodFieldToJsonSchema(field: z.ZodTypeAny): Record<string, unknown> {
  if (field instanceof z.ZodString) return { type: 'string' }
  if (field instanceof z.ZodNumber) return { type: 'number' }
  if (field instanceof z.ZodBoolean) return { type: 'boolean' }
  if (field instanceof z.ZodArray)
    return { type: 'array', items: zodFieldToJsonSchema(field.element) }
  if (field instanceof z.ZodOptional)
    return zodFieldToJsonSchema(field.unwrap())
  if (field instanceof z.ZodEnum) return { type: 'string', enum: field.options }
  if (field instanceof z.ZodObject) return zodToJsonSchema(field)
  return { type: 'string' }
}
