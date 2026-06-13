24-hour Build Challenge
Build a harness — a framework that an AI agent lives inside. The harness defines what the
agent gets for free: guardrails that constrain its behavior, checkpoints that evaluate its
outputs, clean interfaces for passing material in and out, and alarms that fire when
something goes wrong. What domain your agent operates in is your choice. What your
harness provides, and how an agent works with it, is what you are being evaluated on.
Requirements
● Must All four pillars are implemented and demonstrably separate from the worker —
guardrails, checkpoints, material handling, and alarms each exist as distinct, identifiable
components in the code
● Must The harness governs an AI agent and the agent's behavior changes meaningfully
based on guardrail or checkpoint feedback
● Must Guardrails are declared, not implicit. Checkpoints with explicit pass/fail criteria.
● Must Alarms produce structured output — named alarm types with context, severity, and a
recommended action
● Must The harness runs on a real input from the engineer's own work at demo time
● Must An HARNESS.md file that covers the architecture and design of the harness
● Should Swappable agent interface — dropping in a different agent requires no changes to
the harness
● Should Checkpoint results are persisted — you can replay a run from any checkpoint
forward without re-running prior stages
● Should Contains human-in-the-loop escalation paths — the harness knows when to stop
and ask rather than guess
● Bonus A second worker is swapped in during the demo to prove portability

Deliverables
Due Friday at 11:30 PM
● 1-page Harness Planning Document (Due Friday at 11:30 PM)
Due Saturday at 4:30 PM
● Project repo URL
● Deployed Harness URL
● Documentation on the harness’s capabilities (saved as HARNESS.md in your code repo)
● 5-minute demo video on what you built and how it works
Agents focus on tasks. Harnesses focus on constraints. A well-designed harness makes
constraint-handling invisible to the agent.