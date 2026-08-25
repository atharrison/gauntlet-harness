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

type SdkMock = {
  NodeTracerProvider: jest.Mock
  BatchSpanProcessor: jest.Mock
  SimpleSpanProcessor: jest.Mock
  ConsoleSpanExporter: jest.Mock
}

type ApiMock = {
  trace: { getTracer: jest.Mock }
}

type OtlpMock = {
  OTLPTraceExporter: jest.Mock
}

/** Fresh module + mocks so `_initialized` resets between initTracer cases. */
async function loadObservability() {
  jest.resetModules()
  jest.mock('@opentelemetry/api', () => {
    const startSpan = jest.fn().mockReturnValue({
      setStatus: jest.fn(),
      recordException: jest.fn(),
      end: jest.fn(),
      setAttributes: jest.fn(),
    })
    return {
      trace: {
        getTracer: jest.fn().mockReturnValue({ startSpan }),
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
    const providerMock = { addSpanProcessor: jest.fn(), register: jest.fn() }
    return {
      NodeTracerProvider: jest.fn().mockReturnValue(providerMock),
      BatchSpanProcessor: jest.fn(),
      SimpleSpanProcessor: jest.fn(),
      ConsoleSpanExporter: jest.fn(),
    }
  })
  jest.mock('@opentelemetry/exporter-trace-otlp-http', () => ({
    OTLPTraceExporter: jest.fn(),
  }))
  const observability = await import('../src/harness/observability')
  return {
    ...observability,
    sdk: jest.requireMock('@opentelemetry/sdk-trace-node') as SdkMock,
    api: jest.requireMock('@opentelemetry/api') as ApiMock,
    otlp: jest.requireMock(
      '@opentelemetry/exporter-trace-otlp-http'
    ) as OtlpMock,
  }
}

describe('initTracer', () => {
  let log: jest.SpyInstance

  beforeEach(() => {
    log = jest.spyOn(console, 'log').mockImplementation(() => {})
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    delete process.env.OTEL_TRACES_EXPORTER
  })

  afterEach(() => {
    log.mockRestore()
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    delete process.env.OTEL_TRACES_EXPORTER
  })

  it('initialises the console exporter when OTEL_EXPORTER_OTLP_ENDPOINT is not set', async () => {
    const { initTracer, sdk, OtelExporter } = await loadObservability()
    initTracer()
    expect(sdk.NodeTracerProvider).toHaveBeenCalled()
    expect(sdk.SimpleSpanProcessor).toHaveBeenCalled()
    expect(sdk.ConsoleSpanExporter).toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(
      JSON.stringify({ harness_otel_init: { exporter: OtelExporter.CONSOLE } })
    )
  })

  it.each(['NONE', 'none'])(
    'skips provider registration when OTEL_TRACES_EXPORTER=%s',
    async value => {
      process.env.OTEL_TRACES_EXPORTER = value
      const { initTracer, sdk, OtelExporter } = await loadObservability()
      initTracer()
      expect(sdk.NodeTracerProvider).not.toHaveBeenCalled()
      expect(sdk.SimpleSpanProcessor).not.toHaveBeenCalled()
      expect(sdk.ConsoleSpanExporter).not.toHaveBeenCalled()
      expect(sdk.BatchSpanProcessor).not.toHaveBeenCalled()
      expect(log).toHaveBeenCalledWith(
        JSON.stringify({ harness_otel_init: { exporter: OtelExporter.NONE } })
      )
    }
  )

  it('prefers NONE over OTLP when both env vars are set', async () => {
    process.env.OTEL_TRACES_EXPORTER = 'NONE'
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318/v1/traces'
    const { initTracer, sdk, otlp, OtelExporter } = await loadObservability()
    initTracer()
    await Promise.resolve()
    expect(sdk.NodeTracerProvider).not.toHaveBeenCalled()
    expect(otlp.OTLPTraceExporter).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(
      JSON.stringify({ harness_otel_init: { exporter: OtelExporter.NONE } })
    )
  })

  it('initialises the OTLP exporter when OTEL_EXPORTER_OTLP_ENDPOINT is set', async () => {
    const endpoint = 'http://localhost:4318/v1/traces'
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = endpoint
    const { initTracer, sdk, otlp, OtelExporter } = await loadObservability()
    initTracer()
    await new Promise<void>(resolve => {
      setImmediate(resolve)
    })
    expect(sdk.NodeTracerProvider).toHaveBeenCalled()
    expect(otlp.OTLPTraceExporter).toHaveBeenCalledWith({ url: endpoint })
    expect(sdk.BatchSpanProcessor).toHaveBeenCalled()
    expect(sdk.ConsoleSpanExporter).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(
      JSON.stringify({
        harness_otel_init: { exporter: OtelExporter.OTLP, endpoint },
      })
    )
  })

  it('is idempotent — calling twice does not register a second provider', async () => {
    const { initTracer, sdk } = await loadObservability()
    initTracer()
    initTracer()
    expect(sdk.NodeTracerProvider).toHaveBeenCalledTimes(1)
  })

  it('withSpan is a pass-through with a no-op span when exporter is none', async () => {
    process.env.OTEL_TRACES_EXPORTER = 'NONE'
    const { initTracer, withSpan, api } = await loadObservability()
    initTracer()
    const startSpan = api.trace.getTracer().startSpan as jest.Mock
    startSpan.mockClear()

    const result = await withSpan('disabled-span', { a: 1 }, async span => {
      span.setAttributes({ 'tokens.total': 0 })
      span.setStatus({ code: 1 })
      span.recordException(new Error('ignored'))
      span.end()
      return 'ok'
    })

    expect(result).toBe('ok')
    expect(startSpan).not.toHaveBeenCalled()
  })

  it('withSpan still rethrows when tracing is disabled', async () => {
    process.env.OTEL_TRACES_EXPORTER = 'NONE'
    const { initTracer, withSpan, api } = await loadObservability()
    initTracer()
    const startSpan = api.trace.getTracer().startSpan as jest.Mock
    startSpan.mockClear()

    await expect(
      withSpan('disabled-fail', {}, async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')
    expect(startSpan).not.toHaveBeenCalled()
  })

  it('does not re-enable tracing if env changes after the first init', async () => {
    process.env.OTEL_TRACES_EXPORTER = 'NONE'
    const { initTracer, withSpan, api, sdk } = await loadObservability()
    initTracer()
    delete process.env.OTEL_TRACES_EXPORTER
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318/v1/traces'
    initTracer()
    expect(sdk.NodeTracerProvider).not.toHaveBeenCalled()
    const startSpan = api.trace.getTracer().startSpan as jest.Mock
    startSpan.mockClear()
    await withSpan('still-disabled', {}, async () => 'ok')
    expect(startSpan).not.toHaveBeenCalled()
  })

  it('redacts credentials from the OTLP endpoint in the init log', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT =
      'https://user:secret@collector.example/v1/traces?api_key=abc'
    const { initTracer, OtelExporter } = await loadObservability()
    initTracer()
    await new Promise<void>(resolve => {
      setImmediate(resolve)
    })
    expect(log).toHaveBeenCalledWith(
      JSON.stringify({
        harness_otel_init: {
          exporter: OtelExporter.OTLP,
          endpoint: 'https://collector.example/v1/traces',
        },
      })
    )
  })

  it('logs a placeholder when the OTLP endpoint is not a valid URL', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'not-a-url'
    const { initTracer, OtelExporter } = await loadObservability()
    initTracer()
    await new Promise<void>(resolve => {
      setImmediate(resolve)
    })
    expect(log).toHaveBeenCalledWith(
      JSON.stringify({
        harness_otel_init: {
          exporter: OtelExporter.OTLP,
          endpoint: '[unparseable-endpoint]',
        },
      })
    )
  })
})
