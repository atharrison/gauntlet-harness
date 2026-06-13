import { z } from "zod";
import { AlarmType, createAlarm, fireAlarm } from "./alarms";
import { PRReviewSchema, type PRReview, type EnrichedContext } from "../agents/pr-review/schema";

// ── Secret patterns ───────────────────────────────────────────────────────────
// Basic patterns for credential-shaped strings. Not exhaustive — meant to catch
// accidental bleed from auth code into review output.

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9]{32,}/,         // OpenAI / Anthropic keys
  /ghp_[A-Za-z0-9]{36}/,         // GitHub personal access tokens
  /ghs_[A-Za-z0-9]{36}/,         // GitHub app tokens
  /AKIA[A-Z0-9]{16}/,            // AWS access key IDs
  /eyJhbGci[A-Za-z0-9._-]{20,}/, // JWT tokens
  /-----BEGIN (RSA |EC )?PRIVATE KEY-----/, // PEM private keys
  /xoxb-[0-9]+-[A-Za-z0-9-]+/,  // Slack bot tokens
];

// ── Input guardrails ──────────────────────────────────────────────────────────

export interface PRSizeGateOptions {
  maxFiles?: number;
  maxLines?: number;
  reviewId?: string;
}

export function checkPRSize(
  filesChanged: string[],
  linesChanged: number,
  options: PRSizeGateOptions = {},
): { oversized: boolean; alarm?: ReturnType<typeof createAlarm> } {
  const maxFiles = options.maxFiles ?? parseInt(process.env.PR_MAX_FILES ?? "50", 10);
  const maxLines = options.maxLines ?? parseInt(process.env.PR_MAX_LINES ?? "3000", 10);

  if (filesChanged.length > maxFiles || linesChanged > maxLines) {
    const alarm = createAlarm(
      AlarmType.PR_TOO_LARGE,
      {
        filesChanged: filesChanged.length,
        linesChanged,
        maxFiles,
        maxLines,
      },
      options.reviewId,
    );
    return { oversized: true, alarm };
  }

  return { oversized: false };
}

// ── Output guardrails ─────────────────────────────────────────────────────────

export interface GuardrailResult {
  pass: boolean;
  review?: PRReview;
  errors: string[];
}

export function validateReviewOutput(
  raw: unknown,
  context: EnrichedContext,
  reviewId?: string,
): GuardrailResult {
  const errors: string[] = [];

  // 1. Schema validation
  const parsed = PRReviewSchema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.message;
    const alarm = createAlarm(
      AlarmType.SCHEMA_VALIDATION_FAILED,
      { reviewId, zodError: msg },
      reviewId,
    );
    fireAlarm(alarm);
    errors.push(`Schema validation failed: ${msg}`);
    return { pass: false, errors };
  }

  const review = parsed.data;

  // 2. File citation check — every finding must reference a file in the PR diff
  const prFiles = new Set(context.filesChanged);
  const allFindings = [
    ...review.blockingIssues,
    ...review.suggestions,
    ...review.nits,
  ];

  for (const finding of allFindings) {
    if (!prFiles.has(finding.file)) {
      const alarm = createAlarm(
        AlarmType.HALLUCINATED_FILE_CITATION,
        { file: finding.file, findingId: finding.id, reviewId },
        reviewId,
      );
      fireAlarm(alarm);
      errors.push(`Hallucinated file citation: ${finding.file} is not in the PR diff`);
    }
  }

  // 3. Secret scan — review output must not contain credential-shaped strings
  const reviewText = JSON.stringify(review);
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(reviewText)) {
      const alarm = createAlarm(
        AlarmType.SECRET_DETECTED,
        { pattern: pattern.source, reviewId },
        reviewId,
      );
      fireAlarm(alarm);
      errors.push(`Secret pattern detected in review output: ${pattern.source}`);
    }
  }

  if (errors.length > 0) {
    return { pass: false, review, errors };
  }

  return { pass: true, review, errors: [] };
}

// ── Strip hallucinated findings ───────────────────────────────────────────────
// When HALLUCINATED_FILE_CITATION fires but we want to salvage the review,
// strip bad findings rather than discarding the whole run.

export function stripHallucinatedFindings(
  review: PRReview,
  context: EnrichedContext,
): PRReview {
  const prFiles = new Set(context.filesChanged);
  const filter = (findings: PRReview["blockingIssues"]) =>
    findings.filter((f) => prFiles.has(f.file));

  return {
    ...review,
    blockingIssues: filter(review.blockingIssues),
    suggestions: filter(review.suggestions),
    nits: filter(review.nits),
  };
}
