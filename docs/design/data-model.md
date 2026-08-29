# データモデルとスキーマの進化

D1（SQLite）上のスキーマと、それを安全に変えていくための決まり。

## テーブル

```
user ──┬── session, account, verification        Better Authの所有
       │
       ├── projects ──┬── project_members
       │              ├── labels ──┐
       │              ├── shares   │
       │              └── todos ───┼── todo_labels
       │                           ├── todo_comments
       │                           ├── todo_events
       │                           ├── todo_links
       │                           ├── attachments
       │                           └── todos.parentId（自己参照）
```

- **`projects`** — `name` / `key` / `description` / `color` / `startAt` / `dueAt` /
  `archivedAt` / `ownerId` / `deletedAt`
- **`todos`** — `title` / `status` / `assigneeId` / `parentId` / `startAt` / `dueAt` /
  `description` / `priority` / `deletedAt`
- **`todo_events`** — 変更履歴。**追記専用**
- **`labels` / `todo_labels`** — プロジェクトに属するラベルと、タスクとの多対多

Better Authのテーブル（`user` / `session` / `account` / `verification`）は
生成物をそのまま置いている（`src/worker/db/auth-schema.ts`）。列名がsnake_caseで
タイムスタンプがミリ秒整数なのは、このアプリの他の部分（ISO-8601のtext）と違うが、
ライブラリの規約なので合わせない。

## 値域はDB側にも置く

zodはエンドポイントを守る。CHECK制約は**テーブルを守る**——マイグレーション、
コンソール、まだ書かれていないハンドラを含めて。

- `todos.status` は既知の値だけ（`todos_status_known`）
- `todos.startAt <= dueAt`（`todos_dates_ordered`）
- `labels.color` はパレットの6色だけ
- `todo_links` は自分自身を指せない

**ただし `user` と `projects` はトリガーで守る。** SQLiteは既存テーブルに制約を追加できず、
追加するにはテーブルの作り直しが要る。この2つは作り直せない：

- `user` は `session` と `account` から `ON DELETE CASCADE` で参照されているので、
  古いテーブルを落とした時点で**全セッションと全資格情報が消える**
- `projects` は `todos` / `shares` / `project_members` / `labels` から参照されていて、
  SQLiteは外部キーを行ごとに検査するので、**最初の子行で失敗する**

そのため `user_role_known_*` と `projects_valid_*` は `BEFORE INSERT/UPDATE` トリガーで
`RAISE(ABORT)` する。保証は同じで、行に触らない。

## 論理削除と、本当の削除

- **Project と Todo は論理削除**（`deletedAt`）。読み取りは必ず `deletedAt IS NULL` で絞る。
  忘れても型エラーにもテスト失敗にもならないので、この `where` は `repo.ts` にしかない。
- **論理削除はUndoとセットで出す**（`src/lib/undo-toast.ts`）。復元手段の無い論理削除は、
  ユーザーから見ればただの削除で、隠し列を増やしただけになる。
- **30日で完全に消える。** cronが `createMaintenance()` の `purgeDeletedBefore()` を回す。
- **アーカイブは削除ではない。** `projects.archivedAt` は別の列で、
  アーカイブされたプロジェクトは一覧から消えて**永久に読める**。
- **退会だけが物理削除。** `purgeOwnedData()` がそのアカウントの行を消し、
  R2のオブジェクトも消す。エクスポートで持ち出せる形を用意したうえでの完全削除。

## 外部キーは `ON DELETE` を持たない

すべて `NO ACTION`。カスケードは便利だが、**どこまで消えるかがスキーマを読まないと分からない**。
その代わり、削除は必ず明示的に、依存の順で書く。

そしてこの選択は、削除の**順序**を設計の対象にする：

- **自己参照する外部キー（`todos.parentId`）を持つ行を物理削除するときは、先に切り離す。**
  SQLiteは外部キーを行ごとに検査するので、親を子より先に消す削除は失敗する。
  保持期限のパージ・退会・テストのリセットの3経路すべてが対象。
- **子から順に消す。** 添付 → ラベルの紐付け → 関連 → コメント → 履歴 → タスク →
  ラベル → 共有 → 参加者 → プロジェクト。1つでも抜けると、**バッチ全体が失敗する**——
  夜間のパージは1つのbatchなので、1行の取りこぼしが全ユーザー分の削除を止める。
- **`todos` の子テーブルを増やしたら、この順序を持つ3箇所すべてに足す。**
  保持期限のパージ（`maintenance.ts`）、退会（`purgeOwnedData()`）、テストの `resetAll`。
  併せて、データエクスポートの部品と [`../pii.md`](../pii.md) の棚卸し表も更新する。

