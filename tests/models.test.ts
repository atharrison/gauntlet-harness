import { createModelClient, AnthropicClient } from "../src/harness/models";

describe("createModelClient", () => {
  it("returns an AnthropicClient for provider=anthropic", () => {
    const client = createModelClient({ provider: "anthropic", apiKey: "test" });
    expect(client).toBeInstanceOf(AnthropicClient);
  });

  it("throws for unsupported provider", () => {
    expect(() => createModelClient({ provider: "ollama" })).toThrow(
      "Unsupported LLM provider: ollama",
    );
  });

  it("defaults to anthropic when provider is omitted", () => {
    const client = createModelClient({ apiKey: "sk-test" });
    expect(client).toBeInstanceOf(AnthropicClient);
  });

  it("throws when apiKey is missing for anthropic provider", () => {
    expect(() => createModelClient({ provider: "anthropic" })).toThrow(
      "ANTHROPIC_API_KEY is required",
    );
  });
});
