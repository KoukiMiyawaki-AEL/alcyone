# alcyone

**Cloudflare Workers上のスタックで実際にサービスを運営するなら何が要るのかを、
動くもので確かめるための検証台。** 題材としてタスク管理ツールを作っているが、
タスク管理ツールが目的ではない。

React + TanStack Router + shadcn/ui（Tailwind CSS v4）+ Hono + Drizzle ORM + Cloudflare D1 を、
単一のVite開発サーバー（`@cloudflare/vite-plugin`）で動かす。

## どこを読むか

| 知りたいこと | 読む場所 |
|---|---|
| 何を作っていて、どういう原則で動くか | [`docs/design/overview.md`](./docs/design/overview.md) |
| コードをどう書くか、何を壊してはいけないか | [`CLAUDE.md`](./CLAUDE.md) |
| APIの外部仕様 | [`docs/api/README.md`](./docs/api/README.md) |
| 文書の種類と更新の規則 | [`docs/README.md`](./docs/README.md) |

## セットアップ

Node / pnpmのバージョンは `mise.toml` で固定している（[mise](https://mise.jdx.dev/) 推奨）。

```bash
pnpm install

# 生成物（worker-configuration.d.ts / src/routeTree.gen.ts）はコミットしていないので、
# clone直後は必ず実行する。これが無いと型チェックが通らない。
# .dev.vars が無ければ .dev.vars.example から作られるので、BETTER_AUTH_SECRET を設定する
pnpm run codegen

# ローカルD1にmigrationを適用（初回のみ / schema.tsを変更したら再実行）
pnpm run db:migrate:local

# E2E用のブラウザ（初回のみ）
pnpm exec playwright install chromium

pnpm dev
```

画面を触るためのアカウントは [`docs/dev-accounts.md`](./docs/dev-accounts.md) を参照
（`pnpm run seed:accounts` でオーナー・管理者・一般ユーザーが用意される）。

コマンドの一覧は [`CLAUDE.md`](./CLAUDE.md) にある。
CI（`.github/workflows/ci.yml`）はpull requestごとに `pnpm run check` を実行する。

## ディレクトリ

```
src/routes/         TanStack Routerのファイルベースルート
src/components/ui/  shadcn/ui primitives（生成物）
src/components/app/ アプリ共通のcomposed components
src/features/       ドメインごとのコンポーネント・型・APIラッパ
src/lib/            api-client / auth-client / mutate / utils
src/worker/         Hono API（Cloudflare Worker）。DBアクセスは db/repo.ts の1箇所を通る
drizzle/            マイグレーション
test/worker/        API統合テスト（workerd + ローカルD1）
test/components/    コンポーネントテスト（happy-dom + Testing Library）
test/e2e/           Playwright。上2つの隙間を通しで検証
docs/               設計文書と規約
```
