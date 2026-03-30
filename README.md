# Gentask

> **AI-powered, energy-aware task orchestration for weekly manga serialization**

Gentask is a CLI tool that integrates **Microsoft 365 Planner** and **Outlook** with **Gemini 2.0 Flash AI** to manage the relentless production cycle of weekly manga serialization — automatically, intelligently, and with minimal friction.

---

## ✨ Philosophy

> *"Management that doesn't feel like management."*

A manga artist works in Outlook — their free canvas for moving blocks of time and jotting notes. Gentask (AI) silently reads those signals, calculates the gap against the **18sp production model**, and keeps the Planner ledger up to date without the artist ever having to touch it.

Most task managers optimize for priority and deadlines.  
**Gentask optimizes for execution energy and sustainable creative output.**

---

## 🧠 The 18sp / 36-Block Production Model

Gentask models one episode of manga as **18.0 story-points (18 hours)**, decomposed into **36 × 0.5sp (30-minute) blocks**.

| Phase | Task | sp | Blocks | Definition |
|---|---|---|---|---|
| **Planning (P)** | Plot | 2.0 | 4 | Full dialogue & direction intent |
| | Rough Name | 0.5 | 1 | Panel layout & reading flow |
| | Full Name | 0.5 | 1 | Expressions & detailed storyboard |
| **Production (C/T)** | Pre-Layout | 2.0 | 4 | Blueprint before 3D placement |
| | 3D Modeling | 3.0 | 6 | Posing & rendering complete |
| | Layout | 3.0 | 6 | Camera & background compositing |
| **Finishing (C)** | Edit | 2.5 | 5 | Touch-up, effects, polish |
| | Post | 0.5 | 1 | **Sunday 21:00 hard deadline** |
| **Buffer** | Reserve | 4.0 | 8 | Quality buffer / delay absorption |

---

## 🗂 Task Modes

Tasks are classified into four execution modes, each mapping to a dedicated Microsoft 365 Planner plan:

| Mode | Type | Description | Default Bucket |
|---|---|---|---|
| **PTASK** | Planning | Thinking, design, decision-making | 来週分 (Next Week) |
| **TTASK** | Technical | Engineering, implementation, setup | 今週分 (This Week) |
| **CTASK** | Creative | Hands-on creation, focused execution | 今週分 (This Week) |
| **ATASK** | Administrative | Coordination, maintenance, routine | 今週分 (This Week) |

Each mode maintains three buckets:

| Bucket | Role | Description |
|---|---|---|
| 今週分 | `current` | Active tasks for this week |
| 来週分 | `next` | Upcoming tasks (planning phase) |
| 完了 | `done` | Archived completed tasks |

---

## ⚙️ System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                        Gentask CLI                       │
│                                                          │
│  gen:dev / gen:prod                                      │
│       │                                                  │
│       ▼                                                  │
│  ┌─────────────┐     AI (Gemini 2.0 Flash)              │
│  │  index.ts   │────► task_flow (GenKit)                 │
│  │  task gen   │     Generate structured task array      │
│  └──────┬──────┘                                        │
│         │                                                │
│         ▼                                                │
│  ┌─────────────┐     MS Graph API (via az rest)         │
│  │ planner.ts  │────► Create plans / buckets / tasks    │
│  │ deployment  │────► Link Outlook events (Open Ext.)   │
│  └─────────────┘                                        │
│                                                          │
│  sync:dev / sync:prod                                    │
│       │                                                  │
│       ▼                                                  │
│  ┌─────────────┐     MS Graph API                       │
│  │  outlook.ts │────► Read calendar events              │
│  └──────┬──────┘                                        │
│         │                                                │
│         ▼                                                │
│  ┌─────────────┐     AI (Gemini 2.0 Flash)              │
│  │   sync.ts   │────► Interpret events → actions        │
│  │ AI sync     │────► PATCH Planner tasks               │
│  └─────────────┘                                        │
│                                                          │
│  slide:dev / slide:prod                                  │
│       │                                                  │
│       ▼                                                  │
│  ┌─────────────┐     MS Graph API                       │
│  │   slide.ts  │────► Archive → Promote → Schedule      │
│  │ weekly slide│────► Generate next episode plot        │
│  └─────────────┘                                        │
└─────────────────────────────────────────────────────────┘
```

---

## 🚀 Features

### 1. AI Task Generation (`gen`)
Given a subject (e.g. "Episode 42 of My Manga"), Gentask uses Gemini 2.0 Flash to generate a structured, mode-classified task array covering all four quadrants (P/T/C/A). Tasks are immediately deployed to Microsoft 365 Planner with the correct bucket placement and linked Outlook calendar events.

### 2. Intelligent AI Synchronizer (`sync`)
Gentask reads your Outlook calendar events and uses AI to interpret free-form notes as structured progress signals:

| User action in Outlook | AI interpretation | Planner update |
|---|---|---|
| Writes "ok" in event body | "This 30-min block is done" | Task marked complete (100%) |
| Moves event 30 min later | "Work time shifted" | Due date auto-corrected |
| Writes "手が止まった。明日やる" | "Incomplete, needs reschedule" | Task moved to next open slot |
| Writes "神回。倍の時間かけた" | "Over-budget, buffer consumed" | Buffer task offset |

Supported sync actions: `complete`, `reschedule`, `add_note`, `buffer_consumed`, `no_change`, `undo`.

### 3. Snapshot & Undo
Before every Planner PATCH, the current task state is saved as a JSON snapshot to `~/.gentask/snapshots/{taskId}.json`. To roll back: write `undo` or `戻して` in any Outlook event — the AI will detect it and restore the task to its previous state.

### 4. Weekly Slide (Sunday 21:00 Process)
The `slide` command automates the weekly episode transition:

1. **Verify** — Check that the "Post" task is 100% complete
2. **Archive** — Move all this-week tasks to the 完了 bucket
3. **Promote** — Move next-week planning tasks (plot, storyboard) to this-week
4. **Schedule** — Create Outlook calendar events for promoted tasks (Mon–Fri)
5. **Generate** — AI-generate a new plot task for the following episode into 来週分

### 5. Bidirectional Open Extensions
Every Outlook event and every Planner task carry cross-references:
- Outlook event: `{ "plannerTaskId": "xyz-123" }`
- Planner task: `{ "outlookEventId": "evt-789" }`

This ensures sync integrity even if the user renames events or tasks.

---

## 🛠 Requirements

| Tool | Purpose |
|---|---|
| `node` ≥ 18 | Runtime |
| `az` (Azure CLI) | MS Graph API calls via `az rest` |
| Microsoft 365 account | Planner + Outlook access |
| Google AI API key | Gemini 2.0 Flash via GenKit |

---

## ⚙️ Environment Configuration

Create `.env.dev` (and optionally `.env.prod`):

```env
PROJECT_ENV=DEV

