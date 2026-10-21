"use client";

import Link from "next/link";
import { useActionState } from "react";
import { login, signup, type AuthFormState } from "@/app/(auth)/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initial: AuthFormState = { error: null };

function Field(props: { id: string; label: string } & React.ComponentProps<typeof Input>) {
  const { id, label, ...input } = props;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={id} {...input} />
    </div>
  );
}

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(login, initial);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>
          Demo login: <span className="font-mono text-foreground">demo@example.com</span> /{" "}
          <span className="font-mono text-foreground">demo1234</span>
        </CardDescription>
      </CardHeader>
      <form action={action}>
        <CardContent className="grid gap-4">
          <input type="hidden" name="next" value={next} />
          {state.error && (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}
          <Field id="email" label="Email" type="email" autoComplete="email" required defaultValue="demo@example.com" />
          <Field id="password" label="Password" type="password" autoComplete="current-password" required />
        </CardContent>
        <CardFooter className="mt-6 flex flex-col gap-3">
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </Button>
          <p className="text-sm text-muted-foreground">
            New here?{" "}
            <Link href="/signup" className="text-foreground underline underline-offset-4">
              Create an account
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}

export function SignupForm() {
  const [state, action, pending] = useActionState(signup, initial);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Create an account</CardTitle>
        <CardDescription>This sets up a new, empty company workspace.</CardDescription>
      </CardHeader>
      <form action={action}>
        <CardContent className="grid gap-4">
          {state.error && (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}
          <Field id="name" label="Your name" autoComplete="name" required />
          <Field id="company" label="Company" autoComplete="organization" required />
          <Field id="email" label="Email" type="email" autoComplete="email" required />
          <Field id="password" label="Password" type="password" autoComplete="new-password" minLength={8} required />
        </CardContent>
        <CardFooter className="mt-6 flex flex-col gap-3">
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Creating account…" : "Create account"}
          </Button>
          <p className="text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login" className="text-foreground underline underline-offset-4">
              Sign in
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
