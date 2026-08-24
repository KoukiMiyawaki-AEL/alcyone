# 0016. E2EテストをPlaywrightで書く（ADR 0009のBrowser Mode見送りを覆す）

## Status

Accepted（[ADR 0009](./0009-component-tests-happy-dom.md)のうち「Browser Modeを見送る」判断のみを覆す。同ADRのhappy-dom採用は有効なまま）

## Context

[service-readiness-map](../design/service-readiness-map.md)の3-8「E2Eテスト」は**画面が3枚を超えたら**という閾値トリガーを持っており、ログイン画面の追加で**実際に発火した**（マップ史上初）。マップの規約は「発火したのに動かなかったら理由を状態列に書く」で、2回続けて「Playwrightは[ADR 0009](./0009-component-tests-happy-dom.md)とCLAUDE.mdで見送り済み」と記録した。同時に2回とも「この見送りの根拠は弱くなった」とも書いた。

3回目の見送りは、マップ自身が警告している「無視される文書に転落する」の実演になる。

見送りの根拠が弱くなった理由は具体的で、抽象論ではない。認証の作業で見つかった不具合3件——

- ログイン後に画面が遷移しない（セッションフックとの競合）
- リダイレクトループ（2つのガードと命令的navigateの競合）
- `/` のloaderで `throw redirect()` がcatchに飲まれる

——は**いずれもworkerテストにもcomponentテストにも掛からなかった**。workerプロジェクトは `app.request()` を呼ぶだけでクライアントを走らせず、componentプロジェクトはコンポーネントを描画するだけでAPIに触れない。3件とも**その2つの隙間**にいた。

## Decision

**Playwright 1.62.1 でE2Eを書く。** `test/e2e/`、`pnpm run check` に組み込む。

Vitest Browser Mode ではなくPlaywrightを選んだ。Browser Modeは**コンポーネントを実ブラウザで描画する**ための仕組みで、アプリ全体を起動して回すE2Eとは目的が違う。既存のvitestプロジェクトに3つ目として並べられる魅力はあるが、道具の用途を曲げることになる。

構成上の要点:

- **専用のデータベースで動かす。** `vite.config.ts` が `E2E=1` のとき `persistState: { path: ".wrangler/e2e-state" }` を渡す。開発用のDBに書き込まないためと、**毎回空から始めるため**（「No projects yet」や他人のProjectが見えないことを検証するので、残留データがあると静かに壊れる）。`test:e2e` スクリプトが毎回消して作り直す。
- **起動中のdevサーバを再利用しない**（`reuseExistingServer: false`）。再利用すると**実際の開発用DBに対してテストが走る**。ポートが埋まっていたら失敗する方がよい（この安全装置は初回実行で実際に作動した）。
- `workers: 1` / `fullyParallel: false`。1つのDBを共有するので並行実行できない。
- 各テストは**どの不具合の回帰テストなのかをコメントで名指しする**。E2Eは遅く壊れやすいので、「なぜこれがあるか」が書いていないと真っ先に消される。

## Alternatives considered

- **Vitest Browser Mode**: 上記の通り目的が違う。加えて `@vitest/browser` もPlaywrightをプロバイダとして要求するので、依存が減るわけでもない。
- **E2Eを見送り続ける**: 3回目。マップの信頼性を犠牲にする。
- **`check` に入れず別コマンドにする**: `check` は遅くなる（+約20秒とブラウザの用意）。ただし[ADR 0007](./0007-ci-and-codegen.md)が「CIは `pnpm run check` 1本」という性質を確立しており、E2Eだけ別扱いにすると**CIで回らないテストが生まれる**。それは回らなくなる第一歩なので `check` に入れた。

## Consequences

- **`playwright install chromium` が必要になった。** fresh cloneの手順に1つ増える（README/CLAUDE.mdに記載）。CIにもステップが1つ増える。
- `pnpm run check` が約20秒長くなる。
- **導入初日に不具合を1件見つけた**: アカウント削除がAPIとしては成功しているのに `/account` に留まり、サインイン済みのように見えていた。`deleteUser` はサーバ側でセッションを終わらせるがクライアントのストアには削除済みユーザーが残り、かつ**ルートガードはナビゲーション時にしか走らない**ので、その場に留まる操作では何も再評価されない。「ガードに任せる」が成立しない唯一のケースだった。
- E2Eは遅く壊れやすい。**ロケータはrole/labelで書き、`data-testid` に頼らない**（componentテストと同じ規約）。実装の詳細に結びつけると、E2Eの維持コストが跳ね上がる。
- 失敗時のtraceをCIのアーティファクトに残す設定にした（7日）。

## Confirmation

`pnpm run check` に `test:e2e` が含まれていること。`test/e2e/` の各テストに、それが守っている振る舞いのコメントがあること。マップ3-8の「E2Eテスト」が 済 になっていること。
