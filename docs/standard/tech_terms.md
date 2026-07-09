# Technical Terms

> The one place where the technical terms are given their sense.
> The writing standard turns off the simple-word rule only for words in this
> list. If a term is not here, do not use it in a document — add it here first.
> The sense of each term is given in simple words, so a reader whose first
> language is not English, and an agent too, can take it in.

Each entry has a short sense, and where it helps, a note on how the term is
used in real work.

---

## Version control (Git)

**repository** — The place where all the files of a project are kept, together
with the full record of their changes over time. Often said in the short form
"repo".

**commit** — To put a set of changes into the record of the repository, as one
step with a note on what changed. Also the name of that one saved step.
*In use: each commit is one point you can come back to later.*

**push** — To send the commits made on your own machine up to the shared
repository, so others (and agents) get them too.

**pull** — To get the newest commits from the shared repository down to your
own machine.

**clone** — To make a full copy of a repository onto a machine for the first
time.

**branch** — A line of commits that goes its own way, apart from the main line,
so work can go on without touching the main line. The main line is often named
`master` or `main`.

**merge** — To bring the commits of one branch into another branch.

**PAT** — Short for "personal access token". A secret key that lets a tool act
on a repository in your name, without a password each time.
*In use: keep it out of the repository; never commit it.*

---

## Language models and agents

**LLM** — Short for "large language model". A model that takes in words and
gives back words. It is not sure or fixed: the same input may give a different
output. For this reason its work is kept to judgment, not to sure steps.

**agent** — An LLM set up to do work on its own: it reads, it makes a choice,
it takes an act (such as running a tool), and it goes on by steps toward an
end. In this project the agent works through Git.

**model** — One named LLM among the many (for example, one may be fast and
cheap, another slow and strong). The agent may be told which model to use, and
this may be changed.

**prompt** — The words given to an LLM to set it to work.

---

## Programs and interfaces

**CLI** — Short for "command-line interface". A program run by typing a line,
not by clicking. It does one clear thing and gives a clear result, the same way
each time. In this project the CLI is the core: it must run on its own, with no
LLM.

**API** — Short for "application programming interface". A fixed way for one
program to ask another program (or a web service) to do something or give data.

---

## Data store

**SQLite** — A small database kept in one file. It holds the true state of the
work, and keeps the links between the many parts in order. In this project the
`.db` file is the true store (the "master copy"), kept in the repository.

**CSV** — Short for "comma-separated values". A plain-text way to keep rows and
columns. In this project the CSV is the "window": it is written out from the
SQLite file so that its changes show up in the Git record. The Git history of
the CSV is what lets a person look back later. People do not type into it by
hand; the CLI is what writes it.

---

## Work model

**content** — A finished work: one 4-panel episode, a 3D model, a game, and so
on. It is the unit of a series — the thing that goes out to the world.

**task** — One step of work that goes into making a content (for example: plot,
name, 3D modeling). A content is made of many tasks.

**slot** — A block of time, 15 minutes long. It is the smallest unit of the
record. Each slot is marked with what kind of time it was (work or life). The
sense is close to a "slot" in broadcasting: a time block, before or after use.

**assignment** — The link that says which task was done in which slot, and how
it really went. It is what the agent changes when a person tells (in words)
what they did.

> Note: the exact fields of content / task / slot / assignment are not yet
> fixed. They are set in the schema work that is still to come. This reference
> gives the sense of each term, not its full field list.

---

## How to keep this list

- One term, one sense. Give the sense in one place only — here.
- Keep the sense in simple words, by the writing standard.
- Add a term **before** it is first used in any document.
- When a term is no longer used anywhere, it may be taken out.
