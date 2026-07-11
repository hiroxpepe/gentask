# Command Spec (Phase 1)

> Per-command detail for the Phase 1 skeleton commands (`new_spec_gentask_JP.md` ch.10).
> Each command lists: arguments, a decision table (input condition -> action), and edge cases.
> This is the source for TDD test cases. Structure: `docs/er_phase1.md`. Not final.

Conventions used below:
- **error** means the tool refuses and prints why; nothing is written.
- **15-min grid**: a slot always starts on a 15-minute boundary (00, 15, 30, 45).
- The tool is deterministic. No guessing. If input is unclear, it errors rather than assume.

---

## slot log

Record real time as 15-minute slots. The core of "no hand-input hell": one command
makes many slots at once, and optionally ties them all to a task in the same call.

```
gentask slot log (--from <time> --to <time> | --last <dur>) --cat <8-value> [--task <uuid>]
```

Arguments:
- `--from` / `--to`: an absolute span (e.g. `9:00`..`11:00`). Both required together.
- `--last`: a relative span back from now (e.g. `2h`, `90m`). Alternative to from/to.
- `--cat`: one of the 8 categories (P/T/C/A/D/J/W/M). Required.
- `--task`: optional task uuid. If given, every slot made is assigned to that task.

### Decision table

| # | span input | --cat | --task | action |
|---|---|---|---|---|
| 1 | `--from a --to b` (a<b, on grid) | valid | absent | make slots a..b, category set; no assignment |
| 2 | `--from a --to b` | valid | valid task | make slots a..b; assign every slot to task |
| 3 | `--last <dur>` | valid | absent | make slots from now-dur..now; category set |
| 4 | `--last <dur>` | valid | valid task | make slots; assign every slot to task |
| 5 | both `--from/--to` and `--last` given | valid | any | error: pick one span mode |
| 6 | neither span given | valid | any | error: need --from/--to or --last |
| 7 | `--from a --to b` with a>=b | valid | any | error: end must be after start |
| 8 | span given | missing --cat | any | error: --cat is required |
| 9 | span given | invalid cat (e.g. Z) | any | error: cat must be one of 8 values |
| 10 | span given | valid | task uuid not found | error: task does not exist (nothing written) |
| 11 | span not on 15-min grid (e.g. 9:07) | valid | any | snap to grid (round to nearest 15) — or error; see edge |
| 12 | span overlaps slots already logged | valid | any | see edge cases (overlap policy) |

### Edge cases (decided)

Decisions follow the trunk: hand-usable, deterministic, plan vs record split, no surprise.

- **Off-grid times (9:07..10:52) -> snap to nearest 15 (9:00..10:45).** Hand use wins;
  a human types the rough time they felt. Snapping is stated, so it is not a surprise.
- **`--last 90m` from 10:20 -> snap "now" down to 10:15, then count back.** Deterministic.
- **Zero-length after snap (`--last 5m`) -> error: span too short for one slot.**
- **Overlap with an existing block -> the block exists once; a second `--task` on it adds an
  assignment, it does not duplicate the slot.** Matches spec ch.5 (a 15-min block can hold
  more than one thing). Category of an existing block is not silently overwritten; changing it
  is an explicit action, not a side effect of `slot log`.
- **Crossing midnight (`--from 23:30 --to 1:00`) -> error: same-day only.** Splitting days
  silently is a surprise; the human logs each day plainly.
- **`--task` uuid valid format but not in db -> error before writing any slot (all-or-nothing).**
  No half-written span.
- **Huge span (0:00..23:45 = 96 slots) -> allowed, no silent cap.** Deterministic, just large.
- **Future span (now 10:00, `--from 15:00 --to 17:00`) -> error: slot is past-only.**
  A slot is real time already spent. The future lives on the kanban (plan), not in slots.

---

## content add

Create a content (release division of the world).

```
gentask content add <title> --kind <manga|game|book|model3d>
```

### Decision table
| # | title | --kind | action |
|---|---|---|---|
| 1 | non-empty | valid 4-value | create content, mint uuid, return it |
| 2 | empty / whitespace-only | valid | error: title required |
| 3 | non-empty | invalid (e.g. movie) | error: kind must be manga/game/book/model3d |
| 4 | non-empty | missing | error: --kind required |
| 5 | missing | valid | error: title required (positional) |

