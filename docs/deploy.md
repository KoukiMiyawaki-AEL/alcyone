# 本番デプロイ手順

**現状: 未実施。** [ADR 0003](./adr/0003-d1-local-only.md)のとおり、
このリポジトリはまだ実際のCloudflareアカウント上で動いたことがない。
`wrangler.jsonc` のD1とKVのidはローカル用のプレースホルダで、
`pnpm run preflight` がそれを検出してデプロイを止める。

この文書は**やっていないことの手順書**である。実施したら、
ここに「いつ・何が起きたか」を追記すること。

## なぜ止まっているか

`wrangler whoami` が未認証で、APIトークンも無い。
`wrangler login` はブラウザでの対話的な認証なので、**この作業をする人自身が実行する必要がある**。

## 手順

各コマンドが返すidを `wrangler.jsonc` に書き戻す。順序に意味がある
（リソースが無い状態でデプロイすると、起動はするがbindingが解決できない）。

```bash
# 1. 認証（対話的。ブラウザが開く）
pnpm exec wrangler login

# 2. D1。返る database_id を wrangler.jsonc の d1_databases[0].database_id へ
pnpm exec wrangler d1 create alcyone-db

# 3. KV。返る id を kv_namespaces[0].id へ
pnpm exec wrangler kv namespace create SHARE_CACHE

# 4. R2
pnpm exec wrangler r2 bucket create alcyone-attachments

# 5. Queues。**DLQも作る**（消費側の設定が参照している）
pnpm exec wrangler queues create alcyone-object-cleanup
pnpm exec wrangler queues create alcyone-object-cleanup-dlq

# 6. シークレット
pnpm exec wrangler secret put BETTER_AUTH_SECRET   # openssl rand -base64 32
pnpm exec wrangler secret put BETTER_AUTH_URL      # 例: https://alcyone.<subdomain>.workers.dev

# 7. デプロイ（preflight → check → リモートmigration → deploy）
pnpm run deploy
```

Durable ObjectsとWorkflowsとAnalytics Engineは**事前作成が要らない**。
デプロイ時にクラス名・名前から作られる。

## 先に知っておくべきこと

### `BETTER_AUTH_URL` は鶏と卵になる

[ADR 0013](./adr/0013-better-auth.md)でbaseURLを明示すると決めたので、
**デプロイ先のURLが分からないと設定できない**。一度デプロイしてURLを確認し、
secretを入れて**もう一度デプロイする**のが素直。
最初の1回は認証のリダイレクトが正しく動かない。

### Freeプランではパスワード認証が成立しない

[ADR 0013](./adr/0013-better-auth.md)に記録済み。Better Authは純JSのscryptでハッシュするため
CPUを食い、**Workers Freeの1呼び出し10ms上限を超える**。Paidが要る。

### D1のバックアップは破壊的

[Time Travel](./design/service-readiness-map.md)しか無く、**復元はin-placeでフォークできない**。
中身を確認してから戻すことができない。実データを入れる前に読むこと。

### アラートが無い

マップ3-6のとおり、Workersのランタイムアラートは存在しない。
デプロイした瞬間から、**落ちても誰も気づかない**状態になる。
[ADR 0023](./adr/0023-analytics-engine-events.md)のイベントは記録されるが、
**誰にも通知されない**。

### 未検証のまま本番に出るもの

ローカルでは原理的に再現できず、**本番で初めて挙動が分かる**ものがある。
デプロイしたら、まずここを確認する:

| 何が | どこに書いてあるか | 何を確かめるか |
|---|---|---|
| D1の読み取りレプリカ整合 | [ADR 0021](./adr/0021-d1-sessions-for-read-replicas.md) | 作成直後の一覧に出るか |
| KVの結果整合 | [ADR 0022](./adr/0022-share-links-cached-in-kv.md) | 共有解除が何秒で効くか |
| Analytics Engine | [ADR 0023](./adr/0023-analytics-engine-events.md) | SQL APIで1件でも読めるか |
| Queuesのdead letter | [ADR 0019](./adr/0019-object-cleanup-queue.md) | 失敗が実際にDLQへ落ちるか |
| Workflowsの再開 | [ADR 0020](./adr/0020-data-export-workflow.md) | ステップ失敗後に飛ばして再開するか |

## `pnpm run preflight` が見ているもの

`wrangler deploy --dry-run` は**設定の形しか見ない**。
プレースホルダの `database_id` は型検査もビルドもdry-runも通り、
**デプロイされてから初めてDBに届かない**。preflightはその差を埋めるためにある。
