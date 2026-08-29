# alcyone

Cloudflare Workers上のスタックで実サービスを運営するのに何が要るかを確かめる検証台。
題材としてタスク管理ツールを作っている。設計の全体像は
[`docs/design/overview.md`](./docs/design/overview.md)。

このファイルは**コードをどう書くか**を答える。何をなぜ作っているかは書かない。

## Tech Stack

| 分類 | 選択 |
|---|---|
| パッケージ管理 | pnpm（Node/pnpmのバージョンは`mise.toml`で固定） |
| フロントエンド | React 19 + TypeScript 7 strict + Vite |
| ルーティング | `@tanstack/react-router`（ファイルベース、`src/routes/`。TanStack Startは使わない） |
| UI | Tailwind CSS v4 + shadcn/ui（base: Base UI, style: nova, baseColor: neutral） |
| API | Hono（`src/worker/index.ts`）+ `@hono/zod-validator` + zod |
| クライアント | `hono/client`の`hc<AppType>`で型安全に呼ぶ（`src/lib/api-client.ts`） |
| DB | Drizzle ORM (`drizzle-orm/d1`) + Cloudflare D1 |
| 認証 | Better Auth（メール+パスワード、D1をdrizzle adapter経由） |
| テスト | Vitest（`test.projects`で2分割）+ Playwright |
| Lint / Format | `oxlint` + `oxfmt` |
| CI | GitHub Actions（`.github/workflows/ci.yml`で`pnpm run check`） |

### よく使うコマンド

```bash
pnpm dev                  # Vite dev server（SPA + Hono Workerを同時に起動。ポートは5173固定）
pnpm test                 # Vitest 両プロジェクト（worker / components）
pnpm run test:e2e         # Playwright（専用DBでdevサーバを起動）
pnpm run check            # CIと同じ全工程。コミット前にこれを通す
pnpm run codegen          # worker-configuration.d.ts と src/routeTree.gen.ts を生成
pnpm run typecheck        # tsc -b のみ
pnpm run lint             # oxlint（警告0が必須）
pnpm run format           # oxfmt（書き換え）。検証だけなら format:check
pnpm run db:generate      # drizzle-kit generate（schema.tsの差分からmigration生成）
pnpm run db:migrate:local # ローカルD1へmigration適用
pnpm run seed:accounts    # ローカル開発用のアカウント（docs/dev-accounts.md）
pnpm run preflight        # wrangler.jsoncが実リソースを指しているか（deployの前段）
pnpm run deploy           # preflight → check → リモートmigration → deploy（未実施）
```

`check`は `codegen → format:check → lint → tsc -b → vite build → vitest → test:e2e → wrangler deploy --dry-run` の順に走る。

`worker-configuration.d.ts`と`src/routeTree.gen.ts`はコミットしない生成物なので、
fresh cloneの直後や`wrangler.jsonc`のbindingsを変更したあとは`pnpm run codegen`を実行すること
（`pnpm dev`でも生成される）。

---

# 壊してはいけないもの

**ここに挙げたものは、間違えても型エラーにもテスト失敗にもならず、そのまま出荷される。**
以降の「日々の書き方」より先に読むこと。

## 権限とスコープ

- **DBアクセスは`src/worker/db/repo.ts`の`createRepo(binding, ownerId, role)`を経由する。**
  ハンドラ内で`drizzle()`を呼ばない。返るメソッドは全てスコープ済みなので、絞り込みを忘れられない。
  ここに新しいメソッドを足すときは、必ずスコープすること。
- **アクセス範囲は`accessibleProjectIds()`、管理権限は`ownedProjectIds()`の2つだけ。**
  **タスクを触るのが前者、プロジェクトを消す・共有する・参加者を変えるのが後者。**
  混ぜると参加者が鍵を配れるようになる。
- **権限は文の一部にする。** 所属の検査はinsert-from-selectの`WHERE`に入れる。
  **外部キーは「行が存在すること」を検査するのであって「呼び出し元のものであること」ではない。**
  他人のidを渡した書き込みは、外部キーを満たしたまま成立する。
- **権限や人数の条件はWHEREに入れて1文にする。** 「最後のオーナーは降格できない」を
  「数える→更新する」の2文にすると、最後の2人が同時に互いを降格できる隙間ができる。
