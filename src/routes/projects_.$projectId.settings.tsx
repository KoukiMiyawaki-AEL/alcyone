import { Link, createFileRoute, notFound, redirect, useRouter } from "@tanstack/react-router";
import { TriangleAlertIcon, UserMinusIcon, UserPlusIcon } from "lucide-react";
import { useState } from "react";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { addMember, addMemberByEmail, removeMember } from "@/features/projects/members-api";
import type { Project } from "@/features/projects/types";
import { LabelManager } from "@/features/todos/components/LabelManager";
// Aliased: `Label` is already the form-label component in this file.
import type { Label as TaskLabel } from "@/features/todos/types";
import { apiClient } from "@/lib/api-client";

const TRANSIENT = "プロジェクトの設定を取得できませんでした。";

type Member = { id: number; userId: string; name: string; email: string };
type Account = { id: string; name: string; email: string; role: string };

type LoaderData = {
  project: Project | null;
  labels: TaskLabel[];
  owner: { id: string } | null;
  members: Member[];
  /** Whether *this* caller may change the list, as reported by the server. */
  canManage: boolean;
  /** Only administrators receive one; everyone else gets an empty list. */
  directory: Account[];
  error: string | null;
};

export const Route = createFileRoute("/projects_/$projectId/settings")({
  beforeLoad: ({ context, location }) => {
    if (context.auth.isPending) return;
    if (!context.auth.user) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
  },
  loader: async ({ params }): Promise<LoaderData> => {
    let res;
    try {
      res = await apiClient.api.projects[":projectId"].members.$get({
        param: { projectId: params.projectId },
      });
    } catch {
      // Network failure only — `notFound()` and `redirect()` throw, so raising
      // either in here would be swallowed into the generic error card.
      return {
        project: null,
        labels: [],
        owner: null,
        members: [],
        canManage: false,
        directory: [],
        error: TRANSIENT,
      };
    }

    if (res.status === 401) {
      throw redirect({
        to: "/login",
        search: { redirect: `/projects/${params.projectId}/settings` },
      });
    }
    if (res.status === 404 || res.status === 400) throw notFound();
    if (!res.ok) {
      return {
        project: null,
        labels: [],
        owner: null,
        members: [],
        canManage: false,
        directory: [],
        error: TRANSIENT,
      };
    }

    const { owner, members, canManage } = await res.json();

    // Two more requests, both optional: the page is about the member list and
    // works without either. The project is fetched for its name, the directory
    // only matters to whoever may actually change the list.
    const [projectAndLabels, directory] = await Promise.all([
      loadProject(params.projectId),
      canManage ? loadDirectory() : Promise.resolve([]),
    ]);

    return {
      project: projectAndLabels.project,
      labels: projectAndLabels.labels,
      owner,
      members,
      canManage,
      directory,
      error: null,
    };
  },
  component: ProjectSettingsComponent,
  notFoundComponent: () => (
    <EmptyState
      icon={TriangleAlertIcon}
      title="Project not found"
      description="お探しのプロジェクトは存在しません。"
    />
  ),
});

/**
 * The project's name and its labels, from one request.
 *
 * `limit: 1` because neither is about the tasks — the endpoint returns the
 * project and the whole label set alongside whatever page of tasks was asked
 * for, and one row is the smallest page there is.
 */
async function loadProject(
  projectId: string,
): Promise<{ project: Project | null; labels: TaskLabel[] }> {
  try {
    const res = await apiClient.api.projects[":projectId"].todos.$get({
      param: { projectId },
      query: { limit: "1" },
    });
    if (!res.ok) return { project: null, labels: [] };

    const body = await res.json();
    return { project: body.project as Project, labels: body.labels as TaskLabel[] };
  } catch {
    return { project: null, labels: [] };
  }
}

async function loadDirectory(): Promise<Account[]> {
  try {
    const res = await apiClient.api.users.$get();
    return res.ok ? ((await res.json()) as Account[]) : [];
  } catch {
    return [];
  }
}

