# Gentask

> **AI-powered, energy-aware task orchestration for weekly manga serialization**

Gentask is a CLI tool that integrates **Google Tasks + Google Calendar** with **Gemini 2.0 Flash (Vertex AI)** via Genkit to manage the production cycle of weekly manga serialization — automatically and intelligently.

---

## ✨ Philosophy

> *"Management that doesn't feel like management."*

A manga artist works in Google Calendar — their free canvas for moving blocks of time and jotting notes. Gentask (AI) silently reads those signals, calculates the gap against the **18sp production model**, and updates Google Tasks automatically.

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
| **Technical (T)** | Pre-Layout | 2.0 | 4 | Blueprint before 3D placement |
| | 3D Modeling | 3.0 | 6 | Posing & rendering complete |
| | Layout | 3.0 | 6 | Camera & background compositing |
| **Creative (C)** | Edit | 2.5 | 5 | Touch-up, effects, polish |
| | Post | 0.5 | 1 | **Sunday 21:00 hard deadline** |
| **Buffer (A)** | Reserve | 4.0 | 8 | Quality buffer / delay absorption |

---

## 🗂 Task Modes

Tasks are classified into four execution modes, each mapped to a dedicated set of Google Tasks lists:

| Mode | Type | Description | Default Bucket |
|---|---|---|---|
| **PTASK** | Planning | Thinking, design, decision-making | 来週分 (Next Week) |
| **TTASK** | Technical | Engineering, implementation, setup | 今週分 (This Week) |
| **CTASK** | Creative | Hands-on creation, focused execution | 今週分 (This Week) |
| **ATASK** | Administrative | Coordination, maintenance, routine | 今週分 (This Week) |

Each mode maintains three Google Tasks lists (12 lists total):

| List name (Google Tasks) | Role (`bucket_role`) | Description |
|---|---|---|
| `gentask_{MODE}_今週分` | `current` | Active tasks for this week |
| `gentask_{MODE}_来週分` | `next` | Upcoming tasks (planning phase) |
| `gentask_{MODE}_完了` | `done` | Archived completed tasks |

Lists are auto-created on first run and cached at `~/.gentask/tasklists.json`.

---

## ⚙️ System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Gentask CLI                          │
│                                                             │
│  gen:dev / gen:prod                                         │
│       │                                                     │
│       ▼                                                     │
│  ┌──────────────┐   Gemini 2.0 Flash (Vertex AI / Genkit)   │
│  │  index.ts    │──► task_flow: 題材 → gen_task[]           │
│  └──────┬───────┘                                           │
│         │                                                   │
│         ▼                                                   │
│  ┌──────────────┐   Google Tasks API                        │
│  │  container   │──► get_container(mode) → {current,next,done} listIds│
│  │  manager     │   (auto-create & cache 12 lists)          │
│  └──────┬───────┘                                           │
│         │                                                   │
│         ▼                                                   │
│  ┌──────────────┐   Google Tasks API + Google Calendar API  │
│  │   deploy     │──► tasks.insert + calendar.events.insert  │
│  │              │──► Bidirectional link embed               │
│  └─────────────┘                                            │
│                                                             │
│  sync:dev / sync:prod                                       │
│       │                                                     │
│       ▼                                                     │
│  ┌──────────────┐   Google Calendar API                     │
│  │   sync.ts    │──► events.list (gentask_taskId filter)    │
│  └──────┬───────┘                                           │
│         │                                                   │
│         ▼                                                   │
│  ┌──────────────┐   Gemini 2.0 Flash (Vertex AI / Genkit)   │
│  │  sync_flow   │──► event body → sync_action[]             │
│  └──────┬───────┘                                           │
│         │                                                   │
│         ▼                                                   │
│  ┌──────────────┐   Google Tasks API                        │
│  │  apply_      │──► tasks.update (complete/reschedule/undo)│
│  │  actions     │                                           │
│  └─────────────┘                                            │
│                                                             │
│  slide:dev / slide:prod                                     │
│       │                                                     │
│       ▼                                                     │
│  ┌──────────────┐   Google Tasks API + Google Calendar API  │
│  │   slide.ts   │──► archive → promote → schedule → generate│
│  └─────────────┘                                            │
└─────────────────────────────────────────────────────────────┘
```

---

## 🚀 Features

### 1. AI Task Generation (`gen`)
Given a subject (e.g. "Episode 42 of My Manga"), Gentask uses Gemini 2.0 Flash via Genkit to generate a structured, mode-classified task array covering all four quadrants (P/T/C/A). Tasks are immediately deployed to Google Tasks into the correct list with linked Google Calendar events. A bidirectional link is embedded in both the task notes and the calendar event's `extendedProperties`.

### 2. Intelligent AI Synchronizer (`sync`)
Gentask reads Google Calendar events tagged with `gentask_taskId` and uses AI to interpret free-form notes as structured progress signals:

| User action in Calendar | AI interpretation | Google Tasks update |
|---|---|---|
| Writes "ok" in event body | "This block is done" | Task `status → completed` |
| Moves event to a later time | "Work shifted" | Task `due` auto-corrected |
| Writes "手が止まった。明日やる" | "Incomplete, reschedule" | Task moved to next open slot |
| Writes "神回。倍の時間かけた" | "Over-budget, buffer consumed" | Buffer task offset noted |

Supported sync actions: `complete`, `reschedule`, `add_note`, `buffer_consumed`, `no_change`, `undo`.

### 3. Snapshot & Undo
Before every task update, the current task state is saved as a JSON snapshot to `~/.gentask/snapshots/{taskId}.json`. To roll back: write `undo` or `戻して` in the linked Calendar event — the AI will detect it and restore the task to its previous state.

### 4. Weekly Slide (Sunday 21:00 Process)
The `slide` command automates the weekly episode transition:

1. **Verify** — Check that the CTASK "投稿" task is `status: completed` (other modes skip this check)
2. **Archive** — Move all `current` list tasks to the `done` list (for all modes)
3. **Promote** — Move `next` list tasks to `current`, set `due` to next Monday
4. **Schedule** — Create Google Calendar events for promoted tasks per the weekly matrix
5. **Generate** — AI-generate up to 4 PTASK plot tasks into PTASK `next` list

### 5. Bidirectional Links
Every Calendar event and every Task carry cross-references to maintain sync integrity:

- **Task notes** (appended): `[gentask:{"eventId":"…","calendarId":"…","listId":"…"}]`
- **Calendar event** (`extendedProperties.private`): `gentask_taskId`, `gentask_listId`

---

## 🛠 Requirements

| Tool | Purpose |
|---|---|
| `node` ≥ 18 | Runtime |
| Google account | Google Tasks + Google Calendar access |
| GCP project | OAuth 2.0 credentials + Vertex AI API key |

---

## ⚙️ Environment Configuration

Create `.env.dev` (and optionally `.env.prod`):

```env
# Google Vertex AI (Gemini)
GCP_VERTEX_AI_API_KEY=your-vertex-ai-api-key

