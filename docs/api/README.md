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
| GET | `/api/projects/:projectId/todos` | そのProjectのTodo一覧 | クエリ: `status`（下記）、`sort`=`created`\|`start`\|`due`\|`priority`、`cursor`、`limit` | `{ project, todos, nextCursor }` | `400`, `404` |
| POST | `/api/projects/:projectId/todos` | Todo作成 | `{ title }` 必須 + 下記の任意フィールド | `201` `Todo` | `400`, `404` |
| PATCH | `/api/todos/:id` | Todoの部分更新（下記の任意フィールド） | 下記 | `200` `Todo` | `400`, `404` |
| GET | `/api/todos/:id/attachments` | 添付一覧 | — | `Attachment[]` | `400`, `404` |
| POST | `/api/todos/:id/attachments` | 添付の追加（multipart、フィールド名`file`、5MBまで） | multipart | `201` `Attachment` | `400`, `404`, `413` |
| GET | `/api/attachments/:id` | 添付のダウンロード | — | ファイル本体 | `400`, `404` |
| DELETE | `/api/attachments/:id` | 添付の削除（R2のオブジェクトも消す） | — | `204` (body無し) | `400`, `404` |
| DELETE | `/api/todos/:id` | Todo削除（**論理削除**） | — | `204` (body無し) | `400`, `404` |
| POST | `/api/todos/:id/restore` | Todoの復元 | — | `200` `Todo` | `400`, `404` |

### Todoのフィールド

作成と更新で同じ形を受け取る。**すべて任意で、省略は「変えない」、`null` は「空にする」。**
この2つを同じ扱いにすると「期限を外す」が表現できなくなる。

| フィールド | 値 | 備考 |
|---|---|---|
| `title` | 1〜200文字 | 作成時のみ必須 |
| `status` | `todo` \| `in_progress` \| `blocked` \| `done` | 既定は `todo` |
| `startAt` | ISO日付 または `null` | `dueAt` より後は `400` |
| `dueAt` | ISO日付 または `null` | |
| `description` | 2000文字まで、または `null` | 空白のみは `null` に正規化される |
| `priority` | 0〜3 | 0 = なし、3 = 最高 |

一覧の `status` クエリは**行のstatusに加えて** `all` と `active` を取る。
`active` は「`done` 以外」で、どれか1つのstatusでは表せない問い（「まだ残っているもの」）を
同じパラメータで書けるようにするため。

`PATCH /api/todos/:id` は1本にまとめてある。以前は完了状態とそれ以外で2本に分かれていたが、
完了が他と同じ1フィールドになった今、2本あることは所有スコープを書き忘れる場所が2つあることでしかない。

Todo一覧が裸の配列ではなく`{ project, todos }`を返すのは、画面のタイトルに使うProject情報を
2回目のリクエスト無しで得るためと、将来カーソルを足すときに破壊的変更にしないため。

`PATCH` / `DELETE /api/todos/:id` にprojectIdを含めていないのは、含めるとサーバ側で
「そのTodoが本当にそのProjectのものか」を追加クエリで検証するか、黙って無視するかの二択になるため。
無視されるパスセグメントは、無いより悪い。

Project削除は`ON DELETE CASCADE`ではなく、子を先に消す2文を`batch()`で実行している
（[ADR 0012](../adr/0012-no-on-delete-cascade.md)）。

`Todo` / `Project` の型は`src/worker/db/schema.ts`から`drizzle-orm`が推論する。

- `Todo`: `{ id, title, status, createdAt, updatedAt, projectId, startAt: string|null, dueAt: string|null, description: string|null, priority: 0-3, deletedAt: string|null }`
  - `status` は `todo` / `in_progress` / `blocked` / `done` のいずれか。
    **DBのCHECK制約でも縛られている**ので、この4つ以外は保存されない
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

## タスク間の関係

| Method | Path | 用途 | 成功 | 失敗 |
|---|---|---|---|---|
| GET | `/api/todos/:id/links` | このタスクの関係（両方向） | `Link[]` | `400` `404` |
| POST | `/api/todos/:id/links` | 関係を追加 | `201 { id }` | `400` `404` |
| DELETE | `/api/links/:id` | 関係を解除 | `204` | `400` `404` |

`kind` は `blocks`（有向。`fromTodoId` が `toTodoId` をブロックする）か `related`（対称）。
**`related` は1行しか保存しない**ので、両端から見えるが行は1つ。

親子は関係ではなく `PATCH /api/todos/:id` の `parentId`。**循環は `400`**、
自分のものでないタスクを親に指定すると **`404`**（存在を漏らさないため）。

## 担当者

| Method | Path | 用途 | 成功 | 失敗 |
|---|---|---|---|---|
| GET | `/api/projects/:projectId/assignees` | そのProjectのタスクを割り当てられる相手 | `{ id, name }[]` | `400` |

**今日はちょうど1人（Projectの所有者）を返す。** クライアントが「自分自身」と決め打ちしないのは、
複数人が届くようになったときに探して直す場所を作らないため。

割り当ては `PATCH /api/todos/:id` の `assigneeId`。`null` で解除する。
存在しないユーザーidは外部キーが拒む（`500`）。

