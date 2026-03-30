# Gentask — Improvement Tasks

> Proposed enhancements to make Gentask more intelligent, resilient, and frictionless.  
> Each task is scoped to be independently implementable. Grouped by theme.

---

## Theme 1: Real-Time Intelligence

### IMP-01 — MS Graph Webhook Subscriptions (Real-Time Sync)
**Current state:** `sync` is a manual command; user must run it explicitly.  
**Improvement:** Subscribe to MS Graph change notifications for the user's Outlook calendar. When an event is created or modified, automatically trigger the AI sync pipeline without any user action.  
**Impact:** The core "management that doesn't feel like management" promise becomes fully passive.  
**Key work:**
- Implement `POST /subscriptions` to register webhook on `/me/events`
- Add a lightweight HTTP listener (`express` or Hono) to receive change notifications
- Debounce rapid-fire events (e.g., user dragging blocks) before triggering AI
- Handle subscription renewal (subscriptions expire after 4230 minutes)

---

### IMP-02 — Proactive Deadline Risk Detection
**Current state:** Gentask records progress but never warns the user.  
**Improvement:** After every sync, calculate remaining sp vs. available time to Sunday 21:00. If the burn rate predicts a miss, automatically push an Outlook event titled `⚠️ DEADLINE RISK` with a breakdown, and raise the priority of at-risk Planner tasks.  
**Key work:**
- Build a `risk_calculator` module: `remaining_sp / available_hours → risk_score`
- Define thresholds: `≥ 0.9` = critical, `≥ 0.7` = warning
- Create Outlook event via Graph API when threshold is breached
- Add unit tests

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

### IMP-04 — Smart Buffer Auto-Reallocation
**Current state:** Buffer tasks are consumed manually via the `buffer_consumed` sync action.  
**Improvement:** When the AI detects that a task has overrun its estimated sp, automatically recalculate remaining buffer and reallocate blocks in the Outlook calendar — pushing or shrinking other slots to absorb the overrun, respecting the Sunday 21:00 hard deadline.  
**Key work:**
- Build `rebalance_schedule(overrun_sp: number, context: WeekContext)` in `slide.ts`
- Implement slot-packing algorithm: fill from latest available slot backwards
- Update both Planner due dates and Outlook event times
- Log the rebalanced plan for user review

---

## Theme 2: Multi-Series & Collaboration

### IMP-05 — Multi-Series Support
**Current state:** Gentask is hardcoded to a single series (one set of Planner group IDs).  
**Improvement:** Support multiple concurrent manga series, each with its own Planner group set, Outlook calendar, and 18sp model configuration. A `--series` flag selects the active series.  
**Key work:**
- Replace flat env vars with a `~/.gentask/config.json` that maps series names to group ID sets
- Add `series` management commands: `gentask series add <name>`, `gentask series list`
- Update all modules to accept a `SeriesContext` instead of reading global env
- Implement series-aware snapshot namespacing

---

### IMP-06 — Multi-User Collaboration (Assistant Artist Support)
**Current state:** Gentask is single-user.  
**Improvement:** Allow an assistant artist to be assigned specific tasks (e.g., 3D Modeling, Background Layout). Assigned tasks are deployed to the assistant's Planner and Outlook, and their completions feed back into the main series sync.  
**Key work:**
- Add `assignee_id?: string` field to `task_schema`
- Route task creation to the correct user's Planner via `POST /users/{id}/planner/tasks`
- Aggregate sync inputs from multiple users' calendars in `build_sync_inputs()`
- Handle conflict resolution when both users update the same logical task

---

## Theme 3: Observability & Analytics

### IMP-07 — Weekly Burndown Chart Generation
**Current state:** No visual reporting.  
**Improvement:** After each sync, generate a burndown chart (remaining sp vs. elapsed days) as a PNG file saved to `~/.gentask/reports/{YYYY-WW}.png`. Optionally embed the chart as a card in a designated Planner task for easy access.  
**Key work:**
- Add `chartjs-node-canvas` or `vega-lite` dependency for server-side chart rendering
- Track daily sp snapshots in `~/.gentask/history/{YYYY-WW}.jsonl`
- Implement `generate_burndown_chart(week_data)` in a new `report.ts` module
- Add `npm run report:dev` script

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

### IMP-11 — Dry-Run Mode for All Commands
**Current state:** `gen`, `sync`, and `slide` execute immediately with no preview.  
**Improvement:** Add a `--dry-run` flag to all commands. In dry-run mode, show exactly what API calls would be made (PATCH urls + bodies) without executing them. Essential for production safety.  
**Key work:**
- Add `dry_run: boolean` option to `GraphService`, `PlannerService`, `PlannerSyncService`, `SlideService`
- In dry-run mode, print a colored diff of proposed changes instead of making API calls
- Add `--dry-run` to CLI arg parsing in all entry points

---

### IMP-12 — Full State Export / Import (Backup & Restore)
**Current state:** Snapshots cover individual task states, but there is no full-state export.  
**Improvement:** Add `gentask export` to dump all Planner plans, buckets, tasks, and Outlook events to a single JSON archive. Add `gentask import` to restore from that archive (e.g., after a tenant migration or accidental deletion).  
**Key work:**
- Build `backup.ts`: traverse all plans → buckets → tasks → events → write `~/.gentask/backup-{timestamp}.json`
- Build `restore.ts`: replay the JSON archive via POST/PATCH calls with idempotency checks
- Handle etag conflicts during restore
- Add `npm run backup:dev` / `npm run restore:dev` scripts

---

### IMP-13 — Plugin / Custom Action System
**Current state:** Sync actions are hardcoded (`complete`, `reschedule`, etc.).  
**Improvement:** Allow users to register custom sync action handlers via a plugin file at `~/.gentask/plugins.ts`. For example: "if note contains '入稿済み', mark the linked Outlook event as Done and send a LINE message."  
**Key work:**
- Define `SyncPlugin` interface: `{ pattern: RegExp; handler: (task, context) => Promise<void> }`
- Load plugins from `~/.gentask/plugins.ts` at startup via dynamic `import()`
- Run custom plugins after built-in action processing
- Document the plugin API with examples

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

### IMP-16 — Clip Studio Paint Auto-Completion Detection
**Current state:** Task completion requires manual Outlook notes or sync commands.  
**Improvement:** Watch a configurable `~/Documents/ClipStudio/` directory for `.clip` file save events. When a file matching a task title pattern is saved, automatically mark the corresponding Planner task as complete and update Outlook.  
**Key work:**
- Add `chokidar` for cross-platform file watching
- Build `studio_watcher.ts`: map filename patterns → task titles (configurable in `~/.gentask/config.json`)
- Run as a background daemon: `npm run studio:watch`
- Debounce rapid saves (only trigger after 5s of inactivity)

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

### IMP-18 — Docker Container + One-Command Setup
**Current state:** Setup requires installing Node, Azure CLI, and configuring env manually.  
**Improvement:** Provide a `Dockerfile` and `docker-compose.yml` that pre-installs all dependencies. Users only need to mount their `.env.dev` file and run `docker compose run gentask gen:dev -- "Episode N"`.  
**Key work:**
- Write multi-stage `Dockerfile` (build stage + runtime stage with Azure CLI)
- Write `docker-compose.yml` with volume mounts for `.env.*` and `~/.gentask/`
- Add `DOCKER_SETUP.md` with step-by-step instructions
- Test on macOS and Linux

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
