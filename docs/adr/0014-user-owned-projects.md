# 0014. Projectはユーザーが所有し、Todoの所有はProject経由の推移的関係にする

## Status

Accepted

## Context

認証（[ADR 0013](./0013-better-auth.md)）を入れる時点で、「誰がProjectを持つか」を決めないと先に進めなくなった。[service-readiness-map](../design/service-readiness-map.md)のP2が挙げていた「テナント境界」の決着であり、同時にマップの**D1（オーナー列が無い）**を閉じる作業。

ターゲットユーザーがB2BかB2Cかは依然として未決（ADR 0010）。よってここでは**どちらに転んでも困らない最小の形**を選ぶ必要があった。

決定的だったのは、認証を入れることで**既存の欠陥が実害に変わる**という点。`PATCH /api/todos/:id` と `DELETE /api/todos/:id` はtodoのidだけで行を引いていた。idは連番で推測が自明（実データ1行の時点でidが9になっていた）。ユーザーが2人存在した瞬間、**一方が他方のtodoを書き換え・削除できる**。

## Decision

**`projects.ownerId` → `user.id`。ユーザーがProjectを所有する。**

- **todosには所有者の列を持たせない。** 所有はProject経由の推移的関係にする。todoが常にちょうど1つのProjectに属する（[ADR 0011](./0011-expand-contract-migrations.md)で`projectId`をNOT NULLにした）ので、これで一意に決まる。
- **組織単位のテナンシーは載せない。** Better Authに `organization` プラグインがあるので、B2Bに振ると決めたときの受け皿は存在する。
- **絞り込みは `src/worker/db/repo.ts` の1箇所に閉じる。** `createRepo(binding, ownerId)` にし、**返るメソッドはすべて最初からスコープ済み**にした。ハンドラはスコープされていないクエリを受け取ることがないので、絞り込みを忘れることが構造的にできない。
- **`onDelete` は付けない**（ADR 0012）。`projects` は `todos` から参照される親でもあるため、`user` からのcascadeは2階層下のtodoまで無言で消しうる。

平置きの2ルート（`PATCH`/`DELETE /api/todos/:id`）は、todoに所有者列が無いので **`projects` へのサブクエリで絞る**。

```sql
UPDATE todos SET ... WHERE id = ? AND projectId IN (SELECT id FROM projects WHERE ownerId = ?)
```

## Alternatives considered

- **組織が所有する（Better Auth の organization プラグイン）**: B2Bに振るなら後の移行が省ける。ただし今それを選ぶと、B2B前提をここで固めることになる。テーブルもロールも増え、まだ要件が無い権限モデルを設計することになる（マップのBackgroundが挙げている「まだ要らないものを作る」失敗そのもの）。
- **todosにも `ownerId` を持たせる（非正規化）**: 平置きルートのクエリがサブクエリ無しで書けて速い。ただし同じ事実の出所が2つになり、Projectを別ユーザーへ移す機能が将来入ったときに不整合の種になる。D1の`rows_read`課金を考えると測ってから最適化する話であって、先にやる話ではない。
- **`ownerId` をnullableのままにする**: 「所有者なし」という状態が表現でき、マイグレーションが1本で済む。しかし同じ事実に2つの表現ができ、読み取り経路すべてに `OR ownerId IS NULL` が要る。それはリポジトリに絞り込みを集約したそばから再び散らすことになる。
- **平置きルートをProject配下に移す**（`/api/projects/:projectId/todos/:id`）: URLから所有が読み取れる。ただしサーバは「そのtodoが本当にそのProjectのものか」を別途検証するか、黙って無視するかの二択になる。無視されるパスセグメントは無いより悪い。

## Consequences

- **越境アクセスが塞がった。** 回帰テストは`test/worker/projects.test.ts`の`cross-user isolation`にある。これらは**サブクエリを元に戻すと実際に落ちることを確認した**（通っているだけでは、テストが穴を突いているか分からない）。
- 平置き2ルートのクエリにサブクエリが1つ増えた。`projects.ownerId` にインデックスを張ってあるが、これは推測ではなく必要——D1は**スキャンした行数**で課金し、1DBはクエリを1件ずつ処理する。
- `ownerId` を NOT NULL にする contract マイグレーションは、`projects` が `todos` から参照される親なので**ADR 0011のdetach/reattachが必要になった**。あのレシピの最初の実戦適用であり、実データで動くことを確認した。
- 認証以前に作られたProjectには所有者がいない。ユーザーが1人も存在しないのでbackfillで埋める値も無く、**contractマイグレーションで削除した**。ADR 0003（本番データは存在しない）を根拠にした一度限りの措置で、マイグレーションにもその旨を明記してある。プレースホルダのユーザーを作って割り当てる案は却下した——認証できるかもしれない偽のアカウントは、スクラッチデータの削除より悪い。
- 0001でseedした全体共有の `Inbox` Projectは、所有者を持てないので同時に消えた。
- 組織単位に移るときは `projects` に `organizationId` を足すことになり、**これも親テーブルの再構築**なので再びdetach/reattachが必要。手順は確立済み。

## Confirmation

`test/worker/projects.test.ts` の `cross-user isolation` が通ること。`src/worker/db/repo.ts` の `createRepo` が `ownerId` を引数に取り、公開しているメソッドに `ownerId` で絞っていないものが無いこと。
