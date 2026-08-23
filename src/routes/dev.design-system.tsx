import { createFileRoute } from "@tanstack/react-router";
import { InboxIcon, TriangleAlertIcon } from "lucide-react";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/dev/design-system")({
  component: DesignSystemComponent,
});

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

function DesignSystemComponent() {
  return (
    <div className="flex flex-col gap-10 pb-12">
      <PageHeader
        title="Design System"
        description="コンポーネント・トークン・状態表現の一覧。shadcn/uiコンポーネントを追加したらここで確認する。"
      />

      <Section title="Typography">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Page title
          </h1>
          <h2 className="text-lg font-semibold tracking-tight">
            Section title
          </h2>
          <p className="text-sm">Body text — 標準の本文サイズ。</p>
          <p className="text-sm text-muted-foreground">
            Secondary text — 補足情報に使用する。
          </p>
          <Label>Label</Label>
          <span className="text-xs text-muted-foreground">
            Caption — 最小サイズのメタ情報。
          </span>
        </div>
      </Section>

      <Section title="Colors">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { name: "background", className: "bg-background" },
            { name: "foreground", className: "bg-foreground" },
            { name: "primary", className: "bg-primary" },
            { name: "secondary", className: "bg-secondary" },
            { name: "muted", className: "bg-muted" },
            { name: "accent", className: "bg-accent" },
            { name: "destructive", className: "bg-destructive" },
            { name: "border", className: "bg-border" },
          ].map((token) => (
            <div key={token.name} className="flex flex-col gap-1.5">
              <div
                className={`h-12 rounded-md border border-border ${token.className}`}
              />
              <span className="text-xs text-muted-foreground">{token.name}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-2">
          <Button>Default</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="link">Link</Button>
          <Button disabled>Disabled</Button>
        </div>
      </Section>

      <Section title="Inputs">
        <div className="flex max-w-sm flex-col gap-2">
          <Label htmlFor="ds-input">Label</Label>
          <Input id="ds-input" placeholder="Add a task..." />
          <div className="flex items-center gap-2">
            <Checkbox id="ds-checkbox" />
            <Label htmlFor="ds-checkbox">Checkbox label</Label>
          </div>
        </div>
      </Section>

      <Section title="Cards">
        <Card className="max-w-sm">
          <CardHeader>
            <CardTitle>Card title</CardTitle>
            <CardDescription>Card description text.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Card content goes here.
          </CardContent>
        </Card>
      </Section>

      <Section title="Dropdown">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline">Open menu</Button>} />
          <DropdownMenuContent align="start">
            <DropdownMenuItem>Edit</DropdownMenuItem>
            <DropdownMenuItem>Duplicate</DropdownMenuItem>
            <DropdownMenuItem>Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Section>

      <Section title="Loading state">
        <div className="flex max-w-sm flex-col gap-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-8 w-full" />
        </div>
      </Section>

      <Section title="Empty state">
        <EmptyState
          icon={InboxIcon}
          title="No items yet"
          description="新しい項目を追加すると、ここに表示されます。"
          action={<Button size="sm">Add item</Button>}
        />
      </Section>

      <Section title="Error state">
        <EmptyState
          icon={TriangleAlertIcon}
          title="Something went wrong"
          description="データの取得に失敗しました。もう一度お試しください。"
          action={
            <Button size="sm" variant="outline">
              Retry
            </Button>
          }
        />
      </Section>
    </div>
  );
}
