# API

OpenAPI仕様書は現時点では生成していない（経緯は[ADR 0005](../adr/0005-defer-openapi.md)）。ここにあるのは人が読むための簡易な参照であり、**型としての一次情報は[`src/lib/api-client.ts`](../../src/lib/api-client.ts)（`hc<AppType>`）と[`src/worker/index.ts`](../../src/worker/index.ts)そのもの**。この表と実装がずれていないか、実装を変更したPRの中でセルフチェックすること。

## リクエストの振り分け

`wrangler.jsonc`の`assets.run_worker_first`が`["/api/*"]`なので、**Workerに届くのは`/api/*`だけ**。
それ以外のパスはasset workerが処理し、該当するファイルが無ければ`index.html`にフォールバックして
TanStack Routerがクライアント側で描画する（存在しない画面は`__root.tsx`の`notFoundComponent`）。
新しいエンドポイントは必ず`/api/`配下に置くこと。

**`/api/health` と `/api/auth/*` を除く全エンドポイントはセッションを要求する**（無ければ401）。
また Better Auth が Origin ヘッダを検証するので、**curlで叩くときは `-H "Origin: <origin>"` が必要**。

課金・上限の観点で1つ注意がある。**`/api/*`に一致したリクエストはWorker invocationとして数えられる**
（静的アセットへのリクエストは無料・無制限で、invocationに数えられない）。無料プランでは日次上限を
超えるとアセットへフォールバックせず**429を返す**。エンドポイントを`/api/`配下に置くという規約は、
課金対象の境界をそのまま決めていることになる。

## エンドポイント一覧

すべて`src/worker/index.ts`で定義。

| Method | Path | 概要 | Request body | 200系レスポンス | エラー |
|---|---|---|---|---|---|
| GET | `/api/health` | ヘルスチェック（**認証不要**） | — | `{ ok: true }` | — |
| * | `/api/auth/*` | Better Auth（サインアップ/イン/アウト等） | — | — | `403` Origin不正 |
| GET | `/api/projects` | Project一覧（id昇順） | — | `Project[]` | — |
| POST | `/api/projects` | Project作成 | `{ name: string }`（1〜100文字） | `201` `Project` | `400` |
| DELETE | `/api/projects/:projectId` | Project削除（**論理削除**。配下のTodoも同時に） | — | `204` (body無し) | `400`, `404` |
| POST | `/api/projects/:projectId/restore` | Projectの復元（配下のTodoも同時に） | — | `200` `Project` | `400`, `404` |
| GET | `/api/projects/:projectId/todos` | そのProjectのTodo一覧（id昇順） | — | `{ project, todos }` | `400`, `404` |
| POST | `/api/projects/:projectId/todos` | Todo作成 | `{ title: string }`（1〜200文字） | `201` `Todo` | `400`, `404` |
| PATCH | `/api/todos/:id` | 完了状態の更新 | `{ completed: boolean }` | `200` `Todo` | `400`, `404` |
| DELETE | `/api/todos/:id` | Todo削除（**論理削除**） | — | `204` (body無し) | `400`, `404` |
| POST | `/api/todos/:id/restore` | Todoの復元 | — | `200` `Todo` | `400`, `404` |

Todo一覧が裸の配列ではなく`{ project, todos }`を返すのは、画面のタイトルに使うProject情報を
2回目のリクエスト無しで得るためと、将来カーソルを足すときに破壊的変更にしないため。

`PATCH` / `DELETE /api/todos/:id` にprojectIdを含めていないのは、含めるとサーバ側で
「そのTodoが本当にそのProjectのものか」を追加クエリで検証するか、黙って無視するかの二択になるため。
無視されるパスセグメントは、無いより悪い。

Project削除は`ON DELETE CASCADE`ではなく、子を先に消す2文を`batch()`で実行している
（[ADR 0012](../adr/0012-no-on-delete-cascade.md)）。

`Todo` / `Project` の型は`src/worker/db/schema.ts`から`drizzle-orm`が推論する。

- `Todo`: `{ id: number, title: string, completed: boolean, createdAt: string, updatedAt: string, projectId: number }`
- `Project`: `{ id: number, name: string, createdAt: string, ownerId: string, deletedAt: string | null }`

`deletedAt` が非nullの行は論理削除済みで、一覧にも取得にも現れない
（[ADR 0015](../adr/0015-soft-delete-items-hard-delete-accounts.md)）。アカウント削除
（`POST /api/auth/delete-user`）だけは論理削除済みの行も含めて物理的に消す。

**時刻はISO-8601（`2026-08-23T12:44:13.000Z`）でアプリ側が生成する。** DBのデフォルトは使わない
（SQLiteの`current_timestamp`はISO-8601ではなく、`new Date()`がローカル時刻として誤読する）。
経緯は[ADR 0011](../adr/0011-expand-contract-migrations.md)。

## エラーレスポンス

エラーは全て`{ error: string }`を含むJSONで返す。例外の内容はクライアントに返さない。

| Status | Body | いつ返るか |
|---|---|---|
| `400` | `{ error: "Bad Request", issues: ZodIssue[] }` | バリデーション失敗。形状は`src/worker/validator.ts`の`validate()`が固定する |
| `404` | `{ error: "Not found" }` | 該当IDが無い / `/api/*`配下の未定義パス |
| `401` | `{ error: "Unauthorized" }` | セッションが無い。`/api/health` と `/api/auth/*` 以外の全 `/api/*` |
| `500` | `{ error: "Internal Server Error" }` | 未捕捉例外。`app.onError`が構造化JSONログを出したうえで返す |

## 本格的なOpenAPI導入を検討するタイミング

以下のいずれかに該当したら、[ADR 0005](../adr/0005-defer-openapi.md)を再検討し、`@hono/zod-openapi`導入の新しいADRを追加する。

- このリポジトリ外の第三者・別チームがAPIを利用するようになった
- エンドポイント数が増え、この表の手動同期が現実的でなくなった
- Swagger UI / Scalarなどインタラクティブなドキュメントを外部公開する要件が生じた
