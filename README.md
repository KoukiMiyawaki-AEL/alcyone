# alcyone

React + TanStack Router + shadcn/ui（Tailwind CSS v4）+ Hono + Drizzle ORM + Cloudflare D1
を、単一のVite開発サーバー（`@cloudflare/vite-plugin`）で動かすフルスタック構成。

技術スタックの詳細・デザイン規約は [CLAUDE.md](./CLAUDE.md) を参照。

## セットアップ

```bash
pnpm install

# ローカルD1にmigrationを適用（初回のみ / schema.tsを変更したら再実行）
pnpm run db:generate
pnpm run db:migrate:local
```

## よく使うコマンド

```bash
pnpm dev                 # Vite dev server（SPA + Hono Workerを同時に起動）
pnpm test                 # Vitest（D1込みの統合テスト）
pnpm run check            # 型チェック + build + wrangler deploy --dry-run
pnpm run db:generate      # drizzle-kit generate（schema.tsの差分からmigration生成）
pnpm run db:migrate:local # ローカルD1へmigration適用
pnpm run cf-typegen       # wrangler.jsoncのbindingsからCloudflareBindings型を再生成
```

## 構成

- `src/routes/` — TanStack Routerのファイルベースルート（`/`がTodos、`/dev/design-system`がコンポーネントギャラリー）
- `src/components/ui/` — shadcn/ui primitives
- `src/components/app/` — アプリ共通のcomposed components（AppHeader, ThemeProviderなど）
- `src/features/todos/` — Todos機能のコンポーネント・型
- `src/worker/` — Hono API（Cloudflare Worker）+ Drizzleスキーマ
- `test/worker/` — Vitest（`@cloudflare/vitest-plugin`）による統合テスト

D1は現時点でローカル開発のみ。本番デプロイ（実際のCloudflareアカウント上のD1作成含む）は未対応。
