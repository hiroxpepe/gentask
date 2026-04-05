# Gentask — Improvement Tasks

> Proposed enhancements to make Gentask more intelligent, resilient, and frictionless.  
> Each task is scoped to be independently implementable. Grouped by theme.

---

## Theme 1: Real-Time Intelligence

---

---

### IMP-03 — AI Plot Quality Gate
**Current state:** The AI generates a plot task but does not evaluate plot content quality.  
**Improvement:** Before promoting a plot task from 来週分 to 今週分 (in the slide process), call Gemini to score the plot description against a rubric (conflict clarity, emotional arc, page count feasibility). Block promotion if the score is below threshold; surface the reasoning to the user.  
**Key work:**
- Add `evaluate_plot(description: string): Promise<{ score: number; feedback: string }>` to `slide.ts`
- Define scoring rubric as a prompt template
- Gate `promote_next_week` on the score
- Add `--force` flag to bypass the gate

---

---

## Theme 2: Multi-Series & Collaboration

---

---

## Theme 3: Observability & Analytics

---

### IMP-08 — Historical Velocity Tracking
**Current state:** Each week is isolated; no learning from past performance.  
**Improvement:** After each weekly slide, record actual vs. estimated sp per task type to `~/.gentask/velocity.jsonl`. Use this history to auto-calibrate task estimates: if プロット consistently takes 2.5sp instead of 2.0sp, update the default estimate.  
**Key work:**
- Append velocity records in `slide.ts` → `archive_current_week()`
- Build `VelocityModel` class: compute rolling average per task type over last N episodes
- Expose `get_estimate(task_title: string): number` used by `index.ts` task generation prompt
- Add `npm run velocity:report` to print a summary table

---

### IMP-09 — Weekly Email / LINE Digest
**Current state:** No proactive notifications.  
**Improvement:** Every Monday morning, send a digest summarizing last week's completion rate, this week's loaded schedule, and any buffer warnings. Supports email (via SendGrid) and LINE Notify.  
**Key work:**
- Build `digest.ts` with `send_weekly_digest(channel: 'email' | 'line', context: WeekContext)`
- Template: completion %, sp loaded, risk score, top 3 tasks
- Add `digest:dev` / `digest:prod` scripts
- Add `SENDGRID_API_KEY` / `LINE_NOTIFY_TOKEN` to env schema

---

## Theme 4: Developer Experience