## D1の制約が形を決めている

- **対話的トランザクションが無い。** `db.transaction()` は型が通るのに実行時に落ちる。
  複数文を原子的に実行したいときは `repo.batch([...])`。
- **`meta.changes` は信用できない。** トリガーの書き込みも数えられ、`batch()` の中では
  文ごとに割り当てられてすらいない。件数が要るときは `.returning()` して行を数える。
- **`db.run(sql)` / `db.all(sql)` はbatchに入れられない。** 未実行のdrizzleビルダーだけが
  batchの要素になれる。生SQLを混ぜると実行時に「cannot read properties of undefined」で落ちる。
- **`repo` のメソッドを `async` にしない。`.all()` / `.get()` も呼ばない。**
  未実行のビルダーを返すことで、`await` もできるし `batch()` の要素にもなる。
  `async` にすると前者だけになり、後者が黙って壊れる。
- **読み取り行数で課金される。** 一覧はカーソル方式で、`limit + 1` 件取って
  次のページの有無を判断する（件数のための2度目のクエリを避ける）。

## 変更履歴

`todo_events` は追記専用で、更新も削除もしない（退会時の物理削除を除く）。

- **「記録してから変更する」を1つのbatchに載せる。** 履歴の挿入が先——UPDATEが走ると
  古い値が存在しなくなる。
- **比較は `INSERT ... SELECT` の `WHERE` に入れる。** ハンドラで読んでから差分を取ると、
  読みと書きの間に別のリクエストが入り、起きていない遷移が残る。
- **`<>` ではなく `is not` を使う。** SQLの不等号はNULLを伝播するので、`<>` だと
  日付を設定/解除した履歴だけが静かに欠落する。
- **1回の保存で書いた履歴行には同じ `revisionId` を与える。** 詳細フォームは毎回全項目を
  送るので、これが無いと1つの操作が複数の出来事に見える。idは `crypto.randomUUID()` で作り、
  **タイムスタンプで代用しない**（同じミリ秒の2つの保存が融合するし、
  「時計が一致したから同じ操作」はデータが述べていない推測になる）。

## マイグレーション

`drizzle-kit generate` で作り、`drizzle/` に置く。適用は
`wrangler d1 migrations apply DB --local`。

**expand / contract で進める。** 列を足す → 両方書く → 読み替える → 古い列を落とす。
1回のマイグレーションで型を変えると、動いているコードとスキーマが一瞬でも食い違う。

**列の追加は `ALTER TABLE ADD COLUMN` で済む**（NULL可か既定値付きであれば）。
テーブルの再構築が起きるのは、既存の列の型・制約を変えるときと、CHECK制約を足すとき。
**生成されたSQLを読んで、どちらになったかを確かめること**——再構築なら次の3つが効いてくる。

**本番にはロールバックが無い。** D1のバックアップはTime Travelだけで、復元は破壊的
（中身を確認してから戻せない）。壊れたマイグレーションを当てたら安全に戻す手段は無い。

drizzle-kitのテーブル再構築には注意が要る：

- **テーブルレベルの UNIQUE 制約が黙って落ちる。** 一意性が要るものは
  `uniqueIndex()` で書く（再構築でもインデックスは再生成される）。
- **`DROP TABLE` はそのテーブルのトリガーも落とす。** 全文検索のトリガーは
  drizzleが知らないので、`todos` を再構築すると3つとも消え、
  **`todos_fts` は古い行を保持したまま検索に答え続ける**。エラーも出ない。
  再構築を含むマイグレーションでは、トリガーを再作成すること。
- **外部キーは行ごとに検査される。** 子テーブルが空なら再構築は通り、1行あると失敗する。
  「テストで通った」は「本番で通る」を意味しない。

`test/worker/migrations.test.ts` が、適用後のスキーマの形（インデックス、トリガー、
CHECK制約、一時テーブルが残っていないこと）を固定している。

## 全文検索

`todos_fts` は FTS5 の外部コンテンツテーブルで、`tokenize='trigram'` を使う。
日本語には語の区切りが無く、標準のトークナイザは空白で切るので機能しない。
trigramなら3文字単位で索引でき、部分一致も効く。

同期は3つのトリガー（insert / update / delete）で行う。**索引にはオーナー列が無い**ので、
検索クエリは必ずプロジェクトのスコープと結合する——結合を落とすと全ユーザーの
タイトルが返る。
