/**
 * ReviewContext — the composition root for a single review run.
 *
 * Both the CLI entry point and the web API routes call createReviewContext()
 * to get a fully-wired set of dependencies. Neither ever instantiates adapters
 * directly — all wiring lives here.
 *
 * FIR-4 adds tool factory functions (createGithubTools, createMemoryTools,
 * createTicketTools) and wires them into buildRegistry(). Everything else in
 * this file is stable.
 */

import { createModelClient, type ModelClient } from "./models";
import { createMemoryStore, type MemoryStore } from "../memory/index";
import { InMemoryCheckpointStore, type CheckpointStore } from "./checkpoints";
import { dispatch, type ToolRegistry } from "./tools";
import type { ToolDispatcher } from "./loop";

// ── ReviewDeps — all injectable dependencies ──────────────────────────────────

export interface ReviewDeps {
  model: ModelClient;
  memory: MemoryStore;
  checkpoints: CheckpointStore;
}

// ── ReviewContext — fully assembled, ready to run ─────────────────────────────

export interface ReviewContext {
  deps: ReviewDeps;
  registry: ToolRegistry;
  /** Partially-applied dispatch bound to this context's registry. */
  dispatcher: (reviewId: string) => ToolDispatcher;
}

// ── buildRegistry — assemble all tools given a dep set ────────────────────────
//
// FIR-4 will fill this in with:
//   ...createGithubTools(octokit),
//   ...createMemoryTools(deps.memory),
//   ...createTicketTools(linearClient),
//
// For now it returns an empty registry so the rest of the composition plumbing
// can be exercised end-to-end before tools exist.

export function buildRegistry(_deps: ReviewDeps): ToolRegistry {
  return {
    // tool registrations added in FIR-4
  };
}

// ── createReviewContext — the single factory both CLI and web call ─────────────

export function createReviewContext(overrides?: Partial<ReviewDeps>): ReviewContext {
  const deps: ReviewDeps = {
    model: overrides?.model ?? createModelClient(),
    memory: overrides?.memory ?? createMemoryStore(),
    checkpoints: overrides?.checkpoints ?? new InMemoryCheckpointStore(),
  };

  const registry = buildRegistry(deps);

  const dispatcher = (reviewId: string): ToolDispatcher =>
    (call) => dispatch(call, registry, reviewId);

  return { deps, registry, dispatcher };
}
