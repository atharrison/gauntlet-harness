import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'
import type {
  MemoryStore,
  Memory,
  ReviewRecord,
  CodeChunk,
  PRMetadata,
} from './store'

function createSupabaseClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY) must be set'
    )
  }

  return createClient(url, key)
}

export class SupabaseMemoryStore implements MemoryStore {
  private client: SupabaseClient

  constructor(client?: SupabaseClient) {
    this.client = client ?? createSupabaseClient()
  }

  async getMemories(context: string): Promise<Memory[]> {
    const { data, error } = await this.client
      .from('memories')
      .select('id, content, tags, context, created_at')
      .or(`context.eq.,context.eq.${context}`)
      .order('created_at', { ascending: false })

    if (error) throw new Error(`getMemories failed: ${error.message}`)

    return (data ?? []).map(r => ({
      id: r.id,
      content: r.content,
      tags: Array.isArray(r.tags) ? r.tags : [],
      context: r.context ?? '',
      createdAt: r.created_at,
    }))
  }

  async createMemory(content: string, tags: string[]): Promise<void> {
    const { error } = await this.client.from('memories').insert({
      id: randomUUID(),
      content,
      tags,
      context: '',
      created_at: new Date().toISOString(),
    })
    if (error) throw new Error(`createMemory failed: ${error.message}`)
  }

  async searchReviews(query: string, topK = 5): Promise<ReviewRecord[]> {
    // Full-text search via Postgres ILIKE — pgvector similarity is v2
    const { data, error } = await this.client
      .from('review_history')
      .select(
        'id, pr_url, repo_name, pr_title, author, reviewed_at, finding_count, summary, raw_json'
      )
      .or(`summary.ilike.%${query}%,pr_title.ilike.%${query}%`)
      .order('reviewed_at', { ascending: false })
      .limit(topK)

    if (error) throw new Error(`searchReviews failed: ${error.message}`)

    return (data ?? []).map(r => ({
      id: r.id,
      prUrl: r.pr_url,
      repoName: r.repo_name,
      prTitle: r.pr_title,
      author: r.author,
      reviewedAt: r.reviewed_at,
      findingCount: r.finding_count,
      summary: r.summary,
      rawJson: r.raw_json,
    }))
  }

  async storeReview(review: unknown, metadata: PRMetadata): Promise<void> {
    const reviewObj = review as { summary?: string; findings?: unknown[] }
    const { error } = await this.client.from('review_history').insert({
      id: randomUUID(),
      pr_url: metadata.prUrl,
      repo_name: metadata.repoName,
      pr_title: metadata.prTitle,
      author: metadata.author,
      reviewed_at: new Date().toISOString(),
      finding_count: Array.isArray(reviewObj?.findings)
        ? reviewObj.findings.length
        : 0,
      summary: reviewObj?.summary ?? '',
      raw_json: JSON.stringify(review),
    })
    if (error) throw new Error(`storeReview failed: ${error.message}`)
  }

  // v2 stub — pgvector similarity search (requires embeddings pipeline)
  searchCode(_query: string, _topK?: number): Promise<CodeChunk[]> {
    return Promise.resolve([])
  }
}
