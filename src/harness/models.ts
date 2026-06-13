import Anthropic from '@anthropic-ai/sdk'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Message {
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolCallId?: string
  toolName?: string
  toolCalls?: ToolCall[]  // stored on assistant messages that made tool calls
}

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
}

export interface ModelReply {
  text: string
  toolCalls: ToolCall[]
  usage: TokenUsage
  model: string
  cost: number
}

// ── ModelClient interface ─────────────────────────────────────────────────────
// The loop only ever calls this. No vendor SDK imported in loop.ts.

export interface ModelClient {
  chat(
    messages: Message[],
    tools: ToolDefinition[],
    systemPrompt?: string
  ): Promise<ModelReply>
}

// ── Cost helpers ──────────────────────────────────────────────────────────────

const COST_PER_MILLION: Record<string, { input: number; output: number }> = {
  'claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0 },
  'claude-3-5-haiku-20241022': { input: 0.8, output: 4.0 },
  'claude-3-opus-20240229': { input: 15.0, output: 75.0 },
}

function estimateCost(model: string, usage: TokenUsage): number {
  const rates = COST_PER_MILLION[model] ?? { input: 3.0, output: 15.0 }
  return (
    (usage.inputTokens / 1_000_000) * rates.input +
    (usage.outputTokens / 1_000_000) * rates.output
  )
}

// ── Anthropic adapter ─────────────────────────────────────────────────────────

export class AnthropicClient implements ModelClient {
  private client: Anthropic
  private model: string

  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey })
    this.model = model
  }

  async chat(
    messages: Message[],
    tools: ToolDefinition[],
    systemPrompt?: string
  ): Promise<ModelReply> {
    // Build Anthropic message array, injecting tool results as user messages
    const allMessages: Anthropic.MessageParam[] = []
    for (const m of messages) {
      if (m.role === 'tool' && m.toolCallId) {
        allMessages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result' as const,
              tool_use_id: m.toolCallId,
              content: m.content,
            },
          ],
        })
      } else if (m.role === 'assistant') {
        if (m.toolCalls && m.toolCalls.length > 0) {
          // Must include tool_use blocks so subsequent tool_result messages are valid
          const content: Anthropic.ContentBlockParam[] = []
          if (m.content) content.push({ type: 'text', text: m.content })
          for (const tc of m.toolCalls) {
            content.push({
              type: 'tool_use' as const,
              id: tc.id,
              name: tc.name,
              input: tc.args,
            })
          }
          allMessages.push({ role: 'assistant', content })
        } else {
          allMessages.push({ role: 'assistant', content: m.content })
        }
      } else if (m.role === 'user') {
        allMessages.push({ role: 'user', content: m.content })
      }
    }

    const anthropicTools: Anthropic.Tool[] = tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
    }))

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 8192,
      system: systemPrompt,
      messages: allMessages,
      tools: anthropicTools.length > 0 ? anthropicTools : undefined,
    })

    const toolCalls: ToolCall[] = response.content
      .filter(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
      )
      .map(block => ({
        id: block.id,
        name: block.name,
        args: block.input as Record<string, unknown>,
      }))

    const textBlocks = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map(block => block.text)

    const usage: TokenUsage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    }

    return {
      text: textBlocks.join('\n'),
      toolCalls,
      usage,
      model: this.model,
      cost: estimateCost(this.model, usage),
    }
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createModelClient(
  options: {
    provider?: string
    model?: string
    apiKey?: string
  } = {}
): ModelClient {
  const provider = options.provider ?? process.env.LLM_PROVIDER ?? 'anthropic'
  const model =
    options.model ?? process.env.LLM_MODEL ?? 'claude-sonnet-4-6'
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY ?? ''

  if (provider === 'anthropic') {
    if (!apiKey)
      throw new Error('ANTHROPIC_API_KEY is required for provider=anthropic')
    return new AnthropicClient(apiKey, model)
  }

  throw new Error(`Unsupported LLM provider: ${provider}. Supported: anthropic`)
}
