# 個人情報の棚卸し

このアプリが保持する個人情報と、その消し方の一覧。[service-readiness-map](./design/service-readiness-map.md)の3-7が
「どのテーブルの何が個人情報かを把握していないと、削除請求にも漏洩時対応にも答えられない」として
挙げていた項目。

**この表は`src/worker/db/schema.ts`と`src/worker/db/auth-schema.ts`が変わったら更新すること。**

## 保持しているもの

| テーブル | 列 | 内容 | 由来 |
|---|---|---|---|
| `user` | `email` | メールアドレス | 本人が入力 |
| `user` | `name` | 表示名 | 本人が入力 |
| `user` | `image` | アバターURL | 未使用（ソーシャルログイン用の列） |
| `account` | `password` | パスワードのハッシュ（scrypt） | 本人が入力。平文は保持しない |
| `session` | `ipAddress` | IPアドレス | **リクエストから自動取得** |
| `session` | `userAgent` | User-Agent | **リクエストから自動取得** |
| `projects` | `name` | ユーザーが付けた名前。**自由入力なので個人情報が入りうる** | 本人が入力 |
| `todos` | `title` | 同上 | 本人が入力 |

`session.ipAddress` と `session.userAgent` は Better Auth が既定で記録する。**本人が入力したもの
ではないのに個人データである**点に注意。

## 保持していないもの

- 平文のパスワード
- 決済情報（課金なし）
- 位置情報、電話番号、生年月日
- サードパーティのトラッキング（アナリティクスを入れていない）
- **アクセスログ中の個人データ** — `app.onError` が出すのは stack / method / path のみで、
  リクエストボディもヘッダも出さない（[マップのD11](./design/service-readiness-map.md)）

## 削除

`/account` からの退会で、上記すべてが物理削除される（[ADR 0015](./adr/0015-soft-delete-items-hard-delete-accounts.md)）。

- `user` / `session` / `account`: Better Auth が削除。session と account は `user` からcascade
- `projects` / `todos`: `beforeDelete` フックが**論理削除済みの行も含めて**物理削除

検証は `test/worker/account-deletion.test.ts`。

## 未対応

- **保持期間の定義が無い。** 論理削除された `projects` / `todos` は退会するまで残り続ける
- **エクスポート（データポータビリティ）が無い**
- Workers Logs の保持は Paid 7日 / Free 3日。**PIIを出さない方針で運用しているが、機械的な検査は無い**
- 削除請求・開示請求を受け付ける窓口が無い（利用規約もプライバシーポリシーも未作成）
