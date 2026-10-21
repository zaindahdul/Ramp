import type { Metadata } from "next";
import { SignupForm } from "@/app/(auth)/auth-forms";

export const metadata: Metadata = { title: "Create an account" };

export default function SignupPage() {
  return <SignupForm />;
}
