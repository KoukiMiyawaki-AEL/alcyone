# 0011. スキーマ変更はexpand/contractで行い、D1固有の制約を前提にする

## Status

Accepted

## Context

[service-readiness-map](../design/service-readiness-map.md)のD10が「expand/contractを最初の本番デプロイ前に方針として決める」としていた。Project（1:N）の追加で`todos`に`projectId`をNOT NULLで足す必要が生じ、本番データが無い今が**ノーリスクで実地に試せる唯一の機会**だったので、逃げずにやった。

実際にやってみて、**推測では絶対に出てこない制約が4つ出た**。すべて実測で確認している。

### 1. D1では`ALTER TABLE ADD COLUMN`にNOT NULLとREFERENCESを同時に付けられない

D1は常にFKを強制する（`PRAGMA foreign_keys`は`1`）。その状態でSQLiteは、REFERENCES列にNULL以外のデフォルトを許さず、NOT NULL列にNULLデフォルトを許さない。結果、両立しない。

| 追加する列 | 行が無い | 行がある |
|---|---|---|
| `integer REFERENCES projects(id)` | OK | **OK** |
| `integer NOT NULL REFERENCES projects(id)` | **OK（危険）** | 失敗 |
| `integer NOT NULL DEFAULT 1 REFERENCES projects(id)` | **OK（危険）** | 失敗 |

**2行目・3行目が本当の地雷。** 空テーブルだと成功してしまう。テストは毎回まっさらなDBにマイグレーションを再生するので、**この形の壊れたマイグレーションはCIを永久に通り続け、データがある環境でだけ落ちる。**

よって nullable で足す以外に選択肢が無く、NOT NULL 化は別のマイグレーションに分けるしかない。**expand/contractは設計の好みではなく、D1では強制される。**

### 2. D1では親テーブルを作り直せない

`createdAt`のデフォルトを外すため`projects`を作り直そうとしたところ、drizzle-kitが生成したSQLは**そのままでは適用できなかった**。`todos`が参照している状態で`DROP TABLE projects`が走るため。

- `PRAGMA foreign_keys=OFF`（drizzleが再構築SQLを囲むために出す）は**D1では無視される**。マイグレーションは1バッチ＝1トランザクションとして実行され、SQLiteはトランザクション内でこのPRAGMAを無視する。
- `PRAGMA defer_foreign_keys=on`はD1が受け付けるが、**COMMIT時に結局失敗する**（`DROP TABLE`が立てた違反カウンタが`RENAME`で解消されない）。実測で確認。

**`ON DELETE CASCADE`を使っていたら、この`DROP TABLE`は全todoを無言で削除していた**（[ADR 0012](./0012-no-on-delete-cascade.md)）。NO ACTIONだったのでエラーで止まり、データが守られた。

> **追記（添付ファイル導入時）**: 当時「`todos`を参照するテーブルがまだ無いので再構築は通る」と
> 書いたが、**その前提はもう成り立たない**。`attachments`が`todos`を参照するようになったので、
> 今後`todos`を再構築するマイグレーションは`projects`と同じくdetach/reattachが要る。
> 参照される側のテーブルは増える一方であることの実例。

### 3. drizzle-kitはスキーマを生成するがデータを生成しない

seed、backfill、フォーマット変換はすべて手書きになる。今回は3つ必要だった。

### 4. マイグレーションに`BEGIN`/`COMMIT`を書けない

wranglerが拒否する。ファイル全体が既に1バッチとして適用されるため。

## Decision

**スキーマ変更はexpand/contractで行う。** 各マイグレーションは、**その時点で動いているコード**と互換でなければならない。

適用順は `expand → コードをデプロイ → contract`。expandは旧コードと互換（列はnullable）、contractは新コードが常に値を入れるようになった後に初めて安全になる。

今回の具体形（`drizzle/0001_*.sql` と `drizzle/0002_*.sql`）:

