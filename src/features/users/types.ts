import type { USER_ROLES } from "@/worker/db/auth-schema";

export type UserRole = (typeof USER_ROLES)[number];

/** A row of the account directory. Only administrators can read it. */
export type Account = { id: string; name: string; email: string; role: UserRole };