### Edge cases (decided)
- **Whitespace-only title -> trim; if empty, error.** No blank titles.
- **Kind in upper case (MANGA) -> error, not silently lowered.** Deterministic; the human types the exact token.
- **Duplicate title -> allowed.** A title is not unique; the same world has many contents.
- **Control chars / newlines in title -> rejected.** One-line titles only.

---

## task add

Add a work step under a content. Steps are the leaf level of the model.

```
gentask task add <content-uuid> <title> --mode <P|T|C|A> --sp <n>
```

### Decision table
| # | content-uuid | title | --mode | --sp | action |
|---|---|---|---|---|---|
| 1 | exists | non-empty | valid | int >=0 | create task, mint uuid, put on kanban "someday" by default |
| 2 | not found | any | any | any | error: content does not exist |
| 3 | exists | empty | valid | valid | error: title required |
| 4 | exists | non-empty | invalid (e.g. D) | valid | error: mode must be P/T/C/A |
| 5 | exists | non-empty | missing | valid | error: --mode required |
| 6 | exists | non-empty | valid | missing | error: --sp required (or default 0 — see edge) |
| 7 | exists | non-empty | valid | negative | error: sp must be >= 0 |

### Edge cases (decided)
- **--sp missing -> default to 0.** A step with unknown size is still a step; 0 means "unsized".
- **--mode uses life values (D/J/W/M) -> error.** A task is work only; life is not a task
  (life shows up as slots, never as tasks).
- **New task's kanban column -> "someday" by default.** Adding is not committing to this week;
  `task move` puts it on the plan.

---

## task move

Move a task between kanban columns (the plan; future has no clock time).

```
gentask task move <task-uuid> <col>   # col = this-week | next-week | someday
```

### Decision table
| # | task-uuid | col | action |
|---|---|---|---|
| 1 | exists | valid column | move task to column |
| 2 | not found | any | error: task does not exist |
| 3 | exists | invalid column | error: col must be this-week/next-week/someday |
| 4 | exists | same as current | no-op, success (idempotent) |

### Edge cases (decided)
- **A task with logged slots (already worked) moved back to "someday" -> allowed.**
  Plan and record are separate; moving the plan does not erase the record.
- **No clock time is ever set here.** The kanban is time-free by design; time appears only when
  work is logged as slots (record).

---

## release add

Reserve a publish of a deliverable to a channel, with a deadline.

```
gentask release add <deliverable-uuid> <channel-uuid> --due <date>
```

### Decision table
| # | deliverable | channel | --due | action |
|---|---|---|---|---|
| 1 | exists | exists | valid future/any date | create release, status=plan |
| 2 | not found | any | any | error: deliverable does not exist |
| 3 | exists | not found | any | error: channel does not exist |
| 4 | exists | exists | missing | error: --due required |
| 5 | exists | exists | not a date | error: --due must be YYYY-MM-DD |

### Edge cases (decided)
- **--due in the past -> allowed (with a note).** You may log a release that already shipped;
  the deadline device only bites for plan status, and the human may back-fill history.
- **Second release of the same deliverable to the same channel -> allowed.** A re-release
  (fix, new edition) is real. Not blocked.
- **status starts at plan.** `release done` moves it to done (see below).

---

## release done

Mark a release as shipped.

```
gentask release done <release-uuid>
```

### Decision table
| # | release-uuid | current status | action |
|---|---|---|---|
| 1 | exists | plan | set status=done |
| 2 | not found | — | error: release does not exist |
| 3 | exists | already done | no-op, success (idempotent) |

### Edge cases (decided)
- **Marking done does not check whether the work is finished.** The tool does not judge
  (trunk: no judging). The human says it shipped; the tool records it.
- **No un-done command in Phase 1.** Reverting a shipped release is rare; add later if needed.

---

## deliverable add

Create a deliverable (unit of release) under a content.

```
gentask deliverable add <content-uuid>
```

### Decision table
| # | content-uuid | action |
|---|---|---|
| 1 | exists | create deliverable, ver=1, mint uuid |
| 2 | not found | error: content does not exist |

### Edge cases (decided)
- **ver starts at 1.** `deliverable bump` raises it (v2, v3...) for a revision.
- **Many deliverables under one content -> allowed.** A manga content has many weekly deliverables.
- **Kind-specific identity (manga = edition x number x language) is Phase 2.** Phase 1 keeps
  deliverable minimal (content_id, ver); the detail that makes it unique per kind comes later.
