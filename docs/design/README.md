# Design Docs

機能・サブシステム単位で「何を作っていて、なぜその形にしたか」を説明する、**生きたドキュメント**。

## ADRとの違い

| | ADR（[`docs/adr/`](../adr/)） | Design doc（ここ） |
|---|---|---|
| スコープ | 1つの決定（ライブラリ選定など） | 機能・サブシステム全体 |
| いつ書くか | 決定した**後**に、決定を記録する | 決定する**前**から、考えをまとめるために書き始める |
| ライフサイクル | 一度Acceptedになったら不変。覆すときは新しいADRを足す | 実装が進むにつれて書き換えてよい。実装と乖離したら「Status」を更新するか、内容を実態に合わせて修正する |
| 粒度 | 小さく・具体的 | 広く・全体像 |

design docの中で「これは後から覆されると困る、明確な決定だ」という部分が出てきたら、その部分だけを個別のADRとして切り出し、design docからはそのADRへリンクする。design doc自体は個々の決定を全部ADR化する必要はない。

## 書き方

[`template.md`](./template.md)を使う。Sourcegraph社のRFCフォーマットを土台にした軽量版（Summary / Background & Problem / Goals & Non-Goals / Proposal / Alternatives / Definition of Success）で、1時間程度で書ける分量を目安にする。Google社内の"design doc"文化のような10〜20ページ級の重い形式は、このリポジトリの規模には不要と判断している。

ファイル名は`docs/adr/`のような連番ではなく、対象（機能・サブシステム名）が分かるkebab-caseにする（例: `initial-architecture.md`）。

実例: [`initial-architecture.md`](./initial-architecture.md)
