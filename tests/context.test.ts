// @octokit/rest → __mocks__/@octokit/rest.js via moduleNameMapper (jest.config.js).
// GITHUB_TOKEN is not set in the test environment, so createOctokit() returns null
// and createGithubTools(null) returns {} — no GitHub tools in the registry.
import { createReviewContext, buildRegistry } from '../src/harness/context'
import { LocalMemoryStore } from '../src/memory/local'
import { InMemoryCheckpointStore } from '../src/harness/checkpoints'
import { createModelClient } from '../src/harness/models'
import os from 'os'
import path from 'path'
import fs from 'fs'

function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-test-'))
  return path.join(dir, 'test.db')
}

describe('buildRegistry', () => {
  it('registers memory and ticket tools', () => {
    const memory = new LocalMemoryStore(tempDb())
    const deps = {
      model: createModelClient({ provider: 'anthropic', apiKey: 'test-key' }),
      memory,
      checkpoints: new InMemoryCheckpointStore(),
    }
    const registry = buildRegistry(deps)
    const names = Object.keys(registry).sort()
    expect(names).toContain('search_past_reviews')
    expect(names).toContain('store_review')
    expect(names).toContain('create_memory')
    expect(names).toContain('fetch_ticket')
    expect(names).toContain('search_tickets')
  })

  it('excludes GitHub tools when GITHUB_TOKEN is not set', () => {
    const saved = process.env.GITHUB_TOKEN
    delete process.env.GITHUB_TOKEN
    const memory = new LocalMemoryStore(tempDb())
    const deps = {
      model: createModelClient({ provider: 'anthropic', apiKey: 'test-key' }),
      memory,
      checkpoints: new InMemoryCheckpointStore(),
    }
    const registry = buildRegistry(deps)
    expect(Object.keys(registry)).not.toContain('fetch_pr_diff')
    process.env.GITHUB_TOKEN = saved
  })
})

describe('createReviewContext', () => {
  let dbFile: string
  let memory: LocalMemoryStore

  beforeEach(() => {
    dbFile = tempDb()
    memory = new LocalMemoryStore(dbFile)
  })

  afterEach(() => {
    memory.close()
    fs.rmSync(path.dirname(dbFile), { recursive: true, force: true })
  })

  it('assembles all deps with overrides', () => {
    const ctx = createReviewContext({
      model: createModelClient({ provider: 'anthropic', apiKey: 'test-key' }),
      memory,
      checkpoints: new InMemoryCheckpointStore(),
    })

    expect(ctx.deps.memory).toBe(memory)
    expect(ctx.deps.checkpoints).toBeInstanceOf(InMemoryCheckpointStore)
    expect(ctx.registry).toBeDefined()
    expect(typeof ctx.dispatcher).toBe('function')
  })

  it('dispatcher returns a ToolDispatcher bound to the registry', async () => {
    const ctx = createReviewContext({
      model: createModelClient({ provider: 'anthropic', apiKey: 'test-key' }),
      memory,
      checkpoints: new InMemoryCheckpointStore(),
    })

    const dispatch = ctx.dispatcher('review-123')
    // With an empty registry, any tool call returns error-as-data (not a throw)
    const result = await dispatch({
      id: 'c1',
      name: 'nonexistent_tool',
      args: {},
    })
    expect(result.role).toBe('tool')
    expect(result.content).toContain('Unknown tool')
  })
})
