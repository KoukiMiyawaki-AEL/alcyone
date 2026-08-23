# alcyone 初期アーキテクチャ

Status: 実装済み（初期スコープ・参照用に保持）

## Summary

React + TanStack Router + shadcn/uiのフロントエンドと、Hono + Drizzle ORM + Cloudflare D1のバックエンドを、単一のVite開発サーバー（`@cloudflare/vite-plugin`）上で同時に動かす、alcyoneの最初のフルスタック構成。

## Background & Problem

新規プロジェクトとして、React/TypeScript/shadcn-uiを核としたUI基盤と、Hono/Drizzle/D1をCloudflare Workers上で動かすAPIを、最初から一体として構築する必要があった。単に「動くだけのTodo」を作るのではなく、**Functional vertical slice（機能面）とVisual vertical slice（デザイン面）を同時に満たす最初のマイルストーン**を作ることが目的だった。React → Hono → D1が実際に動作し、同時にTheme・Typography・Spacing・Responsive・Dark Mode・状態表現（empty/loading/error/disabled/focus）の基準が最初から存在する状態を完成条件とした。

## Goals & Non-Goals

**Goals**
- 単一のVite devサーバーでSPAとAPIを同時に動かす
- shadcn/uiを最初からUI基盤として組み込み、Design Tokens・Light/Dark・レスポンシブ・状態表現（empty/loading/error）の基準を用意する
- Todos CRUDを、上記の基準を満たす形で実装する（機能面とデザイン面の両立）
- ローカルD1 + Drizzleでデータ層を検証する
- Vitestで統合テストを書く

**Non-Goals**（[CLAUDE.md](../../CLAUDE.md)の「Not Yet」と対応）
- 実際のCloudflareアカウントへのD1作成・本番デプロイ（[ADR 0003](../adr/0003-d1-local-only.md)）
- TanStack Query、認証、Turborepo、Alchemy、R2/KV/Queues、Playwright、Storybookの導入
- OpenAPI仕様書の生成（[ADR 0005](../adr/0005-defer-openapi.md)）

## Proposal

レイヤー構成とリクエストフローの全体像は [Alcyone Runtime Map](https://claude.ai/code/artifact/d09c4c3c-fa8c-42bb-8573-2cc8c8bf458c)（アーキテクチャ図Artifact、EN/日本語切替対応）を参照。要点:

```
Browser
 ├─ React SPA（TanStack Router: src/routes/）
 └─ shadcn/ui + ThemeProvider（Light/Dark/System）
        │ fetch /api/*                          │ navigate（hard reload）
        ▼                                        ▼
Vite Dev Server（@cloudflare/vite-plugin、単一プロセス）
 ├─ Worker environment（Hono app: src/worker/index.ts）
 │    ← assets.run_worker_first: ["/api/*"] に一致するリクエストのみ
 └─ Client environment（SPAビルド、assets.not_found_handling: spa）
        │ drizzle(c.env.DB)
        ▼
Drizzle ORM（drizzle-orm/d1） → Cloudflare D1（ローカルのみ）
```

`assets.run_worker_first`で`/api/*`だけをWorkerに向けているのが、この構成の要になっている。
これが無いと全リクエストがまずHonoに入り、Honoの`notFound`が未知のパスを掴んでしまうため、
SPAのクライアントサイドルーティング（`/dev/design-system`への直接アクセスや存在しないURL）が
`index.html`にフォールバックできない。

Vitestは`test.projects`で2つに分かれている（[ADR 0009](../adr/0009-component-tests-happy-dom.md)）。`worker`プロジェクトはブラウザもVite側のclient environmentも経由せず、`app.request()`でHono appを直接呼び出す。`components`プロジェクトはWorkerを経由せず、happy-dom上でReactコンポーネントだけを描画する。つまりどちらの経路も図の全体を通しては検証しておらず、上から下まで繋がっていることの確認は`pnpm dev`での手動確認が担っている。

主要な技術選定とその理由は、それぞれ対応するADRに切り出してある:
- [0001](../adr/0001-single-vite-process.md) 単一Vite devサーバー構成（モノレポにしない）
- [0002](../adr/0002-shadcn-base-ui-nova.md) shadcn/ui base=Base UI, style=nova
- [0003](../adr/0003-d1-local-only.md) D1はローカル開発のみ
- [0004](../adr/0004-router-loader-over-query.md) TanStack Router loaderを使い、TanStack Queryは導入しない
- [0005](../adr/0005-defer-openapi.md) OpenAPI生成は見送り、Hono RPCを当面の契約とする
- [0006](../adr/0006-oxfmt-formatter.md) コードフォーマッタにoxfmtを採用する
- [0007](../adr/0007-ci-and-codegen.md) CIをGitHub Actionsで回し、生成物はコミットせずcodegenスクリプトで再生成する
- [0008](../adr/0008-typescript-7.md) TypeScript 7（ネイティブ実装）へ更新する
- [0009](../adr/0009-component-tests-happy-dom.md) コンポーネントテストをVitest projectsで分離し、happy-dom + Testing Libraryで書く

## Alternatives

各ADRの「Alternatives considered」を参照。全体構成レベルでの主な分岐点は、モノレポ化するか（[0001](../adr/0001-single-vite-process.md)）と、データ取得にTanStack Queryを最初から入れるか（[0004](../adr/0004-router-loader-over-query.md)）の2点だった。

## Definition of Success

- `pnpm run check`（codegen → format:check → lint → 型チェック → build → Vitest → `wrangler deploy --dry-run`）が通る
- `pnpm dev`でTodoの追加・完了トグル・削除がローカルD1に反映される
- `/dev/design-system`でLight/Dark・レスポンシブ・empty/loading/error stateを目視確認できる

初期スコープ時点で一度検証済み（Playwrightによるスクリーンショット確認込み）。
その後、[0006](../adr/0006-oxfmt-formatter.md) / [0007](../adr/0007-ci-and-codegen.md)で
`check`にformat・lint・testを取り込み、CIが同じコマンドを回すようにした。