# Google OAuth 2.0
GOOGLE_CLIENT_ID=xxxxxxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxx

# Google Calendar to sync with
GOOGLE_CALENDAR_ID=your-calendar-id@group.calendar.google.com

# Optional
GOOGLE_REDIRECT_URI=urn:ietf:wg:oauth:2.0:oob
GOOGLE_TOKEN_PATH=.google_token.json
```

> ⚠️ Never commit `.env.*` files to the repository.

---

## 📦 Installation

```sh
npm install
```

---

## 🔑 Google OAuth Setup (first time only)

```sh
# 1. Generate authorization URL
npm run google:auth-url

# 2. Open the URL in a browser, authorize, copy the code
# 3. Exchange the code for a token (saved to .google_token.json)
npm run google:save-token -- <authorization-code>

# 4. Verify access
npm run google:list-cals
```

---

## ▶️ Usage

### Generate & Deploy Tasks

```sh
# Generate tasks for a subject and deploy to Google Tasks + Calendar (dev)
npm run gen:dev -- "Episode 42: The Final Battle"

# Production
npm run gen:prod -- "Episode 42: The Final Battle"
```

This will:
- Call Gemini AI to generate a structured task list (P/T/C/A modes)
- Auto-create the 12 Google Tasks lists if they don't exist
- Deploy each task to the appropriate list (`今週分` or `来週分`)
- Create a linked Google Calendar event per task
- Embed bidirectional link metadata in both task notes and calendar event

### AI Sync (Calendar → Tasks)

```sh
# Read Google Calendar events and sync progress to Google Tasks (dev)
npm run sync:dev

# Production
npm run sync:prod
```

### Weekly Slide (Episode Transition)

```sh
# Run the weekly slide process (dev)
npm run slide:dev -- "Episode 43: Rising Action"

# Production
npm run slide:prod -- "Episode 43: Rising Action"
```

Run this on Sunday at 21:00 after posting.

### Run Tests

```sh
# Run all unit tests (timezone required for date tests)
TZ=Asia/Tokyo npm test

# Watch mode
npm run test:watch
```

---

## 🗃 Project Structure

```
gentask/
├── bin/        # CLI entry points (index.ts, sync.ts, slide.ts, google.ts)
├── lib/        # Shared utilities (types.ts, env.ts, snapshot.ts)
├── src/        # Core business logic (google.ts, google-container-manager.ts)
├── docs/       # Project documentation
├── .env.dev    # Dev environment config (not committed)
├── .env.prod   # Prod environment config (not committed)
├── package.json
└── tsconfig.json
```

---

## 🔁 Weekly Workflow

```
Monday
  │  npm run gen:dev -- "Episode N+1"
  │    → Deploy this week's production tasks to Google Tasks
  │    → Create linked Google Calendar events
  │
Mon–Sun
  │  Work in Google Calendar (move blocks, write notes)
  │
  │  npm run sync:dev  ← Run anytime to reflect progress
  │
Sunday 21:00
  │  Post episode ✅
  │
  │  npm run slide:dev -- "Episode N+2 hint"
  │    → Archive this week → Promote next week → Schedule → Generate
  ▼
Monday (next week)  ← Ready to go
```

---

## 🔄 Undo / Recovery

To undo the last sync operation on a task:

1. Open the linked Google Calendar event
2. Write `undo` or `戻して` anywhere in the event body
3. Run `npm run sync:dev`

Gentask detects the undo signal, restores the task from its snapshot (`~/.gentask/snapshots/{taskId}.json`), and re-applies the previous state.

---

## 🧪 Testing

Gentask uses **Vitest** with full ESM and TypeScript support.

```sh
TZ=Asia/Tokyo npm test
```

| File | Tests |
|---|---|
| `bin/google.test.ts` | 9 |
| `bin/index.test.ts` | 3 |
| `bin/sync.test.ts` | ~8 |
| `bin/slide.test.ts` | ~18 |
| `lib/env.test.ts` | 3 |
| `lib/snapshot.test.ts` | 7 |
| `lib/types.test.ts` | 12 |
| `src/google.test.ts` | 4 |
| **Total** | **~64** |

---

## 📄 License

MIT
