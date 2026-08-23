# 0006. コードフォーマッタにoxfmtを採用する

## Status

Accepted

## Context

スキャフォールド時点でこのリポジトリにはコードフォーマッタが存在しなかった。lintは`oxlint`（`.oxlintrc.json`）が入っていたが、Prettier・Biome・`.editorconfig`のいずれも無く、インデント・クォート・import順は各自のエディタ任せだった。

実際に既存コードにはブレがあり、`src/index.css`は4スペース、`src/components/ui/*`（shadcn/uiの生成物）はセミコロン無し、それ以外の手書きコードはセミコロン有りと、同一リポジトリ内で複数のスタイルが混在していた。CIを導入する（[ADR 0007](./0007-ci-and-codegen.md)）にあたり、フォーマットの差分がレビューのノイズになる状態を先に解消する必要があった。

## Decision Drivers

- oxlintと同じエコシステムで揃うこと（設定・実行体系・将来のツール統合が一貫する）
- Tailwind CSSのクラス順ソートを追加プラグイン無しで賄えること（CLAUDE.mdのDesign System規約と直結する）
- 実行が速く、CIのステップとして常時回しても負担にならないこと

## Decision

`oxfmt` 0.64.0 をdevDependencyとして導入し、`.oxfmtrc.json`で設定する。

```jsonc
{
  "ignorePatterns": ["**/*.md", "drizzle/**"],
  "sortImports": true,
  "sortTailwindcss": {
    "stylesheet": "src/index.css",
    "functions": ["cn", "cva"]
  }
}
```

- `sortImports`（`eslint-plugin-perfectionist/sort-imports`相当）と`sortTailwindcss`（`prettier-plugin-tailwindcss`相当）を有効化する。後者はTailwind v4のCSS-first configを`stylesheet`で指定し、`cn()` / `cva()`の引数もソート対象にする。
- **Markdownは対象外にする。** `docs/`とCLAUDE.mdは日本語の手書き文書で、oxfmtは全角幅を計算してテーブルの区切り線をパディングし直す。表示は綺麗になるが、セルを1文字直すたびに行全体が差分になり、文書中心のこのリポジトリでは編集の摩擦が利得を上回ると判断した。
- `.gitignore`はoxfmtが自動で尊重するため、生成物（`src/routeTree.gen.ts`、`worker-configuration.d.ts`、`dist/`）を`ignorePatterns`に重複して書かない。

`package.json`に`format`（書き換え）と`format:check`（検証）を追加し、後者を`check`スクリプトに組み込む。

## Alternatives considered

- **Prettier**: 最も枯れており、エディタ統合も確実。ただしTailwindクラスソートに`prettier-plugin-tailwindcss`、import順に別プラグインが要り、oxlintとは別エコシステムの依存が増える。oxfmtが両方を内蔵しており、これを選ぶ積極的な理由が無かった。
- **Biome**: formatとlintを一本化できるが、lintがoxlintと完全に役割重複する。統一するならoxlintを捨ててBiomeへ寄せる判断が必要で、それは今回の目的（既存構成の穴を塞ぐ）を超える。
- **フォーマッタを入れない**: CIで`format:check`が使えず、スタイルの揺れがレビューのノイズとして残り続ける。

## Consequences

- 導入時に全ファイル一括フォーマットの大きな差分が1回発生する（設定追加とは別コミットに分ける）。
- oxfmtは1.0未満であり、将来のバージョンでデフォルト整形結果が変わる可能性がある。バージョンは`package.json`で固定し、更新時は差分を確認してから取り込む。
- JSONCも整形対象になり、`wrangler.jsonc`には末尾カンマが付く。wranglerのパーサはこれを受け付けることを`wrangler deploy --dry-run`で確認済み。
- Markdownはフォーマッタの管轄外なので、`docs/`の書式は引き続き人の手で揃える。

## Confirmation

`pnpm run check`に`format:check`が含まれており、CI（`.github/workflows/ci.yml`）がPRごとに実行する。フォーマットされていないコードはマージできない。
