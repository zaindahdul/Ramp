import { connection } from "next/server";
import { cache } from "react";
import { db, isUniqueViolation } from "@/lib/db";
import { DEMO_EMAIL, DEMO_USER_NAME } from "@/lib/demo";

// There is no sign-in. The app opens straight into one workspace: the demo
// organization that `pnpm seed` creates, or an empty one made on first use.
//
// Everything else still treats the organization as a tenant. Every table
// carries organizationId, every query filters by it, and every change records
// this user as its actor. Putting sign-in back means changing this one function
// to read the user from a session instead.

export interface CurrentUser {
  userId: string;
  organizationId: string;
  organizationName: string;
  email: string;
  name: string;
}

const include = { organization: true } as const;

async function createWorkspace() {
  try {
    return await db.user.create({
      data: { email: DEMO_EMAIL, name: DEMO_USER_NAME, organization: { create: { name: "My workspace" } } },
      include,
    });
  } catch (error) {
    // Another request created it first.
    if (isUniqueViolation(error)) return db.user.findUniqueOrThrow({ where: { email: DEMO_EMAIL }, include });
    throw error;
  }
}

/** The user and organization every page, action and API route runs as. Cached per request. */
export const currentUser = cache(async (): Promise<CurrentUser> => {
  // Pages read live data from Postgres, so they must render per request, never at build time.
  await connection();
  const user =
    (await db.user.findUnique({ where: { email: DEMO_EMAIL }, include })) ??
    (await db.user.findFirst({ orderBy: [{ createdAt: "asc" }, { id: "asc" }], include })) ??
    (await createWorkspace());
  return {
    userId: user.id,
    organizationId: user.organizationId,
    organizationName: user.organization.name,
    email: user.email,
    name: user.name,
  };
});