function ProjectSettingsComponent() {
  const router = useRouter();
  const { projectId } = Route.useParams();
  const { project, labels, owner, members, canManage, directory, error } = Route.useLoaderData();
  const [picked, setPicked] = useState("");
  const [email, setEmail] = useState("");

  // Everyone who is not already on it. The owner is not a member row, so they
  // are excluded here rather than by the server refusing later.
  const invitable = directory.filter(
    (account) => account.id !== owner?.id && !members.some((m) => m.userId === account.id),
  );

  if (error) {
    return (
      <EmptyState
        icon={TriangleAlertIcon}
        title="Something went wrong"
        description={error}
        action={
          <Button size="sm" variant="outline" onClick={() => router.invalidate()}>
            Retry
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={project?.name ?? "プロジェクト設定"}
        description="参加者を管理します"
        actions={
          <Button
            size="sm"
            variant="outline"
            render={<Link to="/projects/$projectId" params={{ projectId }} />}
          >
            タスクに戻る
          </Button>
        }
      />

      <LabelManager
        projectId={projectId}
        labels={labels}
        onChanged={async () => {
          await router.invalidate();
        }}
      />

      <Card>
        <CardHeader>
          <CardTitle>参加者</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ul className="flex flex-col gap-2">
            <li className="flex items-center gap-3 text-sm">
              <span className="font-medium">オーナー</span>
              {/*
                Named as a role rather than listed among the members: their
                access comes from the project, not from a row that could be
                removed.
              */}
              <span className="text-muted-foreground">プロジェクトの作成者</span>
            </li>
            {members.map((member) => (
              <li key={member.id} className="flex items-center gap-3 text-sm">
                <span>{member.name}</span>
                <span className="truncate text-xs text-muted-foreground">{member.email}</span>
                {canManage ? (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="ml-auto"
                    aria-label={`${member.name} を解除`}
                    onClick={async () => {
                      if (await removeMember(projectId, member.userId)) await router.invalidate();
                    }}
                  >
                    <UserMinusIcon className="size-4" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>

          {members.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              まだ誰も参加していません。オーナーだけがこのプロジェクトを見られます。
            </p>
          ) : null}

          {/*
            Shown only to whoever may actually use it, and the server decides
            who that is — a client that re-derives the rule ends up offering a
            button the API refuses.
          */}
          {canManage ? (
            <div className="flex flex-col gap-4 border-t border-border pt-4">
              {/*
                The address field, not the picker, is the one everyone gets.
                Reading the directory is an administrator's privilege, so an
                owner would otherwise be looking at an empty list with no way to
                invite the person they already have in mind.
              */}
              <form
                aria-label="参加者を追加"
                className="flex flex-wrap items-end gap-2"
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (email.trim() === "") return;
                  if (await addMemberByEmail(projectId, email.trim())) {
                    setEmail("");
                    await router.invalidate();
                  }
                }}
              >
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label htmlFor="member-email">メールアドレスで追加</Label>
                  <Input
                    id="member-email"
                    type="email"
                    autoComplete="off"
                    placeholder="person@example.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </div>
                <Button type="submit" disabled={email.trim() === ""}>
                  <UserPlusIcon className="size-4" />
                  追加
                </Button>
              </form>

              {/*
                An administrator already has the list, so they get to pick from
                it instead of retyping an address they can see.
              */}
              {invitable.length > 0 ? (
                <div className="flex flex-wrap items-end gap-2">
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Label htmlFor="member-picker">一覧から追加</Label>
                    <Select
                      items={invitable.map((a) => ({
                        value: a.id,
                        label: `${a.name}（${a.email}）`,
                      }))}
                      value={picked}
                      onValueChange={(value) => setPicked(String(value))}
                    >
                      <SelectTrigger id="member-picker" className="w-full">
                        <SelectValue placeholder="選択してください" />
                      </SelectTrigger>
                      <SelectContent>
                        {invitable.map((account) => (
                          <SelectItem key={account.id} value={account.id}>
                            {account.name}（{account.email}）
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    variant="outline"
                    disabled={picked === ""}
                    onClick={async () => {
                      if (await addMember(projectId, picked)) {
                        setPicked("");
                        await router.invalidate();
                      }
                    }}
                  >
                    <UserPlusIcon className="size-4" />
                    追加
                  </Button>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="border-t border-border pt-4 text-sm text-muted-foreground">
              参加者を変更できるのは、プロジェクトのオーナーと管理者だけです。
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