## コメントと履歴

| Method | Path | 用途 | 成功 | 失敗 |
|---|---|---|---|---|
| GET | `/api/todos/:id/activity` | コメントと変更履歴 | `{ comments, events }` | `400` `404` |
| POST | `/api/todos/:id/comments` | コメントを投稿 | `201` `Comment` | `400` `404` |
| PATCH | `/api/comments/:id` | 自分のコメントを編集 | `200` `Comment` | `400` `404` |
| DELETE | `/api/comments/:id` | 自分のコメントを削除（論理削除） | `204` | `400` `404` |

`events` は**追記専用で、書き込むエンドポイントは存在しない**。1行が1フィールドの変更で、
`field` / `fromValue` / `toValue` を持つ。`created` / `deleted` / `restored` は値を持たない。

**同じ保存で書かれた行は同じ `revisionId` を持つ。** 1回の更新はたいてい複数フィールドを変えるので、
これが無いと1つの操作が複数の出来事に見える。

`PATCH /api/todos/:id` は任意の `comment` を受け取る。**同じbatchで**同じ `revisionId` の
コメントが作られ、その変更の理由として表示される。変更が失敗すればコメントも書かれない。
`todo_comments.revisionId` が null のものは、変更に紐づかない単独のコメント。

**変わっていないフィールドは記録されない。** 詳細フォームは毎回全項目を送るので、
「送られたもの」を記録すると本当の変更が埋もれる。

`description` の編集は記録しない。理由は[ADR 0027](../adr/0027-comments-and-append-only-history.md)。

## 共有リンク

| Method | Path | 用途 | 認証 | 成功 | 失敗 |
|---|---|---|---|---|---|
| POST | `/api/projects/:projectId/share` | リンクを発行（冪等） | 要 | `{ token }` | `404` |
| GET | `/api/projects/:projectId/share` | 現在のリンク | 要 | `{ token または null }` | `400` |
| DELETE | `/api/projects/:projectId/share` | リンクを解除 | 要 | `204` | `404` |
| GET | `/api/shared/:token` | 共有ビューを読む | **不要** | `{ project, todos }` | `400` `404` `429` |

`/api/shared/:token`は**このAPIで唯一、認証が要らない**。IPでレート制限している。

返すのは行そのものではなく、公開用に選んだ形（id・ownerId・createdAtを含まない）。

**KVが前段にあるので、内容は最大60秒古い。解除も「1分以内に効く」であって即座ではない。**
理由と、その取引を受け入れた条件は[ADR 0022](../adr/0022-share-links-cached-in-kv.md)。

取り消し済みトークンと存在しないトークンは**同じ応答**を返す。

## データエクスポート

| Method | Path | 用途 | パラメータ | 成功 | 失敗 |
|---|---|---|---|---|---|
| POST | `/api/exports` | エクスポートを開始 | — | `202 { id, status }` | — |
| GET | `/api/exports/:instanceId` | 状態と（完成していれば）manifest | — | `{ id, status, manifest }` | `404` |
| GET | `/api/exports/:instanceId/:part` | 1部品をダウンロード | `part`は`manifest`/`projects`/`todos`/`attachments`/`comments`/`events` | `200` JSON | `400` `404` |

`manifest`が非nullなら完成している。**部品はmanifestより先に書かれる**ので、
manifestに載っているものは必ず存在する。

R2の鍵は**セッションのuser idから組み立てる**ので、`instanceId`を他人のものにしても
他人のデータは出てこない（`manifest: null` か `404`）。

エクスポートは**論理削除済みの行も含む**（各行の`deletedAt`で判別できる）。
保持期限は他と同じ30日で、退会時にも消える。理由は[ADR 0020](../adr/0020-data-export-workflow.md)。

## 検索

| Method | Path | 用途 | パラメータ | 成功 | 失敗 |
|---|---|---|---|---|---|
| GET | `/api/search` | 所有する全Projectを横断してTodoを検索 | `q`（必須、1〜200字）、`cursor`、`limit` | `{ items, nextCursor }` | `400` |

**タイトルとメモ（`description`）の両方**を検索する。

`items`の各行はTodoに`rank`が付いたもの。**`rank`は小さいほど良い一致**（bm25の符号）で、
短い検索語の経路では常に`0`。

**`q`が空だと`400`**。空の検索は「全件」ではなく操作ミスであり、
全件返すと検索窓がアプリで最も高いクエリになる。

**3文字未満の語はFTSでは引けない**（trigramの制約）。その場合はLIKEの全走査に落ちるので、
**短い検索語は遅く、D1の課金上も高い**。理由と実測は[ADR 0018](../adr/0018-fts5-trigram-search.md)。

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

## Cookie

| 名前 | 誰が発行するか | 用途 |
|---|---|---|
| `better-auth.session_token` 等 | Better Auth | セッション |
| `d1-bookmark` | このWorker | D1のread-your-own-writes（[ADR 0021](../adr/0021-d1-sessions-for-read-replicas.md)） |

`d1-bookmark`はHttpOnlyで、クライアントが読む必要は無い。**古い値や壊れた値を送っても
エラーにはならず**、順序の保証を失うだけ。

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
