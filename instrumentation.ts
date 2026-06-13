/**
 * Next.js instrumentation hook — runs once per server process before any
 * routes are served. The dynamic import guard ensures OTel Node.js SDK is
 * only initialised on the server runtime (not the Edge runtime).
 *
 * See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initTracer } = await import('./src/harness/observability')
    initTracer()
  }
}
