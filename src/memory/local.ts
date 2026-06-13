import Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { mkdirSync } from 'fs'
import path from 'path'
import os from 'os'
import type {
  MemoryStore,
  Memory,
  ReviewRecord,
  CodeChunk,
  PRMetadata,
} from './store'

function dbPath(): string {
  return (
    process.env.SQLITE_DB_PATH ??
    path.join(os.homedir(), '.gauntlet-harness', 'memory.db')
  )
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      context TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS review_history (
      id TEXT PRIMARY KEY,
      pr_url TEXT NOT NULL,
      repo_name TEXT NOT NULL,
      pr_title TEXT NOT NULL,
      author TEXT NOT NULL,
      reviewed_at TEXT NOT NULL,
      finding_count INTEGER NOT NULL DEFAULT 0,
      summary TEXT NOT NULL DEFAULT '',
      raw_json TEXT NOT NULL DEFAULT '{}'
    );
  `)
}

export class LocalMemoryStore implements MemoryStore {
  private db: Database.Database

  constructor(dbFilePath?: string) {
    const filePath = dbFilePath ?? dbPath()
    mkdirSync(path.dirname(filePath), { recursive: true })
    this.db = new Database(filePath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    migrate(this.db)
  }

  getMemories(context: string): Promise<Memory[]> {
    const rows = this.db
      .prepare(
        `SELECT id, content, tags, context, created_at
         FROM memories
         WHERE context = '' OR context = ?
         ORDER BY created_at DESC`
      )
      .all(context) as Array<{
      id: string
      content: string
      tags: string
      context: string
      created_at: string
    }>

    return Promise.resolve(
      rows.map(r => ({
        id: r.id,
        content: r.content,
        tags: JSON.parse(r.tags),
        context: r.context,
        createdAt: r.created_at,
      }))
    )
  }

  createMemory(content: string, tags: string[]): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO memories (id, content, tags, context, created_at)
         VALUES (?, ?, ?, '', ?)`
      )
      .run(
        randomUUID(),
        content,
        JSON.stringify(tags),
        new Date().toISOString()
      )
    return Promise.resolve()
  }

  searchReviews(query: string, topK = 5): Promise<ReviewRecord[]> {
    // SQLite full-text search via LIKE; vector search is Supabase-only
    const rows = this.db
      .prepare(
        `SELECT id, pr_url, repo_name, pr_title, author, reviewed_at,
                finding_count, summary, raw_json
         FROM review_history
         WHERE summary LIKE ? OR pr_title LIKE ?
         ORDER BY reviewed_at DESC
         LIMIT ?`
      )
      .all(`%${query}%`, `%${query}%`, topK) as Array<{
      id: string
      pr_url: string
      repo_name: string
      pr_title: string
      author: string
      reviewed_at: string
      finding_count: number
      summary: string
      raw_json: string
    }>

    return Promise.resolve(
      rows.map(r => ({
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
    )
  }

  storeReview(review: unknown, metadata: PRMetadata): Promise<void> {
    const reviewObj = review as { summary?: string; findings?: unknown[] }
    this.db
      .prepare(
        `INSERT INTO review_history
         (id, pr_url, repo_name, pr_title, author, reviewed_at, finding_count, summary, raw_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        metadata.prUrl,
        metadata.repoName,
        metadata.prTitle,
        metadata.author,
        new Date().toISOString(),
        Array.isArray(reviewObj?.findings) ? reviewObj.findings.length : 0,
        reviewObj?.summary ?? '',
        JSON.stringify(review)
      )
    return Promise.resolve()
  }

  // v2 stub — requires indexer background job
  searchCode(_query: string, _topK?: number): Promise<CodeChunk[]> {
    return Promise.resolve([])
  }

  close(): void {
    this.db.close()
  }
}