# Microsoft 365
M365_USER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
M365_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
M365_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
M365_CLIENT_SECRET=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

# Planner Group IDs (one per task mode)
M365_PLANNER_PTASK_GROUP_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
M365_PLANNER_TTASK_GROUP_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
M365_PLANNER_CTASK_GROUP_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
M365_PLANNER_ATASK_GROUP_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

# Google AI (Vertex AI / Gemini)
GCP_VERTEX_AI_API_KEY=your-google-ai-api-key
```

> ⚠️ Never commit `.env.*` files to the repository.

Authenticate the Azure CLI before running:

```sh
az login --tenant <your-tenant-id>
```

---

## 📦 Installation

```sh
npm install
```

---

## ▶️ Usage

### Generate & Deploy Tasks

```sh
# Generate tasks for a subject and deploy to Planner (dev)
npm run gen:dev -- "Episode 42: The Final Battle"

# Production
npm run gen:prod -- "Episode 42: The Final Battle"
```

This will:
- Call Gemini AI to generate a structured task list
- Create 3-bucket Planner plans (今週分 / 来週分 / 完了) for each mode
- Deploy tasks to the correct bucket
- Create linked Outlook calendar events
- Store bidirectional Open Extension metadata

### AI Sync (Update Planner from Outlook)

```sh
# Read Outlook events and sync progress to Planner (dev)
npm run sync:dev

# Production
npm run sync:prod
```

This will prompt you to review AI-generated actions before applying them.

### Weekly Slide (Episode Transition)

```sh
# Run the weekly slide process (dev)
npm run slide:dev

# Production
npm run slide:prod
```

Run this on Sunday at 21:00 after posting. It archives the week, promotes planning tasks, schedules them on the next week's calendar, and generates the next episode's plot.

### Run Tests

```sh
# Run all unit tests
npm test

# Watch mode
npm run test:watch
```

---

## 🗃 Project Structure

```
gentask/
├── index.ts          # CLI entry point + AI task generation flow
├── types.ts          # Zod schemas: task modes, sync actions, bucket roles
├── env.ts            # Environment variable validation
├── graph.ts          # Low-level MS Graph API wrapper (az rest)
├── planner.ts        # Planner deployment: plans, buckets, tasks, extensions
├── outlook.ts        # Outlook: calendar events, extensions, sync input builder
├── sync.ts           # AI Synchronizer: interpret events → apply Planner actions
├── snapshot.ts       # Snapshot engine: save/restore task state for undo
├── slide.ts          # Weekly slide: archive → promote → schedule → generate
│
├── *.test.ts         # Vitest unit tests (60 tests, 9 files)
├── vitest.config.ts  # Vitest configuration (ESM, pool: forks)
│
├── .env.dev          # Dev environment config (not committed)
├── .env.prod         # Prod environment config (not committed)
├── package.json
└── tsconfig.json
```

---

## 🔁 Weekly Workflow

```
Monday
  │  npm run gen:dev -- "Episode N+1"  ← Deploy this week's production tasks
  │
Mon–Sun
  │  Work in Outlook (move blocks, write notes)
  │
  │  npm run sync:dev  ← Run anytime to reflect progress in Planner
  │
Sunday 21:00
  │  Post episode ✅
  │
  │  npm run slide:dev  ← Archive, promote, schedule, generate next episode
  ▼
Monday (next week)  ← Ready to go
```

---

## 🔄 Undo / Recovery

To undo the last sync operation on a task:

1. Open the linked Outlook event
2. Write `undo` or `戻して` anywhere in the event body
3. Run `npm run sync:dev`

Gentask will detect the undo signal, restore the task from its snapshot, and re-apply the previous state to Planner.

---

## 🧪 Testing

Gentask uses **Vitest** with full ESM and TypeScript support.

```sh
npm test
```

| File | Tests |
|---|---|
| `types.test.ts` | 12 |
| `env.test.ts` | 3 |
| `snapshot.test.ts` | 7 |
| `graph.test.ts` | 6 |
| `outlook.test.ts` | 6 |
| `planner.test.ts` | 4 |
| `sync.test.ts` | 8 |
| `slide.test.ts` | 12 |
| `index.test.ts` | 2 |
| **Total** | **60** |

---

## 📄 License

MIT

