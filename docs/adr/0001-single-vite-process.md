# 0001. 単一Vite devサーバー構成（モノレポにしない）

## Status

Accepted

## Context

フロントエンド（React SPA）とバックエンド（Hono API）を、Cloudflare Workers上で動かす構成にする必要があった。開発時に別々のプロセス・別々のポートで動かすか、1つのdevサーバーで両方を動かすかは、ディレクトリ構成（単一パッケージ vs モノレポ）にも直結する初期段階の決定だった。

## Decision Drivers

- `hono/client`の`hc<AppType>()`によるRPC型共有を、余計な前提条件（別パッケージ間でのtsconfig整合等）なしに素直に効かせたい
- 初期スカフォールドの時点でモノレポ（Turborepo等）の複雑さを持ち込みたくない
- Reactの開発体験（HMR等）をそのまま使いたい

## Decision

`@cloudflare/vite-plugin`を使い、**単一のVite devサーバー**がReact SPA（`client` environment）とHono Worker（`worker` environment）を同時にホストする構成にした。プロジェクトも**単一パッケージ**とし、`packages/client` / `packages/server`のようなモノレポ分割はしない。

- `vite.config.ts`に`cloudflare()`プラグインを追加するだけで、`vite dev`が実際の`workerd`ランタイム上でHono Workerを動かし、React側のビルドと同時に提供する。
- `wrangler dev`は使わない（本番デプロイ時の`wrangler deploy`のみ使用）。
- `src/worker/`（Hono）と`src/routes/`等（React）を同一`tsconfig`ツリー内に置きつつ、`tsconfig.app.json` / `tsconfig.worker.json`でグローバル型（DOM vs Workers runtime）を分離する。

## Alternatives considered

- **pnpmモノレポ（`packages/client` / `packages/server`に分割）**: 将来Turborepoを導入する前提なら見据えやすいが、今の規模では複雑さに見合わない。特に、`hono/client`の`hc<AppType>()`によるRPC型共有は、フロントとバックが同一tsconfigプログラム内にある方が素直に機能する（別パッケージに分けると両方の`tsconfig`で`strict: true`を揃える必要が出るなど、型共有の前提条件が増える）。
- **`wrangler dev`をdevサーバーとして使う**: ReactのHMRやVite独自の開発体験（`@vitejs/plugin-react`など）を素直に使えなくなる。

## Consequences

- フロントエンドとバックエンドが1つの`vite dev`で完結し、開発体験がシンプル。型共有（`AppType`）も同一tsconfigプログラム内で自然に効く。
- 一方で、Cloudflareのアセットルーティング特有の挙動（`assets.not_found_handling: "single-page-application"`によるSPAフォールバックが、`fetch()`と直接ナビゲーションで挙動が変わる）を把握しておく必要がある。詳細は[Alcyone Runtime Map](https://claude.ai/code/artifact/d09c4c3c-fa8c-42bb-8573-2cc8c8bf458c)（アーキテクチャ図Artifact）を参照。
- プロジェクトが大きくなり、フロント/バックを別チーム・別デプロイサイクルで運用する必要が出た場合は、モノレポ分割を再検討する（その際は新しいADRを追加すること）。
