# Gentask

> **AI-powered, energy-aware task orchestration for weekly manga serialization**

Gentask is a CLI tool that integrates both Microsoft 365 (Planner + Outlook) and Google (Tasks + Calendar) with **Gemini 2.0 Flash (Vertex AI)** via GenKit to manage the production cycle of weekly manga serialization — automatically and intelligently. Which backend is used depends on the command and configuration: the main `gen`/`sync` entrypoints deploy to the configured backend (default: Microsoft Planner), and Google-specific helpers are available under `bin/google.ts` and `google:*` npm scripts.

---

## ✨ Philosophy

> *"Management that doesn't feel like management."*

A manga artist works in a calendar (Google Calendar or Outlook) — their free canvas for moving blocks of time and jotting notes. Gentask (AI) silently reads those signals, calculates the gap against the **18sp production model**, and updates the configured task backend (Microsoft Planner or Google Tasks) automatically.

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

Tasks are classified into four execution modes, each mapping to a dedicated task list or Planner bucket depending on the configured backend:

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
│                        Gentask CLI                      │
│                                                         │
│  gen:dev / gen:prod                                     │
│       │                                                 │
│       ▼                                                 │
│  ┌─────────────┐     AI (Gemini 2.0 Flash / Vertex AI)  │
│  │  index.ts   │────► task_flow (GenKit)                │
│  │  task gen   │     Generate structured task array     │
│  └──────┬──────┘                                         │
│         │                                               │
│         ▼                                               │
│  ┌─────────────┐     Task backend API (Microsoft Planner or Google Tasks) / Calendar API (Outlook or Google Calendar) │
│  │ tasks.ts / planner.ts │────► Create task lists / buckets / tasks         │
│  │ deployment  │────► Link Calendar events              │
│  └──────┬──────┘                                         │
│         │                                               │
│         ▼                                               │
│  ┌─────────────┐     Calendar API (Outlook or Google Calendar)                 │
│  │  calendar.ts / outlook.ts │────► Read calendar events               │
│  └──────┬──────┘                                         │
│         │                                               │
│         ▼                                               │
│  ┌─────────────┐     AI (Gemini 2.0 Flash / Vertex AI)  │
│  │   sync.ts   │────► Interpret events → actions        │
│  │ AI sync     │────► PATCH Tasks                       │
│  └─────────────┘                                         │
│                                                         │
│  slide:dev / slide:prod                                 │
│       │                                                 │
│       ▼                                                 │
│  ┌─────────────┐     Task backend / Calendar            │
│  │   slide.ts  │────► Archive → Promote → Schedule      │
│  │ weekly slide│────► Generate next episode plot        │
│  └─────────────┘                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 🚀 Features

### 1. AI Task Generation (`gen`)
Given a subject (e.g. "Episode 42 of My Manga"), Gentask uses Gemini 2.0 Flash (Vertex AI) via GenKit to generate a structured, mode-classified task array covering all four quadrants (P/T/C/A). Tasks are immediately deployed to the configured task backend (Microsoft Planner or Google Tasks) into the correct list/bucket with linked calendar events (Outlook or Google Calendar).

### 2. Intelligent AI Synchronizer (`sync`)
Gentask reads your calendar events (Google Calendar or Outlook) and uses AI to interpret free-form notes as structured progress signals:

| User action in Calendar | AI interpretation | Tasks update |
|---|---|---|
| Writes "ok" in event body | "This 30-min block is done" | Task marked complete (100%) |
| Moves event 30 min later | "Work time shifted" | Due date auto-corrected |
| Writes "手が止まった。明日やる" | "Incomplete, needs reschedule" | Task moved to next open slot |
| Writes "神回。倍の時間かけた" | "Over-budget, buffer consumed" | Buffer task offset |

Supported sync actions: `complete`, `reschedule`, `add_note`, `buffer_consumed`, `no_change`, `undo`.

### 3. Snapshot & Undo
Before every task update, the current task state is saved as a JSON snapshot to `~/.gentask/snapshots/{taskId}.json`. To roll back: write `undo` or `戻して` in the linked Calendar event — the AI will detect it and restore the task to its previous state in the configured task backend.

