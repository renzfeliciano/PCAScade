import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdmin } from "@/modules/auth/server/request-context";
import { PasswordForm } from "./password-form";

export const metadata: Metadata = { title: "Settings" };

const timeFormat = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" });

export default async function SettingsPage() {
  const session = await requireAdmin();
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">This session expires {timeFormat.format(session.expiresAt)} at the latest, or after 8 hours without activity.</p>
      </div>
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Administrator password</CardTitle>
          <CardDescription>If the password is lost, reset it from a terminal with npm run admin:bootstrap -- --reset.</CardDescription>
        </CardHeader>
        <CardContent>
          <PasswordForm />
        </CardContent>
      </Card>
    </div>
  );
}
