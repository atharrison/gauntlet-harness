"use client";

import { useEffect, useRef, useState } from "react";

interface Finding {
  id: string;
  severity: "BLOCKING" | "SUGGESTION" | "NIT";
  category: string;
  file: string;
  line?: number;
  message: string;
  suggestedFix?: string;
}

interface FindingDecision {
  findingId: string;
  accepted: boolean;
  editedText?: string;
}

type StreamStatus = "connecting" | "running" | "done" | "error";

const SEVERITY_STYLES: Record<Finding["severity"], string> = {
  BLOCKING: "border-red-600 bg-red-950/30",
  SUGGESTION: "border-yellow-600 bg-yellow-950/30",
  NIT: "border-gray-700 bg-gray-900/50",
};

const SEVERITY_BADGE: Record<Finding["severity"], string> = {
  BLOCKING: "bg-red-700 text-red-100",
  SUGGESTION: "bg-yellow-700 text-yellow-100",
  NIT: "bg-gray-700 text-gray-300",
};

interface Props {
  reviewId: string;
  prUrl: string;
}

export function ReviewShell({ reviewId, prUrl }: Props) {
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const [findings, setFindings] = useState<Finding[]>([]);
  const [decisions, setDecisions] = useState<Record<string, FindingDecision>>(
    {},
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<string | null>(null);
  const [events, setEvents] = useState<string[]>([]);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource(`/api/review/${reviewId}`);
    esRef.current = es;

    es.addEventListener("connected", () => {
      setStatus("running");
      setEvents((prev) => [...prev, "Connected to review stream"]);
    });

    es.addEventListener("finding", (e) => {
      const finding: Finding = JSON.parse(e.data).finding;
      setFindings((prev) => [...prev, finding]);
      setDecisions((prev) => ({
        ...prev,
        [finding.id]: {
          findingId: finding.id,
          accepted: finding.severity !== "NIT",
        },
      }));
    });

    es.addEventListener("checkpoint", (e) => {
      const data = JSON.parse(e.data);
      setEvents((prev) => [
        ...prev,
        `Checkpoint: ${data.stage} → ${data.status}`,
      ]);
    });

    es.addEventListener("alarm", (e) => {
      const data = JSON.parse(e.data);
      setEvents((prev) => [
        ...prev,
        `⚠ Alarm: ${data.alarm?.type ?? "unknown"}`,
      ]);
    });

    es.addEventListener("done", () => {
      setStatus("done");
      setEvents((prev) => [...prev, "Review complete"]);
      es.close();
    });

    es.onerror = () => {
      setStatus("error");
      es.close();
    };

    return () => es.close();
  }, [reviewId]);

  function toggle(id: string) {
    setDecisions((prev) => ({
      ...prev,
      [id]: { ...prev[id], accepted: !prev[id].accepted },
    }));
  }

  function startEdit(finding: Finding) {
    setEditingId(finding.id);
    setEditText(
      decisions[finding.id]?.editedText ?? finding.suggestedFix ?? "",
    );
  }

  function saveEdit(id: string) {
    setDecisions((prev) => ({
      ...prev,
      [id]: { ...prev[id], editedText: editText || undefined },
    }));
    setEditingId(null);
  }

  async function handleSubmit(postComment: boolean) {
    setSubmitting(true);
    const body = {
      decisions: Object.values(decisions),
      postComment,
    };
    const res = await fetch(`/api/review/${reviewId}/finalize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setSubmitResult(
      res.ok
        ? `Submitted: ${data.summary.accepted} accepted, ${data.summary.rejected} rejected`
        : `Error: ${data.error}`,
    );
    setSubmitting(false);
  }

  const accepted = Object.values(decisions).filter((d) => d.accepted).length;
  const total = findings.length;

  return (
    <div className="flex gap-6">
      {/* Main panel */}
      <div className="flex-1 min-w-0">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white">PR Review</h1>
          {prUrl && (
            <a
              href={prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 text-sm text-indigo-400 hover:underline"
            >
              {prUrl}
            </a>
          )}
          <p className="mt-1 text-xs text-gray-500 font-mono">
            review/{reviewId}
          </p>
        </div>

        {/* Status bar */}
        <div className="mb-4 flex items-center gap-3">
          <StatusIndicator status={status} />
          {status === "done" && total > 0 && (
            <span className="text-sm text-gray-400">
              {total} finding{total !== 1 ? "s" : ""} — {accepted} accepted
            </span>
          )}
        </div>

        {/* Findings list */}
        {findings.length === 0 && status !== "done" && (
          <div className="rounded-lg border border-gray-800 bg-gray-900 p-8 text-center text-sm text-gray-500">
            {status === "connecting"
              ? "Connecting to review stream…"
              : "Agents are running — findings will appear here"}
          </div>
        )}

        {findings.length === 0 && status === "done" && (
          <div className="rounded-lg border border-green-800 bg-green-950/30 p-8 text-center text-sm text-green-400">
            No findings — clean review!
          </div>
        )}

        <div className="flex flex-col gap-3">
          {findings.map((f) => {
            const decision = decisions[f.id];
            const isEditing = editingId === f.id;

            return (
              <div
                key={f.id}
                className={`rounded-lg border p-4 transition-opacity ${SEVERITY_STYLES[f.severity]} ${decision?.accepted === false ? "opacity-50" : ""}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-semibold ${SEVERITY_BADGE[f.severity]}`}
                    >
                      {f.severity}
                    </span>
                    <span className="text-xs text-gray-400 font-mono">
                      {f.file}
                      {f.line ? `:${f.line}` : ""}
                    </span>
                    <span className="text-xs text-gray-500">{f.category}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <label className="flex items-center gap-1.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        className="accent-indigo-500"
                        checked={decision?.accepted ?? true}
                        onChange={() => toggle(f.id)}
                      />
                      <span className="text-xs text-gray-400">Include</span>
                    </label>
                  </div>
                </div>

                <p className="mt-2 text-sm text-gray-200">{f.message}</p>

                {isEditing ? (
                  <div className="mt-3">
                    <textarea
                      className="w-full rounded border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
                      rows={3}
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                    />
                    <div className="mt-2 flex gap-2">
                      <button
                        onClick={() => saveEdit(f.id)}
                        className="rounded bg-indigo-600 px-3 py-1 text-xs text-white hover:bg-indigo-500"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="rounded bg-gray-700 px-3 py-1 text-xs text-gray-300 hover:bg-gray-600"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {(decision?.editedText ?? f.suggestedFix) && (
                      <p className="mt-2 rounded bg-gray-800 px-3 py-2 font-mono text-xs text-green-400">
                        {decision?.editedText ?? f.suggestedFix}
                      </p>
                    )}
                    <button
                      onClick={() => startEdit(f)}
                      className="mt-2 text-xs text-indigo-400 hover:underline"
                    >
                      {decision?.editedText ? "Edit fix" : "Add fix"}
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>

        {/* Submit controls */}
        {status === "done" && total > 0 && (
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              disabled={submitting}
              onClick={() => handleSubmit(false)}
              className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {submitting ? "Submitting…" : `Submit (${accepted}/${total})`}
            </button>
            <button
              disabled={submitting}
              onClick={() => handleSubmit(true)}
              className="rounded-lg border border-indigo-600 px-5 py-2.5 text-sm font-semibold text-indigo-400 hover:bg-indigo-950 disabled:opacity-50"
            >
              Submit + Post to GitHub
            </button>
          </div>
        )}

        {submitResult && (
          <p className="mt-4 rounded bg-gray-900 px-4 py-2 text-sm text-green-400">
            {submitResult}
          </p>
        )}
      </div>

      {/* Event log sidebar */}
      <div className="w-64 shrink-0 hidden lg:block">
        <div className="sticky top-4 rounded-lg border border-gray-800 bg-gray-900 p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Event Log
          </h2>
          {events.length === 0 ? (
            <p className="text-xs text-gray-600">No events yet</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {events.map((e, i) => (
                <li key={i} className="text-xs text-gray-400 font-mono">
                  {e}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusIndicator({ status }: { status: StreamStatus }) {
  const configs: Record<StreamStatus, { dot: string; label: string }> = {
    connecting: { dot: "bg-yellow-400 animate-pulse", label: "Connecting" },
    running: { dot: "bg-green-400 animate-pulse", label: "Agents running" },
    done: { dot: "bg-indigo-400", label: "Complete" },
    error: { dot: "bg-red-500", label: "Stream error" },
  };
  const { dot, label } = configs[status];
  return (
    <div className="flex items-center gap-2">
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      <span className="text-sm text-gray-400">{label}</span>
    </div>
  );
}
