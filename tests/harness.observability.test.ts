/**
 * Tests for src/harness/observability.ts
 * Mocks OTel packages so no real tracer/exporter is initialised.
 */

jest.mock('@opentelemetry/api', () => {
  const spanMock = {
    setStatus: jest.fn(),
    recordException: jest.fn(),
    end: jest.fn(),
  }
  const tracerMock = {
    startSpan: jest.fn().mockReturnValue(spanMock),
  }
  return {
    _spanMock: spanMock,
    _tracerMock: tracerMock,
    trace: {
      getTracer: jest.fn().mockReturnValue(tracerMock),
      setSpan: jest.fn().mockReturnValue({}),
    },
    context: {
      active: jest.fn().mockReturnValue({}),
      with: jest
        .fn()
        .mockImplementation((_ctx: unknown, fn: () => unknown) => fn()),
    },
    SpanStatusCode: { OK: 1, ERROR: 2 },
  }
})

jest.mock('@opentelemetry/sdk-trace-node', () => {
  const providerMock = {
    addSpanProcessor: jest.fn(),
    register: jest.fn(),
  }
  return {
    NodeTracerProvider: jest.fn().mockReturnValue(providerMock),
    BatchSpanProcessor: jest.fn(),
    SimpleSpanProcessor: jest.fn(),
    ConsoleSpanExporter: jest.fn(),
  }
})

// Access the span mock via requireMock since jest.mock is hoisted
const otelMock = jest.requireMock('@opentelemetry/api') as {
  _spanMock: {
    setStatus: jest.Mock
    recordException: jest.Mock
    end: jest.Mock
  }
  SpanStatusCode: { OK: number; ERROR: number }
}

describe('withSpan', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Re-mock context.with after clearAllMocks so it still calls fn
    const otel = jest.requireMock('@opentelemetry/api')
    otel.context.with.mockImplementation((_ctx: unknown, fn: () => unknown) =>
      fn()
    )
  })

  it('returns the result of fn and marks span OK', async () => {
    const { withSpan } = await import('../src/harness/observability')
    const result = await withSpan(
      'my-span',
      { attr: 'val' },
      async () => 'success'
    )
    expect(result).toBe('success')
    expect(otelMock._spanMock.setStatus).toHaveBeenCalledWith({
      code: otelMock.SpanStatusCode.OK,
    })
    expect(otelMock._spanMock.end).toHaveBeenCalled()
  })

  it('re-throws errors, records exception, and marks span ERROR', async () => {
    const { withSpan } = await import('../src/harness/observability')
    const err = new Error('boom')
    await expect(
      withSpan('fail-span', {}, async () => {
        throw err
      })
    ).rejects.toThrow('boom')
    expect(otelMock._spanMock.setStatus).toHaveBeenCalledWith({
      code: otelMock.SpanStatusCode.ERROR,
      message: String(err),
    })
    expect(otelMock._spanMock.recordException).toHaveBeenCalledWith(err)
    expect(otelMock._spanMock.end).toHaveBeenCalled()
  })

  it('passes span instance into fn', async () => {
    const { withSpan } = await import('../src/harness/observability')
    let capturedSpan: unknown
    await withSpan('span-arg', {}, async span => {
      capturedSpan = span
    })
    expect(capturedSpan).toBeDefined()
  })
})

describe('initTracer', () => {
  it('initialises the console exporter when OTEL_EXPORTER_OTLP_ENDPOINT is not set', async () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    jest.resetModules()
    // Re-mock after resetModules so the fresh import still uses our mocks
    jest.mock('@opentelemetry/api', () => ({
      trace: {
        getTracer: jest.fn().mockReturnValue({ startSpan: jest.fn() }),
        setSpan: jest.fn(),
      },
      context: { active: jest.fn(), with: jest.fn() },
      SpanStatusCode: { OK: 1, ERROR: 2 },
    }))
    jest.mock('@opentelemetry/sdk-trace-node', () => {
      const providerMock = { addSpanProcessor: jest.fn(), register: jest.fn() }
      return {
        NodeTracerProvider: jest.fn().mockReturnValue(providerMock),
        BatchSpanProcessor: jest.fn(),
        SimpleSpanProcessor: jest.fn(),
        ConsoleSpanExporter: jest.fn(),
      }
    })
    const { initTracer } = await import('../src/harness/observability')
    const { NodeTracerProvider, SimpleSpanProcessor, ConsoleSpanExporter } =
      jest.requireMock('@opentelemetry/sdk-trace-node')
    initTracer()
    expect(NodeTracerProvider).toHaveBeenCalled()
    expect(SimpleSpanProcessor).toHaveBeenCalled()
    expect(ConsoleSpanExporter).toHaveBeenCalled()
  })

  it('is idempotent — calling twice does not register a second provider', async () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    jest.resetModules()
    jest.mock('@opentelemetry/api', () => ({
      trace: {
        getTracer: jest.fn().mockReturnValue({ startSpan: jest.fn() }),
        setSpan: jest.fn(),
      },
      context: { active: jest.fn(), with: jest.fn() },
      SpanStatusCode: { OK: 1, ERROR: 2 },
    }))
    jest.mock('@opentelemetry/sdk-trace-node', () => {
      const providerMock = { addSpanProcessor: jest.fn(), register: jest.fn() }
      return {
        NodeTracerProvider: jest.fn().mockReturnValue(providerMock),
        BatchSpanProcessor: jest.fn(),
        SimpleSpanProcessor: jest.fn(),
        ConsoleSpanExporter: jest.fn(),
      }
    })
    const { initTracer } = await import('../src/harness/observability')
    const { NodeTracerProvider } = jest.requireMock(
      '@opentelemetry/sdk-trace-node'
    )
    initTracer()
    initTracer() // second call should be a no-op
    expect(NodeTracerProvider).toHaveBeenCalledTimes(1)
  })
})
