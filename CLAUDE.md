# alcyone

React + TanStack Router + shadcn/ui（Tailwind CSS v4）を採用したフロントエンドと、
Hono + Drizzle ORM + Cloudflare D1 をCloudflare Workers上で動かすバックエンドを、
単一のVite開発サーバー（`@cloudflare/vite-plugin`）で同時に動かす構成。

## Tech Stack

| 分類 | 選択 |
|---|---|
| パッケージ管理 | pnpm（Node/pnpmのバージョンは`mise.toml`で固定） |
| フロントエンド | React 19 + TypeScript 7 strict + Vite（[ADR 0008](./docs/adr/0008-typescript-7.md)） |
| ルーティング | `@tanstack/react-router`（ファイルベース、`src/routes/`。TanStack Startは使わない） |
| UI | Tailwind CSS v4 + shadcn/ui（base: Base UI, style: nova, baseColor: neutral） |
| API | Hono（`src/worker/index.ts`）+ `@hono/zod-validator` + zod |
| クライアント | `hono/client`の`hc<AppType>`で型安全に呼び出す（`src/lib/api-client.ts`） |
| DB | Drizzle ORM (`drizzle-orm/d1`) + Cloudflare D1 |
| テスト | Vitest（`test.projects`で2分割）。`worker`= `@cloudflare/vitest-plugin`（D1込みの統合テスト）、`components`= happy-dom + Testing Library（[ADR 0009](./docs/adr/0009-component-tests-happy-dom.md)） |
| Lint / Format | `oxlint` + `oxfmt`（[ADR 0006](./docs/adr/0006-oxfmt-formatter.md)） |
| CI | GitHub Actions（`.github/workflows/ci.yml`で`pnpm run check`。[ADR 0007](./docs/adr/0007-ci-and-codegen.md)） |
| 認証 | Better Auth（メール+パスワード、D1をdrizzle adapter経由。[ADR 0013](./docs/adr/0013-better-auth.md)） |

D1は現時点でローカル開発のみ（`wrangler dev` + `wrangler d1 migrations apply --local`）。
`wrangler.jsonc`の`database_id`はプレースホルダで、実際のCloudflareアカウント上のD1は
まだ作成していない。本番デプロイ手順は今後追加する。

### よく使うコマンド

```bash
pnpm dev                  # Vite dev server（SPA + Hono Workerを同時に起動）
pnpm test                 # Vitest 両プロジェクト（worker / components）
pnpm run check            # CIと同じ全工程。コミット前にこれを通す
pnpm run codegen          # worker-configuration.d.ts と src/routeTree.gen.ts を生成
pnpm run typecheck        # tsc -b のみ
pnpm run lint             # oxlint（警告0が必須）
pnpm run format           # oxfmt（書き換え）。検証だけなら format:check
pnpm run db:generate      # drizzle-kit generate（schema.tsの差分からmigration生成）
pnpm run db:migrate:local # ローカルD1へmigration適用
```

`check`は `codegen → format:check → lint → tsc -b → vite build → vitest → wrangler deploy --dry-run` の順に走る。

`worker-configuration.d.ts`と`src/routeTree.gen.ts`はコミットしない生成物なので、
fresh cloneの直後や`wrangler.jsonc`のbindingsを変更したあとは`pnpm run codegen`を実行すること
（`pnpm dev`でも生成される）。

## Documentation

- このファイル（CLAUDE.md）は「今どう書くか」の運用ルール。過去の経緯・代替案の比較は書かない。
- 「何を作っていて、なぜその形にしたか」は[`docs/design/`](./docs/design/)にdesign doc（機能・サブシステム単位の生きたドキュメント）として書く。
- 「なぜそうしたか」という個々の設計判断の記録は[`docs/adr/`](./docs/adr/)（Architecture Decision Records）に置く。ライブラリの採用/見送り、アーキテクチャの方針、意図的なスコープ外の判断など、コード規約より大きい決定をしたときは、まずdesign doc/ADRを追加すること（[`docs/adr/README.md`](./docs/adr/README.md)参照）。
- APIの外部仕様は[`docs/api/`](./docs/api/)に記録する（現状は簡易表。OpenAPI導入を見送った経緯は[ADR 0005](./docs/adr/0005-defer-openapi.md)）。
- 規約全体の見取り図・使い分けは[`docs/README.md`](./docs/README.md)。

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

