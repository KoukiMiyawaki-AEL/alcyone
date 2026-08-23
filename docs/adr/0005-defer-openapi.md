# 0005. OpenAPI生成は見送り、Hono RPCを当面の契約とする

## Status

Accepted

## Context

「ドキュメント規約」「設計判断の記録」に加え、コードベースの外部仕様（API）を記録として残したいという要望から、OpenAPI仕様書の導入を検討した。現在のAPI（`src/worker/index.ts`）はHonoの`@hono/zod-validator`によるチェーン形式のルート定義で、フロントエンドは`hono/client`の`hc<AppType>()`（`src/lib/api-client.ts`）で型安全に呼び出している。OpenAPI化する場合、`@hono/zod-openapi`（`OpenAPIHono` + `createRoute()`）への移行が現実的な選択肢として調査対象になった。

2026-08-24時点で`@hono/zod-openapi`（最新v1.6.1、`hono >=4.10.0` / `zod ^4.0.0`が要求peer、本プロジェクトの`hono@4.13.3` / `zod@4.4.3`と互換）を実際に調査した結果、以下が判明した。

- ルート定義が現状の3〜4倍程度の分量になる（`POST /api/todos`で約8行→約25〜30行）。レスポンス用に名前付きスキーマを別途用意し、`.openapi({ example })`のような注釈も要る。
- **ステータスコードごとに`responses`エントリを明示する必要があり**、"default"的なcatch-all記法はまだ無い（[honojs/middleware#739](https://github.com/honojs/middleware/issues/739)、未解決）。既存の404/204のような素朴なエラーレスポンスも個別に型定義し直す必要がある。
- レスポンススキーマは見た目上厳格（`additionalProperties: false`等）でも、**実行時には強制されない**（[honojs/middleware#913](https://github.com/honojs/middleware/issues/913)）。仕様書と実際のランタイム挙動が一致する保証はバリデーション層だけでは得られない。
- `hono/client`のRPC型推論（`hc<AppType>`）は基本的に動作を継続するが、`@hono/zod-openapi`特有の型推論の不具合が複数報告されている（optional fieldsが`never`になる[#285](https://github.com/honojs/middleware/issues/285)、enumのunion型が広がる[#831](https://github.com/honojs/middleware/issues/831)、path paramでの型崩れ[#1307](https://github.com/honojs/middleware/issues/1307)、[hono#2525](https://github.com/honojs/hono/issues/2525)）。今のTodos APIはenumも深いoptionalも無いため直撃はしにくいが、無視できるリスクではない。

## Decision Drivers

- 実装とドキュメントの構造的な同期（乖離しない保証）と、移行コスト・RPC型推論リスクの見合い
- 今のAPI規模（Todos CRUDのみ、外部利用者なし）に見合った投資であること

## Decision

今回は`@hono/zod-openapi`への移行、およびOpenAPI仕様ファイルの生成を**見送る**。API仕様の一次情報は引き続き**Honoのコード自体（`AppType`）**とし、人が読むための補助として[`docs/api/README.md`](../api/README.md)に簡易なエンドポイント表を手動で維持する。

`docs/api/`というディレクトリ自体は用意し、将来OpenAPIを導入する際の置き場所として確保する。

## Alternatives considered

- **`@hono/zod-openapi`へ全面移行**: 上記の通りコスト・リスクが明確にあり、Todos程度の小さいAPIには見合わないと判断。
- **現行ルートは維持しつつOpenAPI YAMLを手書き/別途生成**: コード変更は避けられるが、実装とドキュメントが構造的に同期される保証がなく、乖離リスクを抱えたまま「記録」を名乗ることになる。今回は採用しなかった。

## Consequences

- 現状のシンプルなHonoルート・RPC型共有はそのまま維持される。
- `docs/api/README.md`のエンドポイント表は手動更新のため、実装変更時に更新し忘れるリスクがある（PRレビュー時にセルフチェックする運用でカバーする）。
- 以下のいずれかに該当したら、このADRを再検討し、`@hono/zod-openapi`導入の新しいADRで置き換える（Supersede）:
  - alcyoneのAPIをこのリポジトリ外の第三者・別チームが利用するようになった
  - エンドポイント数が増え、手動のエンドポイント表の同期コストが無視できなくなった
  - Swagger UI / Scalarなどインタラクティブなドキュメントを外部に公開する要件が生じた

## Confirmation

`src/worker/index.ts`のルートを変更するPRでは、[`docs/api/README.md`](../api/README.md)のエンドポイント表も合わせて更新されているかをレビューで確認する。
