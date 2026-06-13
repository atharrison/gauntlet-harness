export type { MemoryStore, Memory, ReviewRecord, CodeChunk, PRMetadata } from "./store";
export { LocalMemoryStore } from "./local";
export { SupabaseMemoryStore } from "./supabase";

import { LocalMemoryStore } from "./local";
import { SupabaseMemoryStore } from "./supabase";
import type { MemoryStore } from "./store";

export function createMemoryStore(): MemoryStore {
  const provider = process.env.MEMORY_PROVIDER ?? "sqlite";
  if (provider === "supabase") {
    return new SupabaseMemoryStore();
  }
  return new LocalMemoryStore();
}
