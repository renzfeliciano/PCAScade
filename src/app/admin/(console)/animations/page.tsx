import type { Metadata } from "next";
import { requireAdmin } from "@/modules/auth/server/request-context";
import { ScenePreview } from "./scene-preview";

export const metadata: Metadata = { title: "Animations" };

export default async function AnimationsPage() {
  await requireAdmin();
  return (
    <div className="grid max-w-5xl gap-6">
      <div className="grid gap-1">
        <h1 className="text-2xl font-bold">Reveal animations</h1>
        <p className="text-sm text-muted-foreground">
          Preview each reveal scene with a sample winner. Open this page on the presentation PC to check the frame rate there, and pin the quality that keeps it smooth.
        </p>
      </div>
      <ScenePreview />
    </div>
  );
}
