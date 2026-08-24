# 0013. 認証にBetter Authを採用し、メール+パスワードで始める

## Status

Accepted

## Context

[service-readiness-map](../design/service-readiness-map.md)の3-2が「認証方式の選定」を実ユーザー1人目の前提として挙げていた。加えて[ADR 0010](./0010-alcyone-as-proving-ground.md)の位置づけ（技術検証の台、プロダクト機能より基盤の完全性）からすると、認証はこのスタックで**最も検証されていない領域**だった。

調査で確定した前提:

- **Cloudflareにエンドユーザー認証の一次製品は無い。** Access は自社の従業員向けで、`workers-oauth-provider` は認可サーバであって "not an identity provider" と自ら明記している。外部の選択が必須。
- **workerdはPBKDF2を10万回で打ち止め**（OWASP推奨は21万〜60万）、**argon2は非対応**。自前でパスワードを持つのが構造的に不利に見えた。
- メール送信基盤が無い（Cloudflare Email Sendingはbetaかつ Workers Paid 限定）。

## Decision

**Better Auth 1.7.1** を採用し、**メール + パスワード**で始める。

- adapterは `drizzleAdapter(drizzle(env.DB), { provider: "sqlite" })`。**D1専用adapterは存在しない。**
- `createAuth(env)` はリクエストごとに構築する。Workersのモジュールスコープに `env` は無い。
- `basePath` は既定の `/api/auth`。`wrangler.jsonc` の `run_worker_first: ["/api/*"]` の内側に入るので**ルーティング設定の変更は不要**。
- メール検証とパスワード再発行は**無効**。基盤が無いため。
- `minPasswordLength: 12`。

### パスワードハッシュの懸念は消えた

Better Authの依存に `@noble/hashes` があり、**ハッシュは純JS（scrypt）で行われる**。WebCryptoのPBKDF2にもネイティブargon2にも依存しないので、workerdの上記2つの制約は**どちらも当たらない**。

ただし派生する制約が1つある。**純JSのscryptはCPUを食い、Workers Freeは1呼び出しCPU 10ms**（Paidは既定30秒）。つまり**パスワード認証を載せた時点でこの構成はFreeプランでは成立しない**。「このスタックで実サービスを運営できるか」という問いに対する、実際の答えの一部。

### スキーマは生成物を取り込む

`user` / `session` / `account` / `verification` の4テーブルを、**インストール済みの `@better-auth/drizzle-adapter` に同梱されているスキーマ生成器から生成**して `src/worker/db/auth-schema.ts` に置いた。ドキュメントからの転記ではないので、`package.json` に固定したバージョンと必ず一致する。

`@better-auth/cli` は**使わない**。npmで **deprecated** とマークされており、かつ `@prisma/client` と native ビルドを要する `better-sqlite3` をツールチェーンに引き込む。一度のコードジェネレーションのためにこれを抱えるのは見合わない（両者のビルドは `pnpm-workspace.yaml` の `allowBuilds` で明示的に拒否した）。

生成物からの意図的な逸脱が2つ:

1. **`.unique()` を `uniqueIndex()` に変えた。** [ADR 0011](./0011-expand-contract-migrations.md)が要求している通り、drizzle-kitのテーブル再構築はインデックスを再発行するが**テーブルレベルのUNIQUE制約は無言で落とす**。放置すると将来の再構築で「2人が同じメールアドレスを持てない」保証が静かに消える。SQLiteでは挙動は同一。
2. 生成された `authRelations`（drizzle relations v2）は使わないので落とした。

**`onDelete: "cascade"` は生成物のまま残した。これは[ADR 0012](./0012-no-on-delete-cascade.md)の例外。** 理由: これはライブラリ所有のスキーマで、Better Auth自身の削除経路をこちらで制御できない。また `deleteUser` は既定で無効。**覚えておくべき帰結**: `user` を再構築するマイグレーションは、session と account を無言で全削除する。そのときはADR 0011のdetach/reattachが必要。

なおこれらのテーブルは snake_case の列名と**整数ミリ秒のタイムスタンプ**を使い、このプロジェクトの他の場所（ISO-8601のtext）と異なる。Better Authの流儀であり、争う価値はないと判断した。

## Alternatives considered

- **Auth.js / NextAuth**: `@auth/d1-adapter` はあるが、Workersでのbinding取得（リクエストコンテキスト外）が扱いにくく、Hono統合も無い。
- **Clerk / Auth0 / WorkOS**: workerdでは動くが、ユーザーがベンダー側に置かれる。「このスタックで完結するか」を検証する目的に対して、検証対象を外部に出してしまう。無料枠は大きい（Clerk 50k MAU、WorkOS 1M MAU）ので、外部化を選ぶなら有力。
- **Lucia**: 2025年3月に**廃止**され、npmパッケージではなく「自分で書くための教材」になった。
- **自前実装**（`hono/jwt` + `@hono/oauth-providers`）: oauth-providersに永続化層が無く、user/sessionテーブルとハッシュ戦略を自分で書くことになる。上記のPBKDF2上限をまともに踏む領域で、ここを自作する理由が無い。
- **ソーシャルログインのみ**: パスワードを持たなくて済むのが最大の利点。ただしOAuthアプリの登録とclient secretの用意が必要で、自動テストとブラウザ確認が外部サービスに依存する。メール+パスワードは外部依存ゼロで完結する。

## Consequences

- **Freeプランでは動かない構成になった**（scryptのCPU時間）。本番を考えるときはWorkers Paid前提。
- メール検証が無いので、**メールアドレスの到達性を確認していない**。パスワードを忘れたユーザーは自力で復帰できない。メール基盤を入れるまでの既知の制限。
- Better Authは**Originヘッダによる検証を標準で行う**。Originが無いリクエストは403 `MISSING_OR_NULL_ORIGIN`、別Originからは403 `INVALID_ORIGIN`（どちらも実測で確認）。マップ3-7の「CSRF対策」はこれで実質的に満たされる。副作用として、**curlでAPIを叩くときは `Origin` ヘッダが必要**。
- テストは実際のサインアップ経由でセッションを作る（`test/worker/auth-helper.ts`）。セッショントークンはハッシュされ、Cookieは署名されるので、行を直接挿入して偽のCookieを作るやり方は「動くふり」をテストすることになる。代償として**workerテストが実際にscryptを走らせるので遅くなった**。
- `better-auth` を更新したら auth-schema.ts を再生成すること。生成コマンドは`@better-auth/drizzle-adapter` の `generateDrizzleSchema` を `provider: "sqlite"` で呼ぶ。
- 組織単位のテナンシーが必要になったら `better-auth/plugins/organization` がある。今は使っていない（[ADR 0014](./0014-user-owned-projects.md)）。

## Confirmation

`src/worker/auth.ts` が存在し、`test/worker/todos.test.ts` の「未認証は401」「/api/health は認証不要」が通ること。`package.json` に `@better-auth/cli` が無いこと。