### 4. Weekly Slide (Sunday 21:00 Process)
The `slide` command automates the weekly episode transition:

1. **Verify** — Check that the "Post" task is 100% complete
2. **Archive** — Move all this-week tasks to the 完了 list
3. **Promote** — Move next-week planning tasks (plot, storyboard) to this-week
4. **Schedule** — Create calendar events (Outlook or Google Calendar) for promoted tasks (Mon–Fri)
5. **Generate** — AI-generate a new plot task for the following episode into 来週分

### 5. Bidirectional Links
Every Calendar event and every Task carry cross-references:
- Calendar event: `{ "taskId": "xyz-123" }`
- Task: `{ "eventId": "evt-789" }`

This ensures sync integrity even if the user renames events or tasks.

---

## 🛠 Requirements

| Tool | Purpose |
|---|---|
| `node` ≥ 18 | Runtime |
| `gcloud` (Google Cloud SDK) | Google APIs & authentication (if using Google backend) |
| Google account | Tasks + Calendar access (if using Google backend) |
| Google Vertex AI API key | Gemini 2.0 Flash via GenKit |
| Microsoft 365 account & app registration | Planner + Outlook access (if using Microsoft backend) |

---

## ⚙️ Environment Configuration

Create `.env.dev` (and optionally `.env.prod`):

```env
PROJECT_ENV=DEV

# Microsoft 365 (Planner / Outlook)
M365_USER_ID=your-m365-user-id
M365_PLANNER_PTASK_GROUP_ID=your-ptask-group-id
M365_PLANNER_TTASK_GROUP_ID=your-ttask-group-id
M365_PLANNER_CTASK_GROUP_ID=your-ctask-group-id
M365_PLANNER_ATASK_GROUP_ID=your-atask-group-id

# Google Cloud
GCP_PROJECT_ID=your-gcp-project-id
GCP_VERTEX_AI_API_KEY=your-google-ai-api-key

# OAuth (Google) - for Calendar/Tasks API access
GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxxxxxxx

# Optional: predefined Task list IDs (one per task mode)
GENTASK_TASKLIST_PTASK_ID=xxxxxxxxxxxxxxxx
GENTASK_TASKLIST_TTASK_ID=xxxxxxxxxxxxxxxx
GENTASK_TASKLIST_CTASK_ID=xxxxxxxxxxxxxxxx
GENTASK_TASKLIST_ATASK_ID=xxxxxxxxxxxxxxxx
```

> ⚠️ Never commit `.env.*` files to the repository.

Authenticate the Google Cloud SDK before running:

```sh
gcloud auth login
gcloud config set project $GCP_PROJECT_ID
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
- Deploy tasks to the configured backend (default: Microsoft Planner) into the appropriate buckets/lists
- Create linked calendar events (Outlook or Google Calendar depending on backend)
- Store bidirectional link metadata between tasks and events

Note: Use the `google:*` npm scripts (e.g., `npm run google:create-task`) to interact directly with Google Tasks/Calendar flows when needed.

### AI Sync (Update Tasks from Calendar)

```sh
# Read calendar events (Outlook or Google Calendar) and sync progress to the configured task backend (dev)
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
├── bin/               # Entry points / CLI scripts (index.ts, sync.ts, google.ts, slide.ts)
├── lib/               # API wrappers and utilities (Google & Microsoft helpers)
├── src/               # Core business logic (ai-flow.ts, sync-rules.ts, types.ts)
├── tools/             # Deployment and helper scripts
├── *.test.ts          # Vitest unit tests
├── vitest.config.ts   # Vitest configuration (ESM)
│
├── .env.dev           # Dev environment config (not committed)
├── .env.prod          # Prod environment config (not committed)
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
  │  Work in your calendar (Google Calendar or Outlook) (move blocks, write notes)
  │
  │  npm run sync:dev  ← Run anytime to reflect progress in the configured task backend
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

1. Open the linked Calendar event
2. Write `undo` or `戻して` anywhere in the event body
3. Run `npm run sync:dev`

Gentask will detect the undo signal, restore the task from its snapshot, and re-apply the previous state to the configured task backend.

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