1. **expand** — `projects`作成、Inboxをseed、`todos.projectId`を**nullable**で追加、backfill、index作成。seedとbackfillは手書き。
2. **contract** — `projectId`をNOT NULL化。**生成SQLは使えないので全体を手書きした**。親テーブルを作り直すため、detach → 親を再構築 → reattach の順にする:
   - `todos`をFK無しで作り直す（この機に`createdAt`変換・`updatedAt`追加・NOT NULL化も済ませる）
   - 誰も参照していない`projects`を作り直す
   - FKとindexを復元して`todos`を最終形にする

   生成SQLの`PRAGMA foreign_keys`行は**削除し、D1では無効である旨のコメントに置き換える**。残すと存在しない保護があるように読め、次の人が親テーブルの再構築にコピーして事故る。

**今後、`projects`のように参照される側のテーブルを再構築する変更（列の型・NOT NULL・デフォルト変更、PK/UNIQUE/CHECKの追加削除など）は、drizzle-kitの生成物をそのまま使えない。** 上記のdetach/reattachを手書きすること。

関連して、**`.unique()`（テーブルレベルのUNIQUE制約）は使わない。** drizzle-kitの再構築は`uniqueConstraints`を再発行せず、**無言で落とす**。同じ目的には`uniqueIndex()`を使う（indexは再発行される）。

## Alternatives considered

- **マイグレーション`0000`を書き換えて1本に畳む**: 本番データが無くjournalも1エントリなので正当ではあった。スキーマは綺麗になり、手書きSQLもゼロになる。**却下した理由は、上記4つの制約がどれも見つからなかったから。** 実データを持って初めて出会うことになり、その時にはリスクが伴う。加えてローカルの`.wrangler/state`を全て消す必要があり、消し忘れても無言で食い違うだけでCIは気づかない。
- **`projectId`をnullableのままにする（未所属＝Inbox扱い）**: マイグレーションは1本で済む。ただし同じ事実に2つの表現（NULLとInbox）ができ、読み取り経路すべてに`OR projectId IS NULL`が要る。それはまさにマップD1が警告する「付け忘れが型エラーにもテスト失敗にもならない`where`」を、リポジトリに集約したそばから再び散らすことになる。
- **`projects.createdAt`のデフォルトだけ残す**: 親テーブルの再構築を回避でき、今回いちばん安く済んだ。しかし壊れた形式を書きうるデフォルトが残り、D2で直したはずの問題が再発する余地を残す。

## Consequences

- スキーマ変更が2ステップになり、その間にデプロイを挟む必要がある。手間は増えるが、これは本番でダウンタイム無しに変更する唯一の方法でもある。
- 参照される側のテーブルを触る変更は手書きになる。頻度は低いが、**知らないと生成物をそのまま適用して失敗する**（幸い失敗は静かではなく、エラーで止まる）。
- **CIはbackfillとデータ変換を検証していない。** `test/apply-migrations.ts`は空のDBに適用するので、`UPDATE ... WHERE projectId IS NULL`は常に0行、`INSERT ... SELECT`も常に0行コピーになる。制約1の「空テーブルだと成功する」と合わせると、**ここがこの構成最大の盲点**。今回はローカルD1に実データを置いて手で予行演習した。データを動かすマイグレーションを書くときは毎回そうすること。
- `test/worker/migrations.test.ts`が、マイグレーションが**生み出したはずの形**（NOT NULL、FKがNO ACTION、index、デフォルトが無いこと、一時テーブルが残っていないこと）を検証する。データ経路は見ないが、再構築が何かを無言で落とした場合はこれが気づく。

## Confirmation

- `drizzle/0002_*.sql`の冒頭コメントが、手書きである理由を説明していること。
- `test/worker/migrations.test.ts`が通ること。
- データを動かすマイグレーションを追加したPRでは、ローカルD1に実データを入れた状態での予行演習をしたかをレビューで確認する（CIは検証できない）。
