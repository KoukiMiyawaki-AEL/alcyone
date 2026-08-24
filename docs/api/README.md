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
| GET | `/api/projects` | Project一覧（id昇順） | クエリ: `cursor`、`limit`（1〜100、既定50） | `{ items: Project[], nextCursor }` | `400` |
| POST | `/api/projects` | Project作成 | `{ name: string }`（1〜100文字） | `201` `Project` | `400` |
| DELETE | `/api/projects/:projectId` | Project削除（**論理削除**。配下のTodoも同時に） | — | `204` (body無し) | `400`, `404` |
| POST | `/api/projects/:projectId/restore` | Projectの復元（配下のTodoも同時に） | — | `200` `Project` | `400`, `404` |
| GET | `/api/projects/:projectId/todos` | そのProjectのTodo一覧 | クエリ: `status`=`all`\|`active`\|`done`、`sort`=`created`\|`due`\|`priority` | `{ project, todos }` | `400`, `404` |
| POST | `/api/projects/:projectId/todos` | Todo作成 | `{ title: string }`（1〜200文字） | `201` `Todo` | `400`, `404` |
| PATCH | `/api/todos/:id` | 完了状態の更新 | `{ completed: boolean }` | `200` `Todo` | `400`, `404` |
| PATCH | `/api/todos/:id/details` | 期限・優先度の更新 | `{ dueAt?: string\|null, priority?: 0-3 }` | `200` `Todo` | `400`, `404` |
| GET | `/api/todos/:id/attachments` | 添付一覧 | — | `Attachment[]` | `400`, `404` |
| POST | `/api/todos/:id/attachments` | 添付の追加（multipart、フィールド名`file`、5MBまで） | multipart | `201` `Attachment` | `400`, `404`, `413` |
| GET | `/api/attachments/:id` | 添付のダウンロード | — | ファイル本体 | `400`, `404` |
| DELETE | `/api/attachments/:id` | 添付の削除（R2のオブジェクトも消す） | — | `204` (body無し) | `400`, `404` |
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

- `Todo`: `{ id, title, completed, createdAt, updatedAt, projectId, dueAt: string|null, priority: 0-3, deletedAt: string|null }`
- `Project`: `{ id: number, name: string, createdAt: string, ownerId: string, deletedAt: string | null }`

一覧は**キーセットページネーション**。`nextCursor`が非nullなら次のページがあり、そのまま
`cursor`に渡す。カーソルは不透明な文字列で、中身に依存しないこと。壊れた・古いカーソルは
エラーにせず先頭から返す（カーソルは位置であって命令ではない）。

オフセットではなくキーセットなのは、`OFFSET`が読み飛ばす行もスキャン対象になり、
**D1がスキャン行数で課金する**ため —— オフセットだと後ろのページほど高くなる。

並び順は常に`id`をタイブレークに含める。含めないと同じ期限・同じ優先度の項目が
リクエストごとに入れ替わり、一覧が勝手にシャッフルしているように見える。
`sort=due`では**期限なしを末尾**に置く（SQLiteに任せるとNULLが最小＝最優先として扱われる）。

`dueAt`に`null`を送ると期限を消す。フィールドを省略した場合は変更しない —— この2つは別物。

添付のダウンロードは常に `Content-Disposition: attachment` を返す。任意のユーザーがアップロード
したファイルを自分のオリジンでインライン表示すると、蓄積型XSSの経路になる。

**R2のオブジェクトはデータベースの外にある。** 行を消してもファイルは残るので、削除系の処理は
必ず両方を扱う（退会時も同様）。逆に、オブジェクトが無いのに行がある状態も起こりうるので、
ダウンロードは404を返す。

`deletedAt` が非nullの行は論理削除済みで、一覧にも取得にも現れない
（[ADR 0015](../adr/0015-soft-delete-items-hard-delete-accounts.md)）。アカウント削除
（`POST /api/auth/delete-user`）だけは論理削除済みの行も含めて物理的に消す。

**時刻はISO-8601（`2026-08-23T12:44:13.000Z`）でアプリ側が生成する。** DBのデフォルトは使わない
（SQLiteの`current_timestamp`はISO-8601ではなく、`new Date()`がローカル時刻として誤読する）。
経緯は[ADR 0011](../adr/0011-expand-contract-migrations.md)。

## リアルタイム更新（WebSocket）

| Method | Path | 用途 |
|---|---|---|
| GET | `/api/realtime` | WebSocketにアップグレードし、自分の変更通知を受ける |

`hc<AppType>` では呼ばない（`new WebSocket("/api/realtime")`）。他のエンドポイントと同じ
セッションガードの後ろにあり、**認証はCookieで通る**（ブラウザはハンドshakeにヘッダを付けられない）。
アップグレードでないGETは `426` を返す。

サーバから届くのは `{ "type": "invalidate" }` の**1種類だけ**で、変更内容は載せない。
受け取ったら再取得する。理由は[ADR 0017](../adr/0017-realtime-with-durable-objects.md)。
**取りこぼしても再取得で正しくなる**前提の設計なので、配信保証は無い。

自分の非GETリクエストが成功したときだけ配られる。宛先はユーザー単位なので、他人の変更は届かない。

## エラーレスポンス

エラーは全て`{ error: string }`を含むJSONで返す。例外の内容はクライアントに返さない。

| Status | Body | いつ返るか |
|---|---|---|
| `400` | `{ error: "Bad Request", issues: ZodIssue[] }` | バリデーション失敗。形状は`src/worker/validator.ts`の`validate()`が固定する |
| `404` | `{ error: "Not found" }` | 該当IDが無い / `/api/*`配下の未定義パス |
| `401` | `{ error: "Unauthorized" }` | セッションが無い。`/api/health` と `/api/auth/*` 以外の全 `/api/*` |
| `413` | `{ error: "Payload Too Large" }` | 添付が5MBを超えた |
| `426` | （本文なし） | `/api/realtime` にアップグレードでないGETが来た |
| `429` | `{ error: "Too Many Requests" }` | レート制限。`Retry-After` ヘッダに秒数。`/api/auth/*`（IP単位）と添付アップロード（ユーザー単位）のみ |
| `500` | `{ error: "Internal Server Error" }` | 未捕捉例外。`app.onError`が構造化JSONログを出したうえで返す |

## 本格的なOpenAPI導入を検討するタイミング

以下のいずれかに該当したら、[ADR 0005](../adr/0005-defer-openapi.md)を再検討し、`@hono/zod-openapi`導入の新しいADRを追加する。

- このリポジトリ外の第三者・別チームがAPIを利用するようになった
- エンドポイント数が増え、この表の手動同期が現実的でなくなった
- Swagger UI / Scalarなどインタラクティブなドキュメントを外部公開する要件が生じた
