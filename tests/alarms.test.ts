import {
  AlarmType,
  createAlarm,
  fireAlarm,
  setSseEmitter,
} from '../src/harness/alarms'

describe('createAlarm', () => {
  it('returns an alarm with the correct shape', () => {
    const alarm = createAlarm(
      AlarmType.TURN_LIMIT_EXCEEDED,
      { turnsUsed: 20, maxTurns: 20 },
      'rev-123'
    )

    expect(alarm.alarmType).toBe('TURN_LIMIT_EXCEEDED')
    expect(alarm.severity).toBe('HIGH')
    expect(alarm.context.turnsUsed).toBe(20)
    expect(alarm.reviewId).toBe('rev-123')
    expect(alarm.recommendedAction).toBeTruthy()
    expect(alarm.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('works without a reviewId', () => {
    const alarm = createAlarm(AlarmType.PR_NOT_FOUND, { url: 'bad-url' })
    expect(alarm.reviewId).toBeUndefined()
  })

  it('assigns correct severity for each AlarmType', () => {
    const cases: [AlarmType, string][] = [
      [AlarmType.SCHEMA_VALIDATION_FAILED, 'CRITICAL'],
      [AlarmType.SECRET_DETECTED, 'CRITICAL'],
      [AlarmType.TURN_LIMIT_EXCEEDED, 'HIGH'],
      [AlarmType.TOKEN_BUDGET_EXCEEDED, 'HIGH'],
      [AlarmType.TIMEOUT, 'HIGH'],
      [AlarmType.HALLUCINATED_FILE_CITATION, 'HIGH'],
      [AlarmType.CHECKPOINT_FAILED, 'HIGH'],
      [AlarmType.PR_NOT_FOUND, 'HIGH'],
      [AlarmType.REPEATED_TOOL_CALL, 'MEDIUM'],
      [AlarmType.SCOPE_BUDGET_EXCEEDED, 'MEDIUM'],
      [AlarmType.TOOL_TIMEOUT, 'MEDIUM'],
      [AlarmType.PR_TOO_LARGE, 'LOW'],
    ]

    for (const [type, expectedSeverity] of cases) {
      const alarm = createAlarm(type, {})
      expect(alarm.severity).toBe(expectedSeverity)
    }
  })

  it('provides a non-empty recommendedAction for every AlarmType', () => {
    for (const type of Object.values(AlarmType)) {
      const alarm = createAlarm(type, {})
      expect(alarm.recommendedAction.length).toBeGreaterThan(0)
    }
  })
})

describe('fireAlarm', () => {
  let stderrOutput: string[] = []
  let originalStderr: typeof console.error

  beforeEach(() => {
    stderrOutput = []
    originalStderr = console.error
    console.error = (...args: unknown[]) => stderrOutput.push(args.join(' '))
  })

  afterEach(() => {
    console.error = originalStderr
    setSseEmitter(() => {})
  })

  it('writes structured JSON to stderr', () => {
    const alarm = createAlarm(AlarmType.SCOPE_BUDGET_EXCEEDED, { calls: 11 })
    fireAlarm(alarm)

    expect(stderrOutput.length).toBe(1)
    const parsed = JSON.parse(stderrOutput[0])
    expect(parsed.harness_alarm.alarmType).toBe('SCOPE_BUDGET_EXCEEDED')
  })

  it('calls the SSE emitter when reviewId is present', () => {
    const emitter = jest.fn()
    setSseEmitter(emitter)

    const alarm = createAlarm(AlarmType.SECRET_DETECTED, {}, 'rev-42')
    fireAlarm(alarm)

    expect(emitter).toHaveBeenCalledWith('rev-42', { type: 'alarm', alarm })
  })

  it('does not call SSE emitter when reviewId is absent', () => {
    const emitter = jest.fn()
    setSseEmitter(emitter)

    const alarm = createAlarm(AlarmType.PR_NOT_FOUND, { url: 'x' })
    fireAlarm(alarm)

    expect(emitter).not.toHaveBeenCalled()
  })
})
