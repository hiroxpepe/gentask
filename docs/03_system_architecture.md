
# Gentask: システムアーキテクチャとインフラ設計

## 1. コア・テクノロジースタック

* **AIモデル:** Google Vertex AI (`gemini-2.0-flash`)
* **AIフレームワーク:** Genkit (Node.js / TypeScript)
* **タスク/スケジュール基盤:** 主要に Microsoft 365 Planner + Outlook (Microsoft Graph) をサポート。Google Tasks + Google Calendar は補助的／実験的なフローとして実装済み。
* **インフラ管理:** Google Cloud CLI (gcloud)（Googleフロー）および Azure CLI (az)（Microsoft フロー）

## 2. 環境分離とサンドボックス設計（Dev / Prod）

論理的には4つのロール（P/T/C/A）が存在しますが、開発環境（Dev）と本番環境（Prod）で物理的なルーティングを動的に変更します。

* **Dev環境:** 破壊的テストを安全に行うため、4つすべてのロールの投げ先を **「同一のサンドボックスID（代表グループ）」** に集約します。
* **Prod環境:** 各ロールのIDをそれぞれ独立した実運用グループへルーティングします。

### ID 解決アーキテクチャ

```mermaid
graph LR
    A[Genkit AI / Logic] -->|判定: PTASK| B{環境判定 .env}
    
    B -->|PROJECT_ENV=DEV| C[代表グループID<br/>サンドボックス]
    B -->|PROJECT_ENV=PROD| D[企画T グループID<br/>本番用バケット]
    
    C --> E[Task backend API (Microsoft Planner / Google Tasks)]
    D --> E
    
    style C fill:#fff3e0,stroke:#ff9800
    style D fill:#e8f5e9,stroke:#4caf50
```

## 3. 認証・セキュリティ設計

* **サービスアカウントの独立:** `gentask-api-user` を Dev/Prod 双方で個別に作成し、`roles/aiplatform.user` 権限を付与。
* **APIキーの厳格管理:** CLI経由で生成した Vertex AI API キー（UIDベース）を `.env.dev` および `.env.prod` に隔離して管理。
* **OAuthユーザートークン:** Tasks/Calendarへの書き込みは、ユーザー自身の権限をOAuthラッパー経由で取得し実行。

> NOTE: 現状のリポジトリは Microsoft Planner を主要バックエンドとして想定しており、bin/index.ts や src/planner.ts / src/container_manager.ts は Microsoft Graph (Planner/Outlook) に依存します。Google のフローは lib/google.ts と bin/google.ts で利用可能ですが、ランタイムでの完全なマルチバックエンド選択は実装されていません。
