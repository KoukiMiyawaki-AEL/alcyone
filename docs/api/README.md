# API

OpenAPI仕様書は現時点では生成していない（経緯は[ADR 0005](../adr/0005-defer-openapi.md)）。ここにあるのは人が読むための簡易な参照であり、**型としての一次情報は[`src/lib/api-client.ts`](../../src/lib/api-client.ts)（`hc<AppType>`）と[`src/worker/index.ts`](../../src/worker/index.ts)そのもの**。この表と実装がずれていないか、実装を変更したPRの中でセルフチェックすること。

## リクエストの振り分け

`wrangler.jsonc`の`assets.run_worker_first`が`["/api/*"]`なので、**Workerに届くのは`/api/*`だけ**。
それ以外のパスはasset workerが処理し、該当するファイルが無ければ`index.html`にフォールバックして
TanStack Routerがクライアント側で描画する（存在しない画面は`__root.tsx`の`notFoundComponent`）。
新しいエンドポイントは必ず`/api/`配下に置くこと。

## エンドポイント一覧

すべて`src/worker/index.ts`で定義。

| Method | Path | 概要 | Request body | 200系レスポンス | エラー |
|---|---|---|---|---|---|
| GET | `/api/health` | ヘルスチェック | — | `{ ok: true }` | — |
| GET | `/api/todos` | Todo一覧取得（id昇順） | — | `Todo[]` | — |
| POST | `/api/todos` | Todo作成 | `{ title: string }`（1〜200文字） | `201` `Todo` | `400` バリデーションエラー |
| PATCH | `/api/todos/:id` | 完了状態の更新 | `{ completed: boolean }` | `200` `Todo` | `404` 該当IDなし |
| DELETE | `/api/todos/:id` | Todo削除 | — | `204` (body無し) | `404` 該当IDなし |

`Todo`の型は`src/worker/db/schema.ts`の`todosTable`から`drizzle-orm`が推論する（`id: number, title: string, completed: boolean, createdAt: string`）。

## エラーレスポンス

エラーは全て`{ error: string }`を含むJSONで返す。例外の内容はクライアントに返さない。

| Status | Body | いつ返るか |
|---|---|---|
| `400` | `{ error: "Bad Request", issues: ZodIssue[] }` | バリデーション失敗。形状は`src/worker/validator.ts`の`validate()`が固定する |
| `404` | `{ error: "Not found" }` | 該当IDが無い / `/api/*`配下の未定義パス |
| `500` | `{ error: "Internal Server Error" }` | 未捕捉例外。`app.onError`が構造化JSONログを出したうえで返す |

## 本格的なOpenAPI導入を検討するタイミング

以下のいずれかに該当したら、[ADR 0005](../adr/0005-defer-openapi.md)を再検討し、`@hono/zod-openapi`導入の新しいADRを追加する。

- このリポジトリ外の第三者・別チームがAPIを利用するようになった
- エンドポイント数が増え、この表の手動同期が現実的でなくなった
- Swagger UI / Scalarなどインタラクティブなドキュメントを外部公開する要件が生じた
