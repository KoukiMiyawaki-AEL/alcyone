# alcyone

React + TanStack Router + shadcn/ui（Tailwind CSS v4）+ Hono + Drizzle ORM + Cloudflare D1
を、単一のVite開発サーバー（`@cloudflare/vite-plugin`）で動かすフルスタック構成。

技術スタックの詳細・デザイン規約は [CLAUDE.md](./CLAUDE.md) を参照。

## セットアップ

Node / pnpmのバージョンは`mise.toml`で固定している（[mise](https://mise.jdx.dev/)推奨）。

```bash
pnpm install

# 生成物（worker-configuration.d.ts / src/routeTree.gen.ts）はコミットしていないので、
# clone直後は必ず実行する。これが無いと型チェックが通らない
pnpm run codegen

# ローカルD1にmigrationを適用（初回のみ / schema.tsを変更したら再実行）
pnpm run db:generate
pnpm run db:migrate:local
```

## よく使うコマンド

```bash
pnpm dev                  # Vite dev server（SPA + Hono Workerを同時に起動）
pnpm test                 # Vitest 両プロジェクト（worker: D1込みの統合 / components: happy-dom）
pnpm run check            # CIと同じ全工程（codegen→format→lint→typecheck→build→test→dry-run）
pnpm run codegen          # worker-configuration.d.ts と src/routeTree.gen.ts を生成
pnpm run typecheck        # tsc -b のみ
pnpm run lint             # oxlint
pnpm run format           # oxfmt（書き換え）
pnpm run db:generate      # drizzle-kit generate（schema.tsの差分からmigration生成）
pnpm run db:migrate:local # ローカルD1へmigration適用
```

CI（`.github/workflows/ci.yml`）はpull requestごとに`pnpm run check`を実行する。

## 構成

- `src/routes/` — TanStack Routerのファイルベースルート（`/`がTodos、`/dev/design-system`がコンポーネントギャラリー）
- `src/components/ui/` — shadcn/ui primitives
- `src/components/app/` — アプリ共通のcomposed components（AppHeader, ThemeProviderなど）
- `src/features/todos/` — Todos機能のコンポーネント・型
- `src/worker/` — Hono API（Cloudflare Worker）+ Drizzleスキーマ。`/api/*`のみがWorkerに届く
- `test/worker/` — Vitest（`@cloudflare/vitest-plugin`）によるAPI統合テスト
- `test/components/` — Vitest（happy-dom + Testing Library）によるコンポーネントテスト
- `docs/` — ドキュメント規約・design doc（[`docs/design/`](./docs/design/)）・設計判断の記録（ADR）・API仕様（[`docs/README.md`](./docs/README.md)参照）

D1は現時点でローカル開発のみ。本番デプロイ（実際のCloudflareアカウント上のD1作成含む）は未対応。