- **ロールは`owner` / `admin` / `member`の3段階で、`USER_ROLES`の配列順が強さ。**
  管理者はオーナーに手を出せず、最後のオーナーは降ろせない。
  **`owner`はインスタンスのオーナーで、プロジェクトの作成者（`projects.ownerId`）とは別物。**
- **プロジェクトを作れるのは`admin`以上。** 拒むのは`projects.create`（ハンドラではない）。
  **作成者は降格しても自分が作ったプロジェクトを管理し続ける。**
- **ロールはBetter Authの`additionalFields`として宣言する（`input: false`付き）。**
  宣言しないとBetter Authが知らないフィールドを落とすので、`databaseHooks`が返した値も
  保存されない。`input: false`があるのでサインアップにも`update-user`にも渡せない。
- **ユーザーのいない処理（cron等）は`createRepo`を使わない。** あれは`ownerId`で必ず絞るためのもの。
  ユーザーを持たないクエリは`src/worker/db/maintenance.ts`に置く。

## 画面の可視性

- **「誰がどの画面を見られるか」は`src/components/app/access-gate.tsx`の1箇所で、描画時に決まる。**
  ルートに`beforeLoad`のガードを書かない ——**`beforeLoad`は遷移のときにしか走らず、
  サインアウトは遷移ではない**ので効かない。
- 各ルートは`staticData: { access: "public" | "user" | "admin" }`を宣言する。**書き忘れは`user`**。
  公開は`/login`と`/s/$token`だけで、その一覧は`test/components/access.test.ts`が固定する。
- **`StaticDataRouteOption`をモジュール拡張しない。** router-coreが宣言してreact-routerが
  再エクスポートしているので、後者を拡張すると再エクスポートを隠して**ルート全体の型推論が壊れる**
  （`useLoaderData()`が`any`になる）。`readAccess(unknown)`で読む。
- **セッションを終える出口は`endSession()`の1つだけ。** `signOut()`のあと
  **ハードナビゲーション**で`/login`へ。`redirect`パラメータは付けない。退会も同じ。
- **ローダーの401リダイレクトは残す。** ゲートは「手元にセッションが無い」、401は
  「手元のセッションがもう無効」——別の信号。

## D1の制約

- **複数文を原子的に実行したいときは`repo.batch([...])`。** 対話的トランザクションは無く、
  `db.transaction()`は型が通るのに実行時に落ちる。
- **`repo`のメソッドを`async`にしない。`.all()` / `.get()`も呼ばない。** 未実行のdrizzleビルダーを
  返すことで、`await`もできるし`batch()`の要素にもできる。`async`にすると後者が黙って壊れる。
- **`db.run(sql)` / `db.all(sql)`はbatchに入れられない。** 生SQLを混ぜると実行時に
  「cannot read properties of undefined」で落ちる。insert-from-selectはdrizzleのビルダーで書く。
- **`meta.changes`を信用しない。** トリガーの書き込みも数えられ、`batch()`の中では文ごとに
  割り当てられてすらいない。件数が要るときは`.returning()`して行を数える。
- **読み取りは`deletedAt IS NULL`でも絞る。** Project/Todoは論理削除で、忘れると削除済みの行が
  見える（型エラーにもテスト失敗にもならない）。物理削除するのは退会時の`purgeOwnedData()`だけ。
- **論理削除はUndoとセットで出す**（`src/lib/undo-toast.ts`）。復元手段の無い論理削除は、
  ユーザーから見ればただの削除である。
- **自己参照する外部キー（`todos.parentId`）を持つ行を物理削除するときは、先に切り離す。**
  SQLiteは外部キーを行ごとに検査するので、親を子より先に消す削除は失敗する。
  保持期限のパージ・退会・テストの`resetAll`の3経路すべてが対象。
- **`user`と`projects`のテーブルは作り直さない。** 前者は`session`と`account`が
  `ON DELETE CASCADE`で参照しているので全セッションと全資格情報が消え、後者は4つのテーブルから
  参照されているので最初の子行で失敗する。値域の制約が要るならCHECKではなくトリガー。

## 個人情報

- **リクエストボディとヘッダをログに出さない。** 一度Workers Logsに入ったPIIは保持期間内は
  消せない（`docs/pii.md`と`test/worker/request-id.test.ts`）。