新しいコンポーネントを追加するときは `pnpm exec shadcn add <component>` を使う
（baseは`base-ui`、styleは`nova`のまま。`components.json`を参照）。

`pnpm dlx shadcn@latest`は使わない。`shadcn`はdevDependencyとしてバージョン固定されており、
`src/index.css`が`@import "shadcn/tailwind.css"`で同じパッケージを読んでいるため、
dlxだとCLIとCSSのバージョンがズレる。

### Component Layers

以下の責務を分ける。

```
src/lib
→ ドメインに依存しない共通処理（api-client, auth-client, mutate, utils）

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

**一覧の状態（絞り込み・並び替え）はURLのsearch paramsに置く。** コンポーネントのstateにしない。
リンクで共有でき、リロードでも残り、`loaderDeps`経由でloaderが再実行されるのでSQL側で絞れる
（クライアントが取得済みの行を隠すのではなく）。スキーマは`.default()`で「無い場合」を、
`.catch()`で「あるが不正な場合」を吸収する —— 後者は手でURLを書き換えたときに出る。

mutationは直接`apiClient`を叩かず、feature配下のラッパ（例: `src/features/todos/api.ts`）を
経由する。**そのラッパは必ず`src/lib/mutate.ts`の`mutate()`を通す。** `res.ok`の検査と失敗時の
`toast`はそこに1箇所だけあり、成功可否が`boolean`で返るので、呼び出し側は成功したときだけ
`router.invalidate()`する。エラーを握り潰さないこと。featureの中で`toast`を直接呼ばない。

loaderで`redirect()`や`notFound()`を投げるときは、**fetchのtry/catchの外で投げる**。
どちらもthrowで動くので、catchの中だと握り潰されて汎用エラー表示になる（実際に一度踏んだ）。

## API Conventions

リクエストの振り分けは`wrangler.jsonc`の`assets.run_worker_first`で決まる。
**`/api/*`だけがHono Workerに届き、それ以外はasset workerがSPAとして処理する**
（未知のパスは`index.html`にフォールバックし、TanStack Routerがクライアント側で描画する）。
APIのパスは必ず`/api/`配下に置くこと。

画面は `/`（Project一覧）、`/projects/$projectId`（そのProjectのTodo一覧）、`/dev/design-system`。
動的ルートはフラットなファイル名で置く（`src/routes/projects.$projectId.tsx`）。
存在しないリソースはloaderで`notFound()`を投げる。**`notFound()`はthrowで動くので、
fetchのtry/catchの中で投げると握り潰される** —— catchの外で投げること。

`src/worker/index.ts`のルールは以下。

- チェーン形式（`new Hono().get().post()...`）を崩さない。`hc<AppType>`の型推論がこれに依存している。
- バリデーションは`zValidator`を直接使わず、`src/worker/validator.ts`の`validate()`を使う。
  失敗時のレスポンスが`{ error: "Bad Request", issues }`に固定される。
- **DBアクセスは`src/worker/db/repo.ts`の`createRepo()`を経由する。** ハンドラ内で
  `drizzle()`を呼ばない。将来オーナー列を入れるとき、絞り込みの`where`を足す場所が1箇所で済む
  （散らばっていると付け忘れが型エラーにもテスト失敗にもならず、そのまま越境漏洩になる）。
- **repoのメソッドを`async`にしない。`.all()` / `.get()`も呼ばない。** 未実行のdrizzleビルダーを
  返すことで、`await`もできるし`batch()`の要素にもできる。`async`にすると前者だけになり、
  後者が黙って壊れる。
- **複数文を原子的に実行したいときは`repo.batch([...])`。** D1に対話的トランザクションは無く、
  `db.transaction()`は型が通るのに実行時に落ちる。
- **ユーザーのいない処理（cron等）は`createRepo`を使わない。** あれは`ownerId`で必ず絞るためのもの。
  ユーザーを持たないクエリは`src/worker/db/maintenance.ts`に置く（名前で区別が付くようにしてある）。
- エラーレスポンスは`{ error: string }`で揃える（404は`{ error: "Not found" }`、
  未捕捉例外は`onError`が`{ error: "Internal Server Error" }`を返す）。例外の内容はクライアントに返さない。
- ログは`console.error(JSON.stringify({ ... }))`のように構造化JSONで出す
  （Workersのobservabilityでフィールド検索できるようにするため）。
- ルートを追加・変更したら[`docs/api/README.md`](./docs/api/)の表も更新する。
- **`/api/*` はすべて認証が必要**（例外は `/api/health` と `/api/auth/*`）。未認証は401。
  セッション検証とリポジトリ生成は`src/worker/index.ts`の1つのミドルウェアがやる。
- **DBアクセスは`createRepo(binding, ownerId)`経由で、返るメソッドは全て所有者でスコープ済み。**
  ハンドラがスコープされていないクエリを受け取ることがないので、絞り込みを忘れられない。
  ここに新しいメソッドを足すときは、必ず`ownerId`で絞ること（[ADR 0014](./docs/adr/0014-user-owned-projects.md)）。
- **読み取りは`deletedAt IS NULL`でも絞る。** Project/Todoは論理削除で、忘れると削除済みの行が
  見える（型エラーにもテスト失敗にもならない）。物理削除するのは退会時の`purgeOwnedData()`だけ
  （[ADR 0015](./docs/adr/0015-soft-delete-items-hard-delete-accounts.md)）。
- **論理削除はUndoとセットで出す**（`src/lib/undo-toast.ts`）。復元手段が無い論理削除は、
  ユーザーから見ればただの削除で、隠し列を増やしただけになる。
- Better AuthはOriginヘッダを検証する。**curlでAPIを叩くときは`Origin`ヘッダが必要**（無いと403）。

## Testing

`vitest.config.ts`は`test.projects`で2つに分かれている。テストを足す場所を間違えると、
別のランタイムで実行されて意味不明な失敗になるので注意すること。

| プロジェクト | 置き場所 | 環境 | 対象 |
|---|---|---|---|
| `worker` | `test/worker/*.test.ts` | workerd + ローカルD1 | Hono APIを`app.request()`で直接叩く統合テスト |
| `components` | `test/components/*.test.tsx` | happy-dom + Testing Library | Reactコンポーネント |
| E2E | `test/e2e/*.spec.ts` | Playwright + 実ブラウザ | 上2つの**隙間**（ログイン→セッション→所有スコープ） |

E2Eは`pnpm run test:e2e`（`check`にも含まれる）。専用DB（`.wrangler/e2e-state`）で毎回空から
起動するので、**devサーバが5173で動いていると失敗する**（開発用DBを守るための意図的な挙動）。

```bash
pnpm test                      # 両方
pnpm test --project components # コンポーネントのみ
pnpm test --project worker     # APIのみ
```

コンポーネントテストの方針:

- `globals: false`なので`describe` / `it` / `expect` / `vi`は`vitest`から明示的にimportする。
- クエリは**ユーザーから見えるもの**で書く（`getByRole` / `getByLabelText` / `getByText`）。
  `data-testid`やクラス名に依存しない。必要なaria-labelが無いならコンポーネント側に足す。
- レイアウトやCSSカスケードに対するアサーションは書かない（happy-domの再現度に依存するため）。
- Base UIのfloating系（DropdownMenu等）は開いてから`findByRole("menu")`で待つ。
- ルートレベルの`test`オプションはプロジェクトに継承されない。設定は必ずプロジェクト側に書く。

## Not Yet

以下は初期スコープに含めない。

**各項目をなぜ後回しにしているか、いつ着手すべきか（トリガー）は
[`docs/design/service-readiness-map.md`](./docs/design/service-readiness-map.md)にある。**
ここは一覧だけを持ち、理由は二重管理しない。alcyoneの位置づけそのものは
[ADR 0010](./docs/adr/0010-alcyone-as-proving-ground.md)。

- TanStack Query
- Turborepo
- Alchemy
- R2 / KV / Queues
- Storybook
- テストカバレッジの計測
- メール送信（そのためメール検証とパスワード再発行は無効）
- 組織単位のテナンシー（Projectはユーザー所有）
- ゴミ箱UI（復元できるのは削除直後のtoastからだけ。30日で自動削除される）
- 実際のCloudflareアカウントへのD1作成・本番デプロイ
