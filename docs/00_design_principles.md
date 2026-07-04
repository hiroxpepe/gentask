# Gentask Design Principles (The Trunk)

> The principles that define *what gentask is built to protect*.
> Individual features and implementations are branches derived from this trunk.
> When in doubt, return here.

---

## The Central Axis

> **Expect no intelligence from the LLM. Certainty lives in code; only judgment is delegated to the LLM.**

Every design decision in gentask is derived from this single line.

The world is drifting toward "the LLM is smart, so just let it do everything"
(vibe coding). Gentask takes the opposite stance. **Every process that must run
reliably is handled by deterministic code; the LLM is delegated only the
judgment of *when* and *what* to execute.** The program is the protagonist;
the LLM is a layer that merely drives execution.

The reason is simple: LLMs are non-deterministic. Processes that must not fail —
state transitions, API operations — must never be entrusted to something whose
output varies for the same input. Expect no intelligence, delegate only the
parts that may safely vary (interpreting natural language, deciding timing),
and the LLM's non-determinism causes no harm.

---

## Five Branches from the Trunk

### 1. The core is a deterministic CLI (the master/servant order)

The core of all processing is a testable, idempotent CLI program.
Even without an LLM, the CLI alone (invoked by a human) must always run.
The LLM only drives *when and in what order* this CLI runs.
→ *This is the central axis itself. Every other branch is subordinate to it.*

### 2. A spreadsheet is enough for the data

The state lives in a Google Spreadsheet. No dedicated DB, no state-management
layer. Task state, progress, and classification fit in rows and columns.
Do not add machinery to something a table already handles.
It is readable and writable within the Google API already in use — no new
dependency.
→ *A consequence of "expect no intelligence." Heavy machinery hides judgment
and erodes certainty.*

### 3. Depend on no specific LLM (the executor is swappable)

Because the core is a deterministic CLI, the LLM that drives it becomes a
swappable part. Switch executors freely between development and production,
and according to how heavy the judgment is.
Never bake a specific service (especially a corporate-account environment)
into the production dependency.
→ *This holds only once Branch 1 is satisfied. Without a deterministic core,
the LLM cannot be detached.*

### 4. Separate the venue by phase

- **Think** (explore design and ideas) → conversational chat UI
- **Write** (finalize code) → an agent inside the editor
- **Run** (production) → autonomous execution (background, scheduled).
  Zero dialogue is ideal.

The optimal interface differs by phase. In the run phase, even dialogue with
a human is unnecessary; silent autonomous execution is best.
→ *The separation of judgment and certainty, carried all the way into the
assignment of work phases to tools.*

### 5. Interface with the world through Git

The LLM agent reads and writes the repository, and leaves its results, through
Git. Therefore, using Git properly is the very precondition for making an LLM
effective. A small repository with separated concerns, an operation that keeps
context tight, commits at meaningful units.
→ *The foundation on which Branches 1–4 rest. The quality of Git operation
is, directly, the quality of the design.*

---

## On Operating This Constitution

This trunk is not something to perfect on paper and then leave alone.

**Hold one working example before abstracting.** Operate gentask for real,
pick up the hints that rise out of the repository operation, and let the trunk
grow. Erect only the minimal trunk first, and let operation forge the
principles.

Observe both the "working examples" (repositories that run correctly) and the
"failing examples" (broken operations), and keep extracting, from operation,
the boundary between what works and what does not.
