# 0004. TanStack Router loaderを使い、TanStack Queryは導入しない

## Status

Accepted

## Context

Todos一覧のデータ取得・再取得（追加/更新/削除後の反映）をどう実装するか決める必要があった。TanStack Query（キャッシュ・再検証・楽観的更新などを備えたデータ取得ライブラリ）は候補の一つだったが、初期構成の技術スタック方針では「Later（後で導入するもの）」に分類されていた。

## Decision Drivers

- 今のTodos程度の規模に対する導入コストの見合い
- 既に採用しているTanStack Routerとの自然な統合（ルート遷移とデータ取得を一体で扱える）

## Decision

TanStack Routerの`loader`（`src/routes/index.tsx`の`Route`定義内）でTodos一覧を取得し、追加・更新・削除のmutation後は`router.invalidate()`でloaderを再実行して反映する構成にした。TanStack Queryは導入しない。

## Alternatives considered

- **TanStack Queryを最初から導入**: キャッシュ・バックグラウンド再検証・楽観的更新などが得られるが、今回のTodos程度の単純なCRUDでは過剰。導入コスト（Provider設定、queryKey設計など）に見合わない。
- **Reactの`useState`/`useEffect`で素朴にfetch**: ライブラリ依存は増えないが、TanStack Router loaderの方がルート遷移と自然に統合され（ページ遷移前にデータ取得を待てる、`pendingComponent`でローディング状態を宣言的に書ける）、既にTanStack Routerを採用している以上こちらが自然だった。

## Consequences

- 追加のライブラリなしで、ローディング状態（`pendingComponent`）・エラー状態を含めたデータ取得が完結している。
- キャッシュや楽観的更新は無いため、mutation後は毎回loaderの再実行（サーバーへの再フェッチ）が発生する。Todos程度の規模では問題にならない。
- 画面数・APIエンドポイントが増え、キャッシュ共有や楽観的更新が必要になったタイミングで、TanStack Query導入を再検討する（その際は新しいADRを追加し、このADRを`Superseded by`にする）。
