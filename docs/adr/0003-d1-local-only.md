# 0003. D1はローカル開発のみ

## Status

Accepted

## Context

Cloudflare D1をデータ層に採用したが、実際にCloudflareアカウント上にD1データベースを作成し本番デプロイまで行うか、まずローカル開発環境（`wrangler dev`のローカルD1状態）だけで完結させるかを最初に決める必要があった。後者は認証情報のやり取りが不要で、初回スカフォールドの検証を素早く進められる。

## Decision Drivers

- 初回スカフォールドの検証速度（アーキテクチャ全体が動くことを早く確認したい）
- Cloudflareアカウントの認証情報のやり取りを、必要になるまで発生させない

## Decision

`wrangler.jsonc`の`d1_databases`に、実在しないプレースホルダの`database_id`（`00000000-0000-0000-0000-000000000000`）を設定し、**`wrangler d1 create`は実行しない**。マイグレーションは`drizzle-kit generate` → `wrangler d1 migrations apply DB --local`でローカルの`.wrangler/state/v3/d1`にのみ適用する。実際のCloudflareアカウントへのログイン・D1作成・`wrangler deploy`（`--remote`相当の操作）は行わない。

## Alternatives considered

- **実際にD1を作成し本番デプロイまで行う**: 最終的には必要になるが、初回スカフォールドの時点でCloudflareアカウントの認証情報のやり取りを発生させるのは不要なリスク・手間だった。

## Consequences

- ローカルで`pnpm dev` / `pnpm test`が完結し、外部アカウントへの依存なしにアーキテクチャ全体（React → Hono → Drizzle → D1）を検証できた。
- 本番へ出す際は、`wrangler login` → `wrangler d1 create <name>` → `wrangler.jsonc`の`database_id`を実IDに差し替え → `wrangler d1 migrations apply DB --remote` → `wrangler deploy`という手順が別途必要（未実施）。この手順を実施したら、このADRのStatusを更新するか、新しいADR（本番デプロイ手順）を追加すること。

## Confirmation

`wrangler.jsonc`の`database_id`が`00000000-0000-0000-0000-000000000000`のままであることで、まだ実アカウントに繋いでいないと確認できる。実IDに変わっていたら、このADRは本番デプロイ手順の新しいADRに置き換えられているはず。
