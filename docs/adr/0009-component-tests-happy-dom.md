# 0009. コンポーネントテストをVitest projectsで分離し、happy-dom + Testing Libraryで書く

## Status

Accepted（ただし「Vitest Browser Mode / Playwrightを見送る」部分のみ[ADR 0016](./0016-e2e-with-playwright.md)が覆した。happy-dom採用とVitest projectsの分割は有効）

## Context

スキャフォールド時点のテストはWorker API（`test/worker/todos.test.ts`）のみで、フロントエンドのテストは存在しなかった。`vitest.config.ts`はリポジトリ全体で1つの設定を持ち、`cloudflareTest()`をトップレベルの`plugins`に置いていた。

この構成のままReactのテストを足すことはできない。`cloudflareTest()`の`config()`フックは`resolve.conditions`を`worker`/`workerd`に、`ssr.target`を`"webworker"`に書き換えるため、Reactや`@base-ui/react`の解決が壊れる。テストはworkerdランタイム内で実行され、DOMも存在しない。

またVitest 4では`environmentMatchGlobs` / `poolMatchGlobs`が削除されており、環境を出し分ける手段は`test.projects`だけになっている。

DOM実装の選択も判断が要った。UI primitiveはBase UI（[ADR 0002](./0002-shadcn-base-ui-nova.md)）で、floating系コンポーネントが`ResizeObserver`・`IntersectionObserver`・`matchMedia`・`scrollIntoView`・`checkVisibility`を使う。実測すると**jsdom 30.0.1はこれらをすべて実装していない**（`PointerEvent`と`MutationObserver`はある）。

## Decision Drivers

- Workerテストの既存の挙動を1ミリも変えないこと
- Base UIベースのコンポーネントが、環境の穴を埋めるための手書きポリフィルなしにレンダリングできること
- 「実装の詳細」ではなく、ユーザーから見える振る舞い（role / label / テキスト）を検証すること

## Decision

`vitest.config.ts`を`test.projects`で2つに分ける。

- **`worker`** — `cloudflareTest()`を**このプロジェクトの`plugins`に閉じ込める**。`include: ["test/worker/**/*.test.ts"]`、`setupFiles: ["./test/apply-migrations.ts"]`。
- **`components`** — `@vitejs/plugin-react` + `@`エイリアス、`environment: "happy-dom"`、`include: ["test/components/**/*.test.tsx"]`、`setupFiles: ["./test/setup-dom.ts"]`。

**DOM実装はhappy-dom 20.11.6**。Testing Library（`@testing-library/react` 16.3.2 / `user-event` 14.6.6 / `jest-dom` 7.0.1）を使う。

型は`tsconfig.test-dom.json`（`lib: ["ES2023","DOM","DOM.Iterable"]` + `jsx: "react-jsx"`）を新設し、`tsconfig.test.json`の`include`を`test/worker`側だけに絞る。jest-domのマッチャ型は`test/setup-dom.ts`の`import "@testing-library/jest-dom/vitest"`によるmodule augmentationなので、このファイルが`tsconfig.test-dom.json`のスコープに入っている必要がある。

## Alternatives considered

- **jsdom**: より仕様に忠実で、Testing Libraryが第一に想定する環境。ただし上記6つのAPIを`test/setup-dom.ts`で自前ポリフィルする必要があり、実際に一度その形で実装して動かした（40行程度のスタブ）。テスト対象のコンポーネントが増えるたびにこのブロックが育つのが明らかで、happy-domに切り替えたところ**同じ14テストがセットアップ3行で通った**ため、jsdomを外した。happy-domが唯一実装していないのは`Element.getAnimations`で、現状のテストでは踏まない（踏んだら同じ場所にスタブを1つ足せばよい）。
- **Vitest Browser Mode（実ブラウザ）**: 最も忠実だがPlaywrightが要る。PlaywrightはCLAUDE.mdで明示的に「Not Yet」としており、この判断を覆すだけの理由は今のところ無い。将来、happy-domで表現できない挙動が問題になったら再検討する。
- **1プロジェクトのまま環境を出し分ける**: Vitest 4で手段が無い。

## Consequences

- `pnpm test`が両プロジェクトを実行し、レポータがプロジェクト名でラベル付けする。片方だけ回すなら`pnpm test --project components` / `--project worker`。
- **ルートレベルの`test.setupFiles`等はプロジェクトに継承されない**（`extends: true`を付けない限り）。警告も出ないので、設定を足すときはプロジェクト側に書くこと。migrationのsetupFilesをルートに残すと、無言でmigrationが適用されないテストになる。
- `include`を両プロジェクトで明示している。デフォルトのglobのままだとworkerプロジェクトがReactのテストを拾ってworkerd内で実行しようとする。
- カバレッジはルート専用の設定で、かつ`cloudflareTest()`はproviderが`v8`だと例外を投げる。将来カバレッジを取るならリポジトリ全体を`@vitest/coverage-istanbul`にする必要がある。
- `@tanstack/react-router`の`Link`を使うコンポーネント（`AppHeader` / `AppSidebar`）のテストには、テスト側でmemory historyのrouterを用意する必要がある。今回はテスト対象に含めていない。
- happy-domはjsdomより仕様の再現度が低い。role・ラベル・テキストに対するアサーションを維持し、レイアウトやCSSカスケードに依存するアサーションは書かないこと。

## Confirmation

`pnpm run check`が`vitest run`で両プロジェクトを実行する。コンポーネントを追加・変更するPRでは、`test/components/`に対応するテストがあるかをレビューで確認する。
