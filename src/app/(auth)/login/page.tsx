import type { Metadata } from "next";
import { LoginForm } from "@/app/(auth)/auth-forms";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  return <LoginForm next={typeof next === "string" ? next : "/"} />;
}
