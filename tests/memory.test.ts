import os from 'os'
import path from 'path'
import fs from 'fs'
import { LocalMemoryStore } from '../src/memory/local'

function tempDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-test-'))
  return path.join(dir, 'test.db')
}

describe('LocalMemoryStore', () => {
  let store: LocalMemoryStore
  let dbFile: string

  beforeEach(() => {
    dbFile = tempDb()
    store = new LocalMemoryStore(dbFile)
  })

  afterEach(() => {
    store.close()
    fs.rmSync(path.dirname(dbFile), { recursive: true, force: true })
  })

  it('creates and retrieves a memory', async () => {
    await store.createMemory('Always require type hints in Python', [
      'python',
      'style',
    ])
    const memories = await store.getMemories('any-repo')
    expect(memories).toHaveLength(1)
    expect(memories[0].content).toBe('Always require type hints in Python')
    expect(memories[0].tags).toEqual(['python', 'style'])
  })

  it('stores and searches a review by title keyword', async () => {
    await store.storeReview(
      { summary: 'Found 3 issues', findings: [{}, {}, {}] },
      {
        prUrl: 'https://github.com/org/repo/pull/1',
        repoName: 'org/repo',
        prTitle: 'Add authentication middleware',
        author: 'alice',
        prNumber: 1,
      }
    )

    const results = await store.searchReviews('authentication')
    expect(results).toHaveLength(1)
    expect(results[0].prTitle).toBe('Add authentication middleware')
    expect(results[0].findingCount).toBe(3)
  })

  it('returns empty array for searchReviews with no match', async () => {
    const results = await store.searchReviews('nonexistent-xyz')
    expect(results).toHaveLength(0)
  })

  it('searchCode returns [] (v2 stub)', async () => {
    const chunks = await store.searchCode('some query')
    expect(chunks).toEqual([])
  })

  it('getMemories returns global memories regardless of context filter', async () => {
    await store.createMemory('Global rule', [])
    const memories = await store.getMemories('specific-repo')
    expect(memories.length).toBeGreaterThan(0)
    expect(memories.some(m => m.content === 'Global rule')).toBe(true)
  })
})

describe('createMemoryStore factory', () => {
  it('returns LocalMemoryStore when MEMORY_PROVIDER=sqlite', () => {
    process.env.MEMORY_PROVIDER = 'sqlite'
    process.env.SQLITE_DB_PATH = path.join(
      os.tmpdir(),
      `harness-factory-${Date.now()}.db`
    )
    // Lazy import to pick up env
    const { createMemoryStore } = require('../src/memory/index')
    const store = createMemoryStore()
    expect(store).toBeInstanceOf(LocalMemoryStore)
    if (typeof store.close === 'function') store.close()
    fs.rmSync(process.env.SQLITE_DB_PATH, { force: true })
    delete process.env.SQLITE_DB_PATH
  })
})
