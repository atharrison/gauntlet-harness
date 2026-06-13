export default function HomePage() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <h1 className="mb-3 text-4xl font-bold tracking-tight text-white">
        AI PR Review Harness
      </h1>
      <p className="mb-10 max-w-xl text-lg text-gray-400">
        Multi-agent code review with guardrails, checkpoints, and an approval
        workflow. Paste a GitHub PR URL to get started.
      </p>

      <form
        action="/api/review/start"
        method="GET"
        className="flex w-full max-w-xl flex-col gap-3"
      >
        <input
          type="url"
          name="prUrl"
          placeholder="https://github.com/owner/repo/pull/123"
          required
          className="w-full rounded-lg border border-gray-700 bg-gray-900 px-4 py-3 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <button
          type="submit"
          className="rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-950"
        >
          Start Review
        </button>
      </form>

      <div className="mt-16 grid grid-cols-2 gap-6 text-left sm:grid-cols-4">
        {[
          { icon: "🛡️", label: "Guardrails", desc: "Input/output integrity checks" },
          { icon: "✅", label: "Checkpoints", desc: "5 named stages with pass/fail" },
          { icon: "🔧", label: "Material Handling", desc: "Typed tool dispatch + registry" },
          { icon: "🚨", label: "Alarms", desc: "Named alerts with severity" },
        ].map(({ icon, label, desc }) => (
          <div
            key={label}
            className="rounded-lg border border-gray-800 bg-gray-900 p-4"
          >
            <div className="mb-1 text-2xl">{icon}</div>
            <div className="text-sm font-semibold text-white">{label}</div>
            <div className="mt-1 text-xs text-gray-500">{desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
