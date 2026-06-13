/**
 * OTel tracer setup for gauntlet-harness.
 *
 * Exports a singleton tracer and a `withSpan` helper for wrapping async
 * operations in properly-nested spans.
 *
 * Exporter selection (checked at init time):
 *   OTEL_EXPORTER_OTLP_ENDPOINT — if set, ship traces via OTLP HTTP
 *   (otherwise) — ConsoleSpanExporter writes structured JSON to stdout,
 *                 which is queryable in Railway log search.
 *
 * Call `initTracer()` once at process start (via instrumentation.ts).
 * All other modules just import `withSpan` / `getTracer`.
 */

import {
  trace,
  context,
  SpanStatusCode,
  type Span,
  type Tracer,
} from '@opentelemetry/api'
import {
  NodeTracerProvider,
  BatchSpanProcessor,
  SimpleSpanProcessor,
  ConsoleSpanExporter,
} from '@opentelemetry/sdk-trace-node'

const SERVICE_NAME = 'gauntlet-harness'
const TRACER_VERSION = '1.0.0'

let _initialized = false

export function initTracer(): void {
  if (_initialized) return
  _initialized = true

  const provider = new NodeTracerProvider()

  const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT

  if (otlpEndpoint) {
    // Dynamic import so the OTLP exporter doesn't add startup cost when unused
    void import('@opentelemetry/exporter-trace-otlp-http').then(
      ({ OTLPTraceExporter }) => {
        provider.addSpanProcessor(
          new BatchSpanProcessor(new OTLPTraceExporter({ url: otlpEndpoint }))
        )
        provider.register()
        console.log(
          JSON.stringify({
            harness_otel_init: { exporter: 'otlp', endpoint: otlpEndpoint },
          })
        )
      }
    )
  } else {
    provider.addSpanProcessor(
      new SimpleSpanProcessor(new ConsoleSpanExporter())
    )
    provider.register()
    console.log(JSON.stringify({ harness_otel_init: { exporter: 'console' } }))
  }
}

export function getTracer(): Tracer {
  return trace.getTracer(SERVICE_NAME, TRACER_VERSION)
}

/**
 * Run `fn` inside a named OTel span. Span is automatically ended and marked
 * OK on success or ERROR on throw. Child spans created inside `fn` will
 * automatically be parented to this span via context propagation.
 */
export async function withSpan<T>(
  name: string,
  attrs: Record<string, string | number | boolean>,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  const span = getTracer().startSpan(name, { attributes: attrs })
  const ctx = trace.setSpan(context.active(), span)

  try {
    const result = await context.with(ctx, () => fn(span))
    span.setStatus({ code: SpanStatusCode.OK })
    return result
  } catch (err) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) })
    span.recordException(err as Error)
    throw err
  } finally {
    span.end()
  }
}
