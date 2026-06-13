export interface Memory {
  id: string;
  content: string;
  tags: string[];
  context: string;
  createdAt: string;
}

export interface ReviewRecord {
  id: string;
  prUrl: string;
  repoName: string;
  prTitle: string;
  author: string;
  reviewedAt: string;
  findingCount: number;
  summary: string;
  rawJson: string;
}

export interface CodeChunk {
  id: string;
  repoName: string;
  filePath: string;
  content: string;
  startLine: number;
  endLine: number;
  similarity?: number;
}

export interface PRMetadata {
  prUrl: string;
  repoName: string;
  prTitle: string;
  author: string;
  prNumber: number;
}

export interface MemoryStore {
  // v1
  searchReviews(query: string, topK?: number): Promise<ReviewRecord[]>;
  getMemories(context: string): Promise<Memory[]>;
  storeReview(review: unknown, metadata: PRMetadata): Promise<void>;
  createMemory(content: string, tags: string[]): Promise<void>;
  // v2 — requires code indexer background job (returns [] until indexer runs)
  searchCode(query: string, topK?: number): Promise<CodeChunk[]>;
}
