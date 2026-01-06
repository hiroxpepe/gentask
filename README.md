# Gentask

> **Energy-aware task orchestration for modern cloud workflows**

Gentask is a task orchestration tool that integrates **Microsoft 365 Planner** with cloud-based development environments, focusing on *how work feels*, not just *what needs to be done*.

---

## ✨ Philosophy

Most task managers optimize for priority and deadlines.  
Gentask optimizes for **execution energy**.

By classifying tasks based on *mental and operational load*, Gentask helps you decide **what kind of work you should do right now**.

---

## 🧠 Task Modes

Gentask introduces four execution modes:

| Mode  | Name            | Description |
|------:|-----------------|-------------|
| PTASK | Planning        | Thinking, designing, decision-making |
| TTASK | Technical       | Engineering, implementation, setup |
| CTASK | Creative        | Hands-on creation and focused execution |
| ATASK | Administrative | Maintenance, coordination, routine work |

These modes are designed to map naturally to **Microsoft 365 Planner buckets**, but remain platform-agnostic.

---

## 🚀 Features

+ Energy-based task classification
+ Native Microsoft 365 Planner integration
+ Cloud-friendly CLI workflow
+ Environment-aware execution (DEV / PROD)
+ Extensible architecture for future providers

---

## 🛠 Requirements

The following tools are expected to be available:

```sh
node -v
az --version
gcloud --version
````

---

## ⚙️ Environment Configuration

Create an environment configuration file (example: `.env.dev`):

```env
PROJECT_ENV=DEV
M365_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
M365_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
M365_CLIENT_SECRET=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

> **Important**
> Never commit real credentials to the repository.

---

## ▶️ Usage

Install dependencies:

```sh
npm install
```

Generate a task:

```sh
npm run gen:dev "task description"
```

Gentask routes tasks based on execution mode and environment context.

---

## 📦 Project Status

Gentask is under active development and used as a practical experiment in task orchestration across Microsoft 365 and cloud platforms.

---

## 📄 License

MIT
