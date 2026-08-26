import type { USER_ROLES } from "@/worker/db/auth-schema";

export type UserRole = (typeof USER_ROLES)[number];

/** A row of the account directory. Only administrators and owners can read it. */
export type Account = { id: string; name: string; email: string; role: UserRole };

/**
 * What each role is called on screen, weakest first.
 *
 * `owner` is the instance's owner. A project's owner is a different thing at a
 * different scope, and the project screens say プロジェクトの作成者 for that
 * one so the two words never have to mean both.
 */
export const ROLE_LABELS: Record<UserRole, string> = {
  member: "ユーザー",
  admin: "管理者",
  owner: "オーナー",
};

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  member: "自分が作ったプロジェクトと、招待されたプロジェクトだけ",
  admin: "すべてのプロジェクトの参加者を変更できる。ユーザーの追加も可能",
  owner: "管理者ができることすべてに加えて、管理者とオーナーを任命できる",
};
