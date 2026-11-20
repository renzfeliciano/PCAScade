import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BrandLockup } from "@/components/brand/brand-mark";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { db } from "@/lib/db";
import { isAdminProvisioned } from "@/modules/auth/server/admin";
import { getAdminSession } from "@/modules/auth/server/request-context";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in" };

function describeError(error: string | undefined, retry: string | undefined): string | null {
  if (error === "invalid") return "That password is not correct.";
  if (error === "missing") return "Enter the administrator password.";
  if (error === "throttled") {
    const seconds = Number(retry);
    const wait = Number.isFinite(seconds) && seconds > 0 ? (seconds >= 120 ? `${Math.ceil(seconds / 60)} minutes` : `${seconds} seconds`) : "a moment";
    return `Too many failed attempts. Try again in ${wait}.`;
  }
  return null;
}

export default async function LoginPage({ searchParams }: PageProps<"/admin/login">) {
  if (await getAdminSession()) redirect("/admin");
  const provisioned = await isAdminProvisioned(db());
  const params = await searchParams;
  const error = describeError(
    typeof params.error === "string" ? params.error : undefined,
    typeof params.retry === "string" ? params.retry : undefined,
  );

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="grid w-full max-w-sm gap-6">
        <div className="hazard-stripe h-1.5 rounded-sm" aria-hidden="true" />
        <BrandLockup />
        <div className="grid gap-1">
          <h1 className="text-2xl font-bold">Administrator sign in</h1>
          <p className="text-sm text-muted-foreground">PCASCADE has one administrator account.</p>
        </div>
        {!provisioned ? (
          <Alert>
            <AlertTitle>No administrator yet</AlertTitle>
            <AlertDescription>
              Create the account from a terminal with <code className="font-mono">npm run admin:bootstrap</code>. There is no sign-up page.
            </AlertDescription>
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <form method="post" action="/api/admin/session" className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" autoComplete="current-password" required autoFocus maxLength={1024} />
          </div>
          <Button type="submit" size="lg" disabled={!provisioned}>
            Sign in
          </Button>
        </form>
      </div>
    </div>
  );
}