- ログは`console.error(JSON.stringify({ ... }))`のように構造化JSONで出し、**必ず`requestId`を含める**。
- 例外の内容はクライアントに返さない（`onError`が`{ error: "Internal Server Error" }`を返す）。

---

# 日々の書き方

## API Conventions

リクエストの振り分けは`wrangler.jsonc`の`assets.run_worker_first`で決まる。
**`/api/*`だけがHono Workerに届き**、それ以外はasset workerがSPAとして処理する。
APIのパスは必ず`/api/`配下に置くこと。

- チェーン形式（`new Hono().get().post()...`）を崩さない。`hc<AppType>`の型推論がこれに依存している。
- バリデーションは`zValidator`を直接使わず、`src/worker/validator.ts`の`validate()`を使う。
  失敗時のレスポンスが`{ error: "Bad Request", issues }`に固定される。
- **エラーレスポンスは`{ error: string }`で揃える。** 権限が無い要求への答えは常に
  `404 { error: "Not found" }` ——「存在しない」と「あなたのものではない」を書き分けると、
  書き分けそのものが情報になる。
- **`/api/*` はすべて認証が必要**（例外は `/api/health` と `/api/auth/*`）。未認証は401。
  セッション検証とリポジトリ生成は`src/worker/index.ts`の1つのミドルウェアがやる。
- **レート制限は`src/worker/rate-limit.ts`の`enforce()`を通す。** 認証系はIP単位、認証済みの
  重い処理はユーザー単位。**location単位かつ結果整合で、正確な計上には使えない。**
- **変更履歴は「記録してから変更する」を1つのbatchに載せる。** 履歴の挿入が先——UPDATEが走ると
  古い値が存在しなくなる。比較は`INSERT ... SELECT`の`WHERE`に入れ、**ハンドラで読んでから
  差分を取らない**。**`<>`ではなく`is not`を使う**——SQLの不等号はNULLを伝播するので、
  `<>`だと日付を設定/解除した履歴だけが静かに欠落する。
- **`todo_events`は追記専用。** 更新も削除もするコードを書かない（退会時の物理削除を除く）。
- **1回の保存で書いた履歴行には同じ`revisionId`を与える。** 詳細フォームは毎回全項目を送るので、
  これが無いと1つの操作が複数の出来事に見える。idは`crypto.randomUUID()`で作り、
  **タイムスタンプで代用しない**。
- **人の名前はSQLで解決する。** コメントや履歴に名前を出すとき、クライアントで
  「サインイン中の人の名前」を使わない。**偶然一致しているだけの規則は、一致しなくなった日に
  静かに壊れる。**
- **Todoの更新は`PATCH /api/todos/:id`の1本だけ。** **省略は「変えない」、`null`は「空にする」**
  ——同じ扱いにすると「期限を外す」が表現できない。zodの`.transform()`が`undefined`を畳むことに注意。
- **行の`status`と一覧の絞り込みを同じ型にしない。** `all` / `active` はstatusではなく
  「statusを名指ししない方法」で、`active`は「`done`以外」。型も`TodoStatus` / `TodoFilter`で分ける。
- **ラベルはプロジェクトに属し、タスクを触れる人なら誰でも作れる。** 付与は
  `PUT /api/todos/:id/labels`で**集合の置き換え**（差分ではない）。
- **暦日（`startAt` / `dueAt`）の計算はUTCで閉じる。** `new Date(y, m, d)`と`toLocaleDateString`を
  使わない ——ローカル変換はグリニッジより西の利用者にだけ日付を1日ずらし、**作った側には見えない**。
- **R2のオブジェクトはDBの外で、順序は経路によって逆になる。** アップロードは所有権チェックの
  あとに書く。**添付を1つ消すときは行が先**（先にオブジェクトを消して失敗すると、実体の無い行が
  残る）。**退会のときはオブジェクトが先**で同期で消す——「消えました」は応答時点で真である
  必要があり、残った行は直せるが残ったオブジェクトは見えない。
- Better AuthはOriginヘッダを検証する。**curlでAPIを叩くときは`Origin`ヘッダが必要**（無いと403）。
- ルートを追加・変更したら[`docs/api/README.md`](./docs/api/)の表も更新する。

