// CJS stub so Jest's CommonJS runtime can resolve @octokit/rest (which ships ESM-only).
// Tests that need a specific Octokit shape still inject their own mock via the factory argument.
module.exports = {
  Octokit: jest.fn().mockImplementation(() => ({})),
}
