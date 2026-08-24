# 0012. `ON DELETE CASCADE`を使わず、子の削除は`batch()`で明示する

## Status

Accepted

## Context

`todos`が`projects`を参照するようになり、Project削除時に配下のTodoをどう消すかを決める必要が出た。素直な選択肢は`ON DELETE CASCADE`で、SQL 1文で済む。

しかしD1の性質を実測したところ、**このスタックではCASCADEが静かなデータ損失装置になる**ことが分かった。

`projects`のような参照される側のテーブルを作り直すマイグレーション（列の型・NOT NULL・デフォルトの変更、PK/UNIQUE/CHECKの追加削除など、drizzle-kitがテーブル再構築を出す変更全般）は、必ず`DROP TABLE projects`を含む。FKが有効な状態での`DROP TABLE`は暗黙の`DELETE FROM`として振る舞い、**CASCADEを発火させる**。

そしてD1ではFKを切れない（[ADR 0011](./0011-expand-contract-migrations.md)）。実測結果:

```
親を再構築、子がON DELETE CASCADE、FK有効、トランザクション内:
  before todos count = 2
  after  todos count = 0        <- エラー無し、警告無し

親を再構築、子がNO ACTION:
  Error: FOREIGN KEY constraint failed   (defer_foreign_keys=ON でも同じ)
```

**実際にこれは起きかけた。** 0002のcontractマイグレーションで`projects`を作り直したとき、NO ACTIONだったのでエラーで止まった。CASCADEだったら全todoが無言で消えていた。

## Decision Drivers

- 静かに失敗するか、うるさく失敗するか
- 将来の監査ログ（マップD5）と論理削除（D4）が、DBレベルの連鎖削除と両立するか

## Decision

FKは張るが**`onDelete`を指定しない**（既定の`NO ACTION`）。Project削除は、子を先に消してから親を消す**2文を`repo.batch()`**で実行する。

```ts
const [, deleted] = await repo.batch([
  repo.todos.removeByProject(projectId),
  repo.projects.remove(projectId),
]);
```

`batch()`は「順次・非並行に実行され、1文でも失敗すれば全体がロールバックされる」とCloudflareが明記しており、原子性はこれで担保される。順序を間違えればFKが即座に拒否するので、間違いは静かに通らない。

## Alternatives considered

- **`ON DELETE CASCADE`**: SQL 1文で済み、アプリ側が順序を気にしなくてよい。却下理由は上記のデータ損失に加えて3つ。(1) 子の削除がアプリの書き込み経路を通らないので、将来の監査ログに残らない（マップD5の「書き込みを1つの経路に集約する」と正面から衝突する）。(2) 論理削除（D4、まだ検討中）を選んだ場合、DBレベルの物理連鎖削除が`deletedAt`を無視して消してしまう。(3) drizzle-kitの`ALTER TABLE ADD COLUMN`経路は`ON DELETE`句を**生成SQLから落とすのにスナップショットには記録する**ため、DBとスキーマが無言で食い違う。
- **`ON DELETE RESTRICT`**: 削除を拒否するだけで、結局アプリが子を先に消す。NO ACTIONとの差はこのスキーマでは無い。
- **アプリで2文を`batch()`せず順に実行**: D1に対話的トランザクションが無いので、1文目の後で落ちると子だけ消えた状態が残る。

## Consequences

- Project削除のコードが1文ではなく2文になる。順序の責任がアプリ側に来るが、その順序はリポジトリ（`src/worker/db/repo.ts`）1箇所にしかない。
- 将来監査ログを足すとき、**同じ`batch()`配列に1文足すだけ**で済む。これがこの形を選んだ最大の実利。
- 親テーブルを再構築するマイグレーションは、CASCADEによる静かな削除ではなく**エラーで止まる**。手当てはADR 0011のdetach/reattach。
- `test/worker/migrations.test.ts`がFKを`NO ACTION`で固定している。誰かがCASCADEに変えたらここが落ちる。

## Confirmation

`test/worker/migrations.test.ts`の「keeps the foreign key as NO ACTION」が通ること。`src/worker/db/schema.ts`の`projectId`に`onDelete`が付いていないこと。
