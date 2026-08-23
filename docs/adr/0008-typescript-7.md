# 0008. TypeScript 7（ネイティブ実装）へ更新する

## Status

Accepted

## Context

スキャフォールド時点のTypeScriptは6.0.3で、npmの`latest`は7.0.2だった。TypeScript 7はコンパイラをGoで書き直したネイティブ実装であり、メジャーバージョンの数字以上に配布形態が変わっている。

- npmの`typescript`パッケージは**プラットフォーム別のネイティブバイナリ**（`@typescript/typescript-darwin-arm64`など20種類）をoptionalDependenciesとして持つ薄いラッパになった。
- `exports`の`"."`が`./lib/version.cjs`だけを指すようになり、**`require("typescript")`でコンパイラAPIを取得できない**。従来の`typescript.js`は無く、APIは`typescript/unstable/*`という明示的に「unstable」と名付けられたサブパスに移った。
- `bin`は`tsc`のみで、**`tsserver`が無い**。言語サーバは同じバイナリの`tsc --lsp`（LSPプロトコル）として提供される。

このプロジェクトで実際に更新して検証したところ、以下が確認できた。

- `pnpm run check`の全工程（codegen → format:check → lint → `tsc -b` → build → Vitest → `wrangler deploy --dry-run`）が通る。
- `tsc -b`（project references / composite build）がそのまま動作する。使用中のオプション（`strict`、`noUncheckedIndexedAccess`、`erasableSyntaxOnly`、`verbatimModuleSyntax`、`moduleDetection`、`allowArbitraryExtensions`）はすべて解決され、意図通り機能する（`--showConfig`と、implicit anyを故意に書いた負のコントロールで確認）。
- **型チェックが約2.9倍速い**。このリポジトリのcold `tsc -b`で 2.01s → 0.69s。
- 依存ツリー全体を走査した結果、`typescript`をdependency/peerDependencyとして要求するパッケージは`cosmiconfig`（optional peer、`*.config.ts`をロードする場合のみ使用）1つだけだった。このプロジェクトのツール設定はすべてJSON（`.oxlintrc.json` / `.oxfmtrc.json` / `components.json` / `tsr.config.json`）なので該当しない。
- `pnpm run db:generate`（drizzle-kitが`drizzle.config.ts`を読む）と`pnpm exec shadcn diff`が動作することを確認した。

## Decision Drivers

- 型チェックはローカルでもCI（`pnpm run check`）でも毎回走るため、その速度が開発サイクルに直結する
- 破壊的な配布形態の変更に対して、このプロジェクトの依存が実際に耐えられるか（憶測でなく実測）

## Decision

`typescript`を`~7.0.2`に更新する。`tsconfig.*.json`の変更は不要。

## Alternatives considered

- **6系に留まる**: 配布形態の変化に起因するリスクをゼロにできる。ただし上記の通り、このプロジェクトが実際に踏む互換性の問題は見つからず、留まる積極的な理由が無かった。スキャフォールド段階で追従しておく方が、後から依存が増えた状態で移行するより安い。
- **7系を`^`で追従する**: `~7.0.2`にしてパッチのみ自動追従とした。マイナー更新は差分を確認してから取り込む。

## Consequences

- 型チェックが大幅に速くなる。CIの`check`も短縮される。
- **エディタの設定に注意が必要。** `tsserver`が無いため、「ワークスペースのTypeScriptバージョンを使う」設定のエディタは、TypeScript 7のLSP（`tsc --lsp`）に対応した拡張が要る（VS Codeなら TypeScript Native Preview）。対応していない場合はエディタ同梱のTypeScriptにフォールバックし、エディタ上の型チェック結果が`tsc -b`とズレうる。**信頼できる判定は常に`pnpm run typecheck`（CIと同じ）**。
- コンパイラAPI（`require("typescript")`）に依存するツールを今後導入する場合は、TypeScript 7対応を確認する必要がある。APIは`typescript/unstable/*`にあり、名前の通り安定性を保証されていない。
- ネイティブバイナリがoptionalDependenciesで配布されるため、`pnpm install`が対象プラットフォームのバイナリを取得できる必要がある。CIはubuntu-latest（linux-x64）、開発機はmacOS（darwin-arm64）で、いずれも公式に配布されている。

## Confirmation

`pnpm run check`がCIで通ること。エディタ側の差異を疑ったら`pnpm run typecheck`を正とする。
