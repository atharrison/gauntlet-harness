import { AlarmType, createAlarm, fireAlarm } from './alarms'
import type {
  ModelClient,
  Message,
  ToolDefinition,
  ToolCall,
  ModelReply,
} from './models'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LoopConfig {
  maxTurns?: number
  maxTokens?: number
  timeoutMs?: number
  reviewId?: string
  systemPrompt?: string
}

export interface LoopResult {
  text: string
  turnsUsed: number
  tokensUsed: number
  totalCost: number
}

export type ToolDispatcher = (call: ToolCall) => Promise<Message>

// ── Errors ────────────────────────────────────────────────────────────────────

export class TurnLimitError extends Error {
  constructor(turns: number) {
    super(`Turn limit reached after ${turns} turns`)
    this.name = 'TurnLimitError'
  }
}

export class TokenBudgetError extends Error {
  constructor(tokens: number, limit: number) {
    super(`Token budget exceeded: ${tokens} > ${limit}`)
    this.name = 'TokenBudgetError'
  }
}

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Run timed out after ${ms}ms`)
    this.name = 'TimeoutError'
  }
}

// ── Agent loop ────────────────────────────────────────────────────────────────

export async function run(
  userInput: string,
  model: ModelClient,
  tools: ToolDefinition[],
  dispatch: ToolDispatcher,
  config: LoopConfig = {}
): Promise<LoopResult> {
  const maxTurns = config.maxTurns ?? 20
  const maxTokens = config.maxTokens ?? 200_000
  const timeoutMs = config.timeoutMs ?? 300_000
  const { reviewId } = config

  const messages: Message[] = [{ role: 'user', content: userInput }]
  let tokensUsed = 0
  let totalCost = 0

  // Wall-clock timeout
  const deadline = Date.now() + timeoutMs

  // Repeated tool call detection
  let lastToolSig = ''
  let repeatCount = 0

  for (let turn = 0; turn < maxTurns; turn++) {
    if (Date.now() > deadline) {
      const alarm = createAlarm(
        AlarmType.TIMEOUT,
        { timeoutMs, turnsUsed: turn, reviewId },
        reviewId
      )
      fireAlarm(alarm)
      throw new TimeoutError(timeoutMs)
    }

    if (tokensUsed > maxTokens) {
      const alarm = createAlarm(
        AlarmType.TOKEN_BUDGET_EXCEEDED,
        { tokensUsed, maxTokens, turnsUsed: turn, reviewId },
        reviewId
      )
      fireAlarm(alarm)
      throw new TokenBudgetError(tokensUsed, maxTokens)
    }

    // Model errors propagate to the caller — the loop does not swallow them
    const reply: ModelReply = await model.chat(
      messages,
      tools,
      config.systemPrompt
    )

    tokensUsed += reply.usage.inputTokens + reply.usage.outputTokens
    totalCost += reply.cost

    // Final answer — no tool calls
    if (!reply.toolCalls.length) {
      messages.push({ role: 'assistant', content: reply.text })
      return { text: reply.text, turnsUsed: turn + 1, tokensUsed, totalCost }
    }

    // Build assistant message with tool call marker
    messages.push({ role: 'assistant', content: reply.text || '[tool calls]' })

    // Dispatch tool calls, check for repeat
    for (const call of reply.toolCalls) {
      const sig = `${call.name}:${JSON.stringify(call.args)}`
      if (sig === lastToolSig) {
        repeatCount++
        if (repeatCount >= 3) {
          const alarm = createAlarm(
            AlarmType.REPEATED_TOOL_CALL,
            { toolName: call.name, args: call.args, repeatCount, reviewId },
            reviewId
          )
          fireAlarm(alarm)
          throw new Error(
            `Repeated tool call detected: ${call.name} called 3× with identical args`
          )
        }
      } else {
        lastToolSig = sig
        repeatCount = 1
      }

      const result = await dispatch(call)
      messages.push(result)
    }
  }

  // Exhausted turn limit
  const alarm = createAlarm(
    AlarmType.TURN_LIMIT_EXCEEDED,
    { turnsUsed: maxTurns, maxTurns, reviewId },
    reviewId
  )
  fireAlarm(alarm)
  throw new TurnLimitError(maxTurns)
}
