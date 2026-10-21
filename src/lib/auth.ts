import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { SESSION_COOKIE } from "@/lib/session-cookie";

// Simple email/password auth with database sessions. The cookie holds a random
// token; only its sha256 is stored, so a database leak doesn't leak sessions.

const SESSION_DAYS = 30;

export interface SessionUser {
  userId: string;
  organizationId: string;
  organizationName: string;
  email: string;
  name: string;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createSession(user: { id: string; organizationId: string }): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.session.create({
    data: {
      tokenHash: hashToken(token),
      userId: user.id,
      organizationId: user.organizationId,
      expiresAt,
    },
  });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.SESSION_COOKIE_SECURE,
    path: "/",
    expires: expiresAt,
  });
}

/** The signed-in user for this request, or null. Cached per request. */
export const getSession = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true, organization: true },
  });
  if (!session || session.expiresAt.getTime() < Date.now()) return null;
  return {
    userId: session.userId,
    organizationId: session.organizationId,
    organizationName: session.organization.name,
    email: session.user.email,
    name: session.user.name,
  };
});

/** For pages and server actions: redirects to /login when signed out. */
export async function requireSession(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  jar.delete(SESSION_COOKIE);
}