### IMP-10 — Interactive TUI Kanban Board
**Current state:** All output is plain console logs; no visual board.  
**Improvement:** Add a `board` command that renders a live terminal Kanban board (today's tasks, status, sp remaining) using `ink` (React for CLIs) or `blessed`. Updates in real-time as sync runs.  
**Key work:**
- Add `ink` + `react` dependencies
- Build `board.tsx` with columns: 今週分 | 来週分 | 完了
- Color-code by task mode (PTASK=blue, TTASK=green, CTASK=yellow, ATASK=gray)
- Add `npm run board:dev` script

---

---

---

---

## Theme 5: AI Quality

### IMP-14 — Structured Prompt Templates (Prompt Engineering)
**Current state:** Prompts are inline template strings; hard to tune.  
**Improvement:** Extract all AI prompts to a `prompts/` directory as Markdown files with YAML front-matter (model, temperature, output schema). Load them at runtime. This makes prompt tuning possible without code changes.  
**Key work:**
- Create `prompts/task_generation.md`, `prompts/sync_interpretation.md`, `prompts/plot_quality.md`
- Build `load_prompt(name: string, vars: Record<string, string>): string` utility
- Replace all inline prompt strings with `load_prompt()` calls
- Add prompt versioning (filename includes version: `sync_interpretation_v2.md`)

---

### IMP-15 — Multi-Model Fallback
**Current state:** Gemini 2.0 Flash is hardcoded; no fallback if the API is unavailable.  
**Improvement:** Add a model fallback chain: Gemini 2.0 Flash → Gemini 1.5 Pro → GPT-4o (via OpenAI API). If a model call fails with a retryable error, automatically retry with the next model in the chain.  
**Key work:**
- Abstract `ai_generate(prompt, schema)` into a `ModelService` class
- Configure the fallback chain in `.env` as `AI_MODEL_CHAIN=gemini-2.0-flash,gemini-1.5-pro,gpt-4o`
- Add OpenAI SDK alongside GenKit
- Implement retry logic with exponential backoff + model rotation

---

---

## Theme 6: Infrastructure

### IMP-17 — GitHub Actions CI/CD Pipeline
**Current state:** Tests run locally only.  
**Improvement:** Add a GitHub Actions workflow that runs `npm test` + `npx tsc --noEmit` on every push and pull request. Block merges if tests fail.  
**Key work:**
- Create `.github/workflows/ci.yml` with Node.js matrix (18.x, 20.x)
- Cache `node_modules` with `actions/cache`
- Add test result reporter (GitHub annotations)
- Add a badge to README.md

---

---

### IMP-19 — Structured Logging with Log Levels
**Current state:** All output uses `console.log` / `console.error` with no filtering.  
**Improvement:** Replace all console calls with a structured logger (`pino` or `winston`) that supports log levels (`DEBUG`, `INFO`, `WARN`, `ERROR`). Controlled via `LOG_LEVEL` env var. Output JSON in production, pretty-print in dev.  
**Key work:**
- Add `pino` dependency
- Create `logger.ts` singleton
- Replace all `console.log/warn/error` calls across all modules
- Add `LOG_LEVEL=debug` to `.env.dev` template

---

### IMP-20 — Rate Limiting & Retry Logic for MS Graph API
**Current state:** `graph.ts` makes raw API calls with no retry on throttling (HTTP 429).  
**Improvement:** Wrap `graph.post/get/patch` with an exponential backoff retry handler. Respect the `Retry-After` header returned by MS Graph on 429 responses. Add configurable concurrency limiting to avoid burst throttling.  
**Key work:**
- Add `p-retry` or implement custom retry logic in `graph.ts`
- Parse `Retry-After` header and sleep accordingly
- Add `GRAPH_MAX_RETRIES` and `GRAPH_CONCURRENCY` env vars
- Add retry behavior to `graph.test.ts`

---

## Priority Summary

| ID | Theme | Effort | Impact |
|---|---|---|---|
| IMP-02 | Deadline Risk Detection | S | ⭐⭐⭐⭐⭐ |
| IMP-01 | Real-Time Webhook Sync | L | ⭐⭐⭐⭐⭐ |
| IMP-11 | Dry-Run Mode | S | ⭐⭐⭐⭐ |
| IMP-17 | GitHub Actions CI | S | ⭐⭐⭐⭐ |
| IMP-07 | Burndown Chart | M | ⭐⭐⭐⭐ |
| IMP-04 | Smart Buffer Reallocation | M | ⭐⭐⭐⭐ |
| IMP-05 | Multi-Series Support | M | ⭐⭐⭐ |
| IMP-08 | Velocity Tracking | M | ⭐⭐⭐ |
| IMP-10 | TUI Kanban Board | L | ⭐⭐⭐ |
| IMP-14 | Prompt Templates | S | ⭐⭐⭐ |
| IMP-20 | Graph API Retry | S | ⭐⭐⭐ |
| IMP-03 | AI Plot Quality Gate | M | ⭐⭐⭐ |
| IMP-19 | Structured Logging | S | ⭐⭐ |
| IMP-12 | Full State Export/Import | M | ⭐⭐ |
| IMP-06 | Multi-User Collaboration | L | ⭐⭐ |
| IMP-13 | Plugin System | L | ⭐⭐ |
| IMP-15 | Multi-Model Fallback | M | ⭐⭐ |
| IMP-16 | Clip Studio Auto-Completion | M | ⭐⭐ |
| IMP-09 | Weekly Email/LINE Digest | M | ⭐⭐ |
| IMP-18 | Docker Container | M | ⭐ |

*Effort: S = Small (1-2 days), M = Medium (3-5 days), L = Large (1-2 weeks)*
