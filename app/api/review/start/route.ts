import { type NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";

const StartReviewBody = z.object({
  prUrl: z.string().url("prUrl must be a valid GitHub PR URL"),
  mode: z.enum(["full", "quick"]).default("full"),
});

/**
 * POST /api/review/start
 * Validates the PR URL, mints a reviewId, and returns it.
 * Agents are wired in FIR-8 — this is the stub.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = StartReviewBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const reviewId = uuidv4();

  return NextResponse.json(
    { reviewId, prUrl: parsed.data.prUrl, mode: parsed.data.mode },
    { status: 202 },
  );
}

/**
 * GET /api/review/start?prUrl=...
 * Browser form fallback — redirects to the review page.
 */
export function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const prUrl = searchParams.get("prUrl");

  if (!prUrl) {
    return NextResponse.redirect(new URL("/?error=missing_pr_url", request.url));
  }

  const reviewId = uuidv4();
  return NextResponse.redirect(
    new URL(`/review/${reviewId}?prUrl=${encodeURIComponent(prUrl)}`, request.url),
  );
}
