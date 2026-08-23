# 0002. shadcn/ui base=Base UI, style=nova

## Status

Accepted

## Context

shadcn/uiを導入するにあたり、2026年7月の変更でprimitiveの土台（base）がRadixからBase UIへ既定で切り替わっており（`shadcn init`のデフォルトが`-b base`）、styleプリセットも複数（vega/nova/maia/lyra/mira/luma/sera/rhea）から選ぶ必要があった。プロジェクト立ち上げ時点のユーザー方針ドキュメントは、旧来のRadixベースの構成（`sonner`コンポーネント等）を前提に書かれていたが、これは古い情報だった。

## Decision Drivers

- shadcn/ui自体の現行デフォルトから乖離し続けない（今後のコンポーネント追加のたびに差分が生じるのを避ける）
- ユーザー方針ドキュメントが明示的に推奨していた「Nova」スタイルを尊重する
- ダッシュボード・業務系UIに合う密度（余白の少なさ）

## Decision

`pnpm dlx shadcn@latest init -b base -p nova`で、**base UI（`-b base`）+ styleプリセット`nova`**、baseColor `neutral`を採用した。これに伴い、旧来のRadix版`sonner`ではなく、Base UI版の`toast`コンポーネント（`pnpm dlx shadcn@latest add toast`）を使う。

## Alternatives considered

- **`-b radix`（旧来のRadixベース）**: ユーザー方針ドキュメントが元々前提にしていた構成。実績があり枯れているが、shadcn/ui自体の現在のデフォルトから外れる。将来的なコンポーネント追加のたびにデフォルトと差分が生じ続ける。
- **他のstyleプリセット（vega, maia, lyra, mira等）**: `nova`はダッシュボード・業務系UI向けの余白を抑えたコンパクトなスタイルで、当初のユーザー方針ドキュメントが「Nova」を明示的に推奨していたため、そのまま踏襲した。

## Consequences

- shadcn/uiの現行デフォルトに沿っているため、今後 `shadcn add` で追加するコンポーネントも迷いなくBase UI版になる。
- Base UIはRadixより新しく、コミュニティの知見・Stack Overflow等の実例が相対的に少ない。コンポーネントのAPI（`asChild`ではなく`render`プロパティを使う、など）がRadixと異なる点に注意が必要（例: `DropdownMenuTrigger`は`render={<Button .../>}`で子要素を差し替える）。
- 将来Radixへ戻したくなった場合は、`components.json`の`base`を変更し、既存コンポーネントを`--overwrite`で再生成する必要がある（部分的な混在は非推奨）。

## Confirmation

`components.json`の`"style": "base-nova"`（base UI + novaプリセット）が変わっていないことで確認できる。新しいコンポーネントを追加する際は、CLAUDE.mdの指示どおり`pnpm dlx shadcn@latest add <component>`をこの設定のまま実行しているかをレビューで確認する。
