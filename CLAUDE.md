# alcyone

React + TanStack Router + shadcn/ui（Tailwind CSS v4）を採用したフロントエンドと、
Hono + Drizzle ORM + Cloudflare D1 をCloudflare Workers上で動かすバックエンドを、
単一のVite開発サーバー（`@cloudflare/vite-plugin`）で同時に動かす構成。

## Tech Stack

| 分類 | 選択 |
|---|---|
| パッケージ管理 | pnpm（Node/pnpmのバージョンは`mise.toml`で固定） |
| フロントエンド | React 19 + TypeScript strict + Vite |
| ルーティング | `@tanstack/react-router`（ファイルベース、`src/routes/`。TanStack Startは使わない） |
| UI | Tailwind CSS v4 + shadcn/ui（base: Base UI, style: nova, baseColor: neutral） |
| API | Hono（`src/worker/index.ts`）+ `@hono/zod-validator` + zod |
| クライアント | `hono/client`の`hc<AppType>`で型安全に呼び出す（`src/lib/api-client.ts`） |
| DB | Drizzle ORM (`drizzle-orm/d1`) + Cloudflare D1 |
| テスト | Vitest + `@cloudflare/vitest-plugin`（D1マイグレーション込みの統合テスト） |

D1は現時点でローカル開発のみ（`wrangler dev` + `wrangler d1 migrations apply --local`）。
`wrangler.jsonc`の`database_id`はプレースホルダで、実際のCloudflareアカウント上のD1は
まだ作成していない。本番デプロイ手順は今後追加する。

### よく使うコマンド

```bash
pnpm dev                 # Vite dev server（SPA + Hono Workerを同時に起動）
pnpm test                 # Vitest（D1込みの統合テスト）
pnpm run check            # 型チェック + build + wrangler deploy --dry-run
pnpm run db:generate      # drizzle-kit generate（schema.tsの差分からmigration生成）
pnpm run db:migrate:local # ローカルD1へmigration適用
pnpm run cf-typegen       # wrangler.jsoncのbindingsからCloudflareBindings型を再生成
```

`wrangler.jsonc`のbindingsを変更したら`pnpm run cf-typegen`を再実行すること。

## UI / Design System

shadcn/ui + Tailwind CSSを初期UI基盤として使用する。

Design principles:

- Clean
- Minimal
- Consistent
- Accessible
- Responsive
- Information hierarchyを明確にする
- 不必要な装飾を避ける
- 業務利用でも長時間使用しやすいUIにする

### Component Rules

UI primitiveは原則としてshadcn/uiを使用する。

例:

- Button
- Input
- Label
- Card
- Dialog
- Dropdown Menu
- Select
- Checkbox
- Tabs
- Table
- Tooltip
- Sheet
- Toast

既存のshadcn/uiコンポーネントで実現できるものを独自実装しない。
ただし、shadcn/uiのコードはプロジェクト所有（`src/components/ui/`）なので、
アプリのDesign Systemに合わせた変更は許可する。

新しいコンポーネントを追加するときは `pnpm dlx shadcn@latest add <component>` を使う
（baseは`base-ui`、styleは`nova`のまま。`components.json`を参照）。

### Component Layers

以下の責務を分ける。

```
src/components/ui
→ shadcn/ui primitives（生成物。極力そのまま使う）

src/components/app
→ アプリ全体で使う composed components
  （AppHeader, AppSidebar, PageHeader, EmptyState, ThemeProvider, ModeToggle など）

src/features/*/components
→ ドメイン固有のコンポーネント（例: src/features/todos/components/）
```

route component（`src/routes/*.tsx`）に巨大なUIを直接実装しない。
featureのロジック・型は`src/features/<name>/`にまとめる。

### Design Tokens

色・radius・background・foregroundなどはsemantic design tokenを使用する
（`src/index.css`の`@theme inline`で定義済み）。

Prefer:

- `bg-background` / `text-foreground`
- `bg-primary` / `text-primary-foreground`
- `text-muted-foreground`
- `border-border`

Avoid:

- `bg-blue-500` / `text-gray-700` / `border-zinc-300` などの直接的な色指定を
  アプリケーションコードへ無秩序に追加すること。

必要な色はDesign Token（`src/index.css`内の`:root` / `.dark`）として定義する。

### Typography

Typography hierarchyを明確にする。最低限:

- Page title
- Section title
- Body
- Secondary text
- Label
- Caption

を視覚的に区別する。参考実装は `/dev/design-system` にある。

### Layout

一貫したspacingを使用する。ページは原則として以下の構造を持つ
（`src/routes/__root.tsx`のAppShellが既にこの構造）。

```
AppShell
 ├─ AppHeader / AppSidebar
 └─ main
     ├─ PageHeader
     └─ PageContent
```

### Responsive Design

最低限以下を考慮する。

- Desktop
- Tablet
- Mobile

固定幅前提のUIを作らない。

### Accessibility

最低限:

- semantic HTML
- keyboard navigation
- visible focus
- aria attributes where required
- sufficient contrast
- form label
- accessible dialog

を維持する。shadcn/uiのアクセシビリティを独自変更によって壊さない。

### Dark Mode

Light / Dark / Systemをサポートする（`ThemeProvider` / `ModeToggle`参照）。
色を直接指定せず、theme tokenで切り替えられるようにする。

### Design Review

新しい画面を完成とする前に以下を確認する。

- visual hierarchy
- spacing consistency
- alignment
- typography
- responsive behavior
- empty state
- loading state
- error state
- disabled state
- focus state
- dark mode

## `/dev/design-system`

`src/routes/dev.design-system.tsx` はコンポーネントギャラリーページ。
shadcn/uiコンポーネントを追加・変更したら、ここに使用例を追加してLight/Dark・
レスポンシブを確認する運用にする（Storybookはまだ導入しない）。

## Data Fetching

TanStack Queryはまだ導入していない。データ取得はTanStack Routerの`loader`を使い、
mutation後は`router.invalidate()`で再取得する（`src/routes/index.tsx`参照）。

## Not Yet

以下は初期スコープに含めない（将来必要になったら追加する）。

- TanStack Query
- Authentication
- Playwright
- Turborepo
- Alchemy
- R2 / KV / Queues
- Storybook
- 実際のCloudflareアカウントへのD1作成・本番デプロイ