## Data Fetching

TanStack Queryは使わない。データ取得はTanStack Routerの`loader`を使い、
mutation後は`router.invalidate()`で再取得する。

**一覧の状態（絞り込み・並び替え・表示の種類）はURLのsearch paramsに置く。**
コンポーネントのstateにしない。リンクで共有でき、リロードでも残り、`loaderDeps`経由で
loaderが再実行されるのでSQL側で絞れる（クライアントが取得済みの行を隠すのではなく）。
スキーマは`.default()`で「無い場合」を、`.catch()`で「あるが不正な場合」を吸収する。

**プロジェクトは「どの画面か」ではなく「どの文脈か」。** 選択はヘッダーの切り替えに置き、
サイドバーは開いているプロジェクトで**できること**だけを並べる。プロジェクト間の移動では
search paramsを引き継がない——絞り込みは離れる側のもので、持ち込むと移った先で黙って行が消える。

mutationは直接`apiClient`を叩かず、feature配下のラッパ（例: `src/features/todos/api.ts`）を
経由する。**そのラッパは必ず`src/lib/mutate.ts`の`mutate()`を通す。** `res.ok`の検査と失敗時の
`toast`はそこに1箇所だけあり、成功可否が`boolean`で返るので、呼び出し側は成功したときだけ
`router.invalidate()`する。エラーを握り潰さないこと。featureの中で`toast`を直接呼ばない。
作成したものの中身が要るときは`mutateFor<T>()`。

loaderで`redirect()`や`notFound()`を投げるときは、**fetchのtry/catchの外で投げる**。
どちらもthrowで動くので、catchの中だと握り潰されて汎用エラー表示になる。

**セッションをReactの再レンダリングの条件に使うときは`useAuth()`から読む。**
`Route.useRouteContext()`はmatchesが再解決されたときにしか更新されないので、
「セッションが後から届いたら何かを始める」用途では**初回ロードで永久に発火しない**。

動的ルートはフラットなファイル名で置く（`src/routes/projects.$projectId.tsx`）。
存在しないリソースはloaderで`notFound()`を投げる。画面の一覧と役割は
[`docs/design/overview.md`](./docs/design/overview.md)。

## UI / Design System

shadcn/ui + Tailwind CSSをUI基盤として使用する。

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

## Testing

`vitest.config.ts`は`test.projects`で2つに分かれている。テストを足す場所を間違えると、
別のランタイムで実行されて意味不明な失敗になるので注意すること。

| プロジェクト | 置き場所 | 環境 | 対象 |
|---|---|---|---|
| `worker` | `test/worker/*.test.ts` | workerd + ローカルD1 | Hono APIを`app.request()`で直接叩く統合テスト |
| `components` | `test/components/*.test.tsx` | happy-dom + Testing Library | Reactコンポーネント |
| E2E | `test/e2e/*.spec.ts` | Playwright + 実ブラウザ | 上2つの**隙間**（ログイン→セッション→所有スコープ） |

```bash
pnpm test                      # 両方
pnpm test --project components # コンポーネントのみ
pnpm test --project worker     # APIのみ
```

### アカウントとスコープ

**最初のアカウントはオーナーになるので、テストは必ずそれを先に用意する。**
（ヘルパの名前は`seedAdmin` / `ADMIN_EMAIL`だが、作られるのは`owner`である。
`signUpAdmin()`だけが`admin`を作る。）worker側は`resetAll()`が1行シードし（ブートストラップ自体を試すときだけ`resetAll({ seedAdmin: false })`）、
E2E側は`globalSetup`のwarm-upが`ADMIN_EMAIL`で作る。用意し忘れると、そのファイルが最初に
サインアップしたユーザーが全権限を持ち、**所有スコープのテストが何も証明せずに緑になる**。

**プロジェクトを作るテストは`signUpAdmin()`を使う。** `signUp()`を既定で管理者にしない ——
全テストの主役が強くなり、同じ理由でスコープのテストが証明しなくなる。

**分離を確かめるときは観測者を一般ユーザーにする。** 管理者は全プロジェクトが見えるので、
管理者を観測者にした「見えないこと」のテストは何も証明しない。

### E2E

