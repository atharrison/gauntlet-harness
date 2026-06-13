import {
  trace,
  type Tracer,
  type Span,
  SpanStatusCode,
} from "@opentelemetry/api";
import type { ModelReply, TokenUsage } from "./models";

// ── Tracer singleton ──────────────────────────────────────────────────────────

let _tracer: Tracer | null = null;

export function getTracer(): Tracer {
  if (!_tracer) {
    _tracer = trace.getTracer("pr-review-harness", "0.1.0");
  }
  return _tracer;
}

// ── Traced model call ─────────────────────────────────────────────────────────

export async function tracedModelCall<T extends ModelReply>(
  spanName: string,
  fn: () => Promise<T>,
  attrs: Record<string, string | number | boolean> = {},
): Promise<T> {
  return getTracer().startActiveSpan(spanName, async (span: Span) => {
    try {
      const reply = await fn();
      span.setAttributes({
        "llm.model": reply.model,
        "llm.tokens_in": reply.usage.inputTokens,
        "llm.tokens_out": reply.usage.outputTokens,
        "llm.cost_usd": reply.cost,
        ...attrs,
      });
      span.setStatus({ code: SpanStatusCode.OK });
      return reply;
    } catch (e) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(e) });
      span.recordException(e as Error);
      throw e;
    } finally {
      span.end();
    }
  });
}

// ── Traced tool call ──────────────────────────────────────────────────────────

export async function tracedToolCall<T>(
  toolName: string,
  fn: () => Promise<T>,
): Promise<T> {
  return getTracer().startActiveSpan(`tool.${toolName}`, async (span: Span) => {
    span.setAttribute("tool.name", toolName);
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (e) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(e) });
      span.recordException(e as Error);
      throw e;
    } finally {
      span.end();
    }
  });
}

// ── Approval decision recording ───────────────────────────────────────────────
// The approval loop is a natural instrumentation point — every decision is a
// quality signal collected free, with zero extra labeling overhead.

export function recordApprovalDecision(
  findingId: string,
  severity: string,
  category: string,
  action: "ACCEPT" | "REJECT" | "EDIT",
): void {
  const span = getTracer().startSpan("review.finding.decision");
  span.setAttributes({
    "finding.id": findingId,
    "finding.severity": severity,
    "finding.category": category,
    "finding.action": action,
  });
  span.setStatus({ code: SpanStatusCode.OK });
  span.end();
}

// ── Review-level span ─────────────────────────────────────────────────────────

export async function tracedReview<T>(
  reviewId: string,
  prUrl: string,
  fn: () => Promise<T>,
): Promise<T> {
  return getTracer().startActiveSpan("pr_review", async (span: Span) => {
    span.setAttributes({
      "review.id": reviewId,
      "review.pr_url": prUrl,
    });
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (e) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(e) });
      span.recordException(e as Error);
      throw e;
    } finally {
      span.end();
    }
  });
}

// ── Coverage helpers ──────────────────────────────────────────────────────────
// Emitted by tool executors and rolled up into the pr_review span.

export function recordFileCoverage(
  span: Span,
  filesRead: number,
  filesInPr: number,
  linesRead: number,
  linesInPr: number,
  externalContextCalls: number,
): void {
  span.setAttributes({
    "coverage.files_read": filesRead,
    "coverage.files_in_pr": filesInPr,
    "coverage.lines_read": linesRead,
    "coverage.lines_in_pr": linesInPr,
    "coverage.external_context_calls": externalContextCalls,
  });
}

export function recordReviewQuality(
  span: Span,
  findingsAccepted: number,
  findingsTotal: number,
  findingsEdited: number,
  ticketResolved: boolean,
): void {
  span.setAttributes({
    "quality.findings_accepted": findingsAccepted,
    "quality.findings_total": findingsTotal,
    "quality.findings_edited": findingsEdited,
    "quality.ticket_resolved": ticketResolved,
    "quality.acceptance_rate":
      findingsTotal > 0 ? findingsAccepted / findingsTotal : 0,
  });
}
