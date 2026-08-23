# 0007. CIをGitHub Actionsで回し、生成物はコミットせずcodegenスクリプトで再生成する

## Status

Accepted

## Context

スキャフォールド時点でCIが存在せず、`pnpm run check`と`pnpm test`は完全に手動だった。同時に、以下の2つの生成物が`.gitignore`されていた。

- `worker-configuration.d.ts` — `wrangler types`が`wrangler.jsonc`のbindingsから生成する。`tsconfig.app/worker/test.json`の3つが`types`で参照している。
- `src/routeTree.gen.ts` — TanStack Routerのファイルベースルーティングの生成物。

この2つを無視したままだと、**fresh cloneで`tsc -b`が通らない**。生成を保証する仕組み（postinstallフック等）も無かった。加えて`build`/`check`が`vite build && tsc -b`の順で、型エラーがバンドル生成をgateしていなかった（`vite build`が`src/routeTree.gen.ts`を副作用として生成するため、この順序でしか成立していなかった）。

`src/routeTree.gen.ts`は`node_modules/.bin`にCLIが無く、Viteプラグイン経由でしか生成できない状態だった。

## Decision Drivers

- 型チェックがバンドル生成より前に走ること（壊れた型で成果物が出ない）
- ローカルとCIで同じ1コマンドが通ること（CI固有の手順を持たない）
- 生成物のバージョン管理が、レビュー時のノイズにならないこと

## Decision

**生成物はコミットしない。** 代わりに`codegen`スクリプトを用意し、型チェックより前に必ず走らせる。

```jsonc
"codegen":   "wrangler types --env-interface CloudflareBindings && tsr generate",
"typecheck": "tsc -b",
"build":     "pnpm run codegen && tsc -b && vite build",
"check":     "pnpm run codegen && pnpm run format:check && pnpm run lint && tsc -b && vite build && vitest run && wrangler deploy --dry-run",
```

- `tsr generate`のために`@tanstack/router-cli`をdevDependencyに追加する。設定は`tsr.config.json`に切り出し、`vite.config.ts`の`tanstackRouter()`は引数無しにして**単一のsource of truth**にする。CLIとViteプラグインの出力がバイト単位で一致することを確認済み。
- 旧`cf-typegen`スクリプトは`codegen`に統合して廃止する。
- CIは`.github/workflows/ci.yml`の1ジョブで、`jdx/mise-action`が`mise.toml`のNode/pnpmをそのまま使い、pnpm storeをキャッシュして`pnpm install --frozen-lockfile`→`pnpm run check`を実行する。バージョン定義をCIに二重化しない。
- `wrangler deploy --dry-run`は認証不要なのでsecretsは要らない。これは`vite build`が出力する`dist/alcyone/wrangler.json`を検証するため、必ず`vite build`より後に置く。

Cloudflare公式ガイダンス（[Workers TypeScript](https://developers.cloudflare.com/workers/languages/typescript/)）も「CIでは他のコマンドより前に`wrangler types`を走らせる」を推奨しており、この構成と一致する。

## Alternatives considered

- **生成物を両方コミットする**: 追加依存ゼロで済み、TanStack公式サンプルは`routeTree.gen.ts`をコミットしている。ただし`worker-configuration.d.ts`は581KB・15,000行あり、`wrangler.jsonc`やworkerdのバージョンを触るたびに巨大な差分がPRに乗る。レビューの見通しを優先して却下した。
- **`routeTree.gen.ts`だけコミットする**: 折衷案で追加依存も要らないが、生成物の扱いがファイルごとに違うというルールを残すことになる。`codegen`に統一した方が説明が短い。
- **postinstall / prepareフックで生成する**: `pnpm install`のたびに走って手軽だが、`wrangler.jsonc`を編集しただけでは再生成されず、結局`check`の前段が必要になる。フックは暗黙的で、失敗したときの原因が追いにくい点も避けたかった。
- **CIを入れず git hook（lefthook等）で守る**: ローカル環境に依存し、`--no-verify`で迂回できる。CIを入れる以上、hookは後から必要になったら足せばよい。

## Consequences

- fresh cloneの手順に`pnpm run codegen`が必要になる（README.mdに明記した）。エディタを開いた直後は型エラーが出るが、`pnpm dev`か`pnpm run codegen`で解消する。
- `@tanstack/router-cli`という依存が1つ増える。`@tanstack/router-plugin`とはバージョンが独立して進むため、routeTreeの出力がズレたら両者のバージョンを揃える必要がある。
- `check`が直列で全工程を回すため、CIの実行時間はキャッシュヒット時でも数分かかる。並列ジョブへの分割は、遅さが実際に問題になってから検討する。
- `tsr.config.json`とViteプラグインの設定が分離されたので、ルーティング設定を変えるときは`tsr.config.json`だけを編集する。

## Confirmation

- `rm -f src/routeTree.gen.ts worker-configuration.d.ts && pnpm run codegen && pnpm run typecheck`が通ること（fresh clone相当の確認）。
- `.github/workflows/ci.yml`がpush（main）とpull requestで`pnpm run check`を実行していること。