`pnpm run test:e2e`（`check`にも含まれる）。専用DB（`.wrangler/e2e-state`）で毎回空から
起動するので、**devサーバが5173で動いていると失敗する**（開発用DBを守るための意図的な挙動）。

- **各テストのIPアドレスはテスト名のハッシュから引く**（`test/e2e/fixtures.ts`）。
  `/api/auth/*`はIP単位で1分10回に絞られ、**`get-session`もその1回に数えられる**。
  同じアドレスを共有すると認証のレート制限にまとめて当たり、症状は
  「後続のspecが軒並み落ちる」——テストの側ではなくアプリの側が壊れたように見える。
  **429は未ログインと見分けが付かない。**
- **Playwrightは、ロケータが2つ以上の要素に一致すると即座に失敗する**（strict mode）。
  待ち直さないので、「一致が2つある」状態は再試行では解決しない。以下はすべてその回避。
- **プロジェクト名はスイート全体で一意にし、前方一致もさせない。** 管理者は全プロジェクトが
  見え、DBは1回の実行で共有されるので、同じ名前を2つのテストが使うと一覧に両方出て、
  その名前を指すロケータが全部strict mode違反になる。`getByRole`の`name`は**部分一致**なので、
  `Schedule`は`Schedule 2`にも当たる。
- **同じ画面に同じ名前のコントロールを2つ置かない。** `form`に`aria-label`を付けるときは
  **中のフィールドと同じ文字列にしない**（両方が同じ名前で引っかかる）。
- **ダイアログを閉じたら、オーバーレイが消えるまで待つ。** オーバーレイはダイアログより
  1アニメーション長く残り、その間は次のクリックを飲み込む。
- **複数一致しうる要素の不在は`toHaveCount(0)`で確かめる。** `toBeHidden()`は複数一致を
  strict mode違反として**即座に失敗**するので、再描画の途中で落ちる。
- **他のコマンドを同時に走らせない。** 並行させると実行時間が数十倍になり、
  アプリのバグに見える失敗が出る。

### コンポーネントテスト

- `globals: false`なので`describe` / `it` / `expect` / `vi`は`vitest`から明示的にimportする。
- クエリは**ユーザーから見えるもの**で書く（`getByRole` / `getByLabelText` / `getByText`）。
  `data-testid`やクラス名に依存しない。必要なaria-labelが無いならコンポーネント側に足す。
- レイアウトやCSSカスケードに対するアサーションは書かない（happy-domの再現度に依存するため）。
- Base UIのfloating系（DropdownMenu等）は開いてから`findByRole("menu")`で待つ。
- ルートレベルの`test`オプションはプロジェクトに継承されない。設定は必ずプロジェクト側に書く。
- ルートツリーに触るテストは`import type {} from "@/main"`で**ルーターの`Register`宣言を
  取り込む**。無いと、そのプロジェクトのルート型が総崩れになり、
  無関係な十数ファイルが「implicitly any」で落ちる。

### 各プリミティブ

- キューのテストは`createMessageBatch()`でハンドラを直接呼ぶ。**`queue.send()`は
  vitest環境で消費側を駆動しない**ので、送って待つテストは何も起きないまま合格するか、
  時間切れになる。
- Workflowのテストは`introspectWorkflowInstance()`。`mockStepError`で狙ったステップだけ
  失敗させ、`disableRetryDelays`でバックオフを飛ばす。
- Durable Objectのテストは`cloudflare:test`の`runInDurableObject`で中を覗く。
  `waitUntil`に載せた処理を検証するときは`createExecutionContext()`を渡し、
  アサーションの前に`waitOnExecutionContext(ctx)`で待つ。
- マイグレーションの後埋めをテストするときは、**SQLをファイルから読んで実行する**
  （`?raw`）。書き写すと、出荷されているSQLが間違っていてもテストは通る。

## `/dev/design-system`

`src/routes/dev.design-system.tsx` はコンポーネントギャラリー。
shadcn/uiコンポーネントを追加・変更したら、ここに使用例を追加してLight/Dark・
レスポンシブを確認する運用にする（Storybookは使わない）。

## まだやらないこと

一覧と、それぞれの理由・設計上の制約は
[`docs/design/overview.md`](./docs/design/overview.md)にある。
