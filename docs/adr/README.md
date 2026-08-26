# Architecture Decision Records (ADR)

設計判断とその理由・トレードオフを記録する。[Michael Nygard方式](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)の軽量ADRを採用。

## 一覧

| # | タイトル | ステータス |
|---|---|---|
| [0001](./0001-single-vite-process.md) | 単一Vite devサーバー構成（モノレポにしない） | Accepted |
| [0002](./0002-shadcn-base-ui-nova.md) | shadcn/ui base=Base UI, style=nova | Accepted |
| [0003](./0003-d1-local-only.md) | D1はローカル開発のみ | Accepted |
| [0004](./0004-router-loader-over-query.md) | TanStack Router loaderを使い、TanStack Queryは導入しない | Accepted |
| [0005](./0005-defer-openapi.md) | OpenAPI生成は見送り、Hono RPCを当面の契約とする | Accepted |
| [0006](./0006-oxfmt-formatter.md) | コードフォーマッタにoxfmtを採用する | Accepted |
| [0007](./0007-ci-and-codegen.md) | CIをGitHub Actionsで回し、生成物はコミットせずcodegenスクリプトで再生成する | Accepted |
| [0008](./0008-typescript-7.md) | TypeScript 7（ネイティブ実装）へ更新する | Accepted |
| [0009](./0009-component-tests-happy-dom.md) | コンポーネントテストをVitest projectsで分離し、happy-dom + Testing Libraryで書く | Accepted |
| [0010](./0010-alcyone-as-proving-ground.md) | alcyoneを技術検証の台と位置づけ、プロダクト機能より基盤の完全性を優先する | Accepted |
| [0011](./0011-expand-contract-migrations.md) | スキーマ変更はexpand/contractで行い、D1固有の制約を前提にする | Accepted |
| [0012](./0012-no-on-delete-cascade.md) | `ON DELETE CASCADE`を使わず、子の削除は`batch()`で明示する | Accepted |
| [0013](./0013-better-auth.md) | 認証にBetter Authを採用し、メール+パスワードで始める | Accepted |
| [0014](./0014-user-owned-projects.md) | Projectはユーザーが所有し、Todoの所有はProject経由の推移的関係にする | Accepted |
| [0015](./0015-soft-delete-items-hard-delete-accounts.md) | 項目は論理削除、アカウントは物理削除にする | Accepted |
| [0016](./0016-e2e-with-playwright.md) | E2EテストをPlaywrightで書く（0009のBrowser Mode見送りを覆す） | Accepted |
| [0017](./0017-realtime-with-durable-objects.md) | リアルタイム更新をDurable Objects + WebSocketで実装する | Accepted |
| [0018](./0018-fts5-trigram-search.md) | 全文検索をFTS5のtrigramトークナイザで実装する | Accepted |
| [0019](./0019-object-cleanup-queue.md) | R2オブジェクトの削除をQueuesに逃がす | Accepted |
| [0020](./0020-data-export-workflow.md) | データエクスポートをWorkflowsで実装する | Accepted |
| [0021](./0021-d1-sessions-for-read-replicas.md) | リクエストごとにD1 Sessionを開き、bookmarkをCookieで引き継ぐ | Accepted |
| [0022](./0022-share-links-cached-in-kv.md) | 公開共有リンクを作り、その描画結果をKVにキャッシュする | Accepted |
| [0023](./0023-analytics-engine-events.md) | 数えるための出来事をAnalytics Engineに書く | Accepted |
| [0024](./0024-todo-status-instead-of-completed.md) | Todoの完了状態を真偽値から`status`に置き換え、詳細情報を持たせる | Accepted |
| [0025](./0025-kanban-board-view.md) | Todoをボード表示でも見せ、追加時から詳細を設定できるようにする | Accepted |
| [0026](./0026-timeline-not-a-gantt-chart.md) | 日付軸のタイムラインを作り、本格的なガントチャートは作らない | Accepted |
| [0027](./0027-comments-and-append-only-history.md) | Todoにコメントと、書き換えられない変更履歴を持たせる | Accepted |
| [0028](./0028-display-names-and-assignees.md) | 表示名を変更可能にし、Todoに担当者を持たせる | Accepted |
| [0029](./0029-task-links-and-an-editable-gantt.md) | タスク間の関係を持たせ、ガントチャート上で日程を編集できるようにする（0026の一部を覆す） | Accepted |
| [0030](./0030-put-adding-and-sharing-behind-buttons.md) | タスク追加と共有をボタンの後ろに置く（0025の「速い経路」を覆す） | Accepted |
| [0031](./0031-project-membership-and-roles.md) | プロジェクトに参加者を持たせ、管理者ロールを導入する（0014の単独所有を広げる） | Accepted |
| [0032](./0032-inviting-by-email-and-bootstrapping-the-admin.md) | メールアドレスで招待し、最初のアカウントを管理者にする（0031の残った穴を塞ぐ） | Accepted |

## ルール

- **採番**: 4桁の連番（`0001`, `0002`, ...）。欠番・削除はしない。
- **ファイル名**: `NNNN-kebab-case-title.md`
- **ステータス**:
  - `Proposed` — 提案中、まだ実施していない
  - `Accepted` — 採用し、実施済み
  - `Superseded by NNNN` — 別のADRに置き換えられた（このADR自体は編集せず、ステータス行だけ更新する）
  - `Deprecated` — 採用しないことにした、または前提が崩れて無効になった
- **既存ADRは編集しない**（誤字修正を除く）。決定を覆す場合は新しいADRを追加し、古い方のステータスを`Superseded by NNNN`に変える。
- 新規ADRを追加したら、上の一覧表に追記すること。
- `Decision Drivers`・`Confirmation`は任意項目（[`template.md`](./template.md)参照）。全ての決定に無理に書く必要はない。目安:
  - `Decision Drivers` — 複数の選択肢が拮抗する、または関係者の間で意見が割れる決定でのみ書く
  - `Confirmation` — lint・CI・レビューチェックリストなど、実際に確認できる手段があるときだけ書く

## 書くタイミング

- ライブラリ・アーキテクチャパターンの採用/見送りを決めたとき
- 複数の選択肢を比較して一つを選んだとき（比較した理由が後から重要になる）
- 「今回はやらない」と意図的にスコープ外にしたとき

コード規約レベルの細かい話（インデント幅、命名規則など）はADRではなく[`CLAUDE.md`](../../CLAUDE.md)に書く。
