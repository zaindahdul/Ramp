"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createSession, destroySession, hashPassword, verifyPassword } from "@/lib/auth";
import { db, isUniqueViolation } from "@/lib/db";

export interface AuthFormState {
  error: string | null;
}

/** Only allow same-site relative redirects after login. */
function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

export async function login(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = LoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: "Enter your email and password." };

  const user = await db.user.findUnique({ where: { email: parsed.data.email } });
  // Same message either way, so the form doesn't reveal which emails exist.
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return { error: "That email and password don't match." };
  }
  await createSession(user);
  redirect(safeNext(formData.get("next")));
}

const SignupSchema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(100),
  company: z.string().trim().min(1, "Enter your company name.").max(200),
  email: z.string().trim().toLowerCase().email("Enter a valid email."),
  password: z.string().min(8, "Use at least 8 characters for the password."),
});

export async function signup(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = SignupSchema.safeParse({
    name: formData.get("name"),
    company: formData.get("company"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };

  const { name, company, email, password } = parsed.data;
  const passwordHash = await hashPassword(password);
  let user;
  try {
    user = await db.$transaction(async (tx) => {
      const organization = await tx.organization.create({ data: { name: company } });
      return tx.user.create({
        data: { organizationId: organization.id, email, name, passwordHash },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { error: "An account with that email already exists." };
    throw error;
  }
  await createSession(user);
  redirect("/");
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/login");
}
