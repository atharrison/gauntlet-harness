import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const FindingDecision = z.object({
  findingId: z.string(),
  accepted: z.boolean(),
  editedText: z.string().optional(),
});

const FinalizeBody = z.object({
  decisions: z.array(FindingDecision).min(1),
  postComment: z.boolean().default(false),
});

/**
 * POST /api/review/[id]/finalize
 * Accepts the approval decisions from the UI, stores them, and
 * optionally posts a review comment to GitHub.
 * Wired in FIR-8 — this is the stub.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: reviewId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = FinalizeBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const { decisions, postComment } = parsed.data;
  const accepted = decisions.filter((d) => d.accepted).length;
  const rejected = decisions.filter((d) => !d.accepted).length;

  return NextResponse.json({
    reviewId,
    status: "finalized",
    summary: { total: decisions.length, accepted, rejected },
    postComment,
    message: "Stub — agents not yet wired (FIR-8)",
  });
}
