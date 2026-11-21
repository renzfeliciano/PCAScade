import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/server/request-context";
import { sceneLabel } from "@/modules/prizes/domain/prizes";
import { listCategories } from "@/modules/prizes/server/categories";
import { moveCategoryAction } from "../actions";
import { ExistingCategory, NewCategoryForm } from "./category-editor";

export const metadata: Metadata = { title: "Prize categories" };

const PROBLEMS: Record<string, string> = {
  locked: "The prize list is frozen for an active raffle. Cancel the raffle preparation to change categories.",
  missing: "That category no longer exists.",
};

export default async function PrizeCategoriesPage({ params, searchParams }: PageProps<"/admin/events/[eventId]/prizes/categories">) {
  await requireAdmin();
  const { eventId } = await params;
  const query = await searchParams;
  const problem = typeof query.problem === "string" ? PROBLEMS[query.problem] : undefined;
  const categories = await listCategories(db(), eventId);

  return (
    <div className="grid gap-5">
      <div>
        <Link href={`/admin/events/${eventId}/prizes`} className="text-sm text-muted-foreground hover:underline">
          ← Prizes
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Categories and reveal scenes</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Each category picks one of the four construction reveal scenes used on the presentation screen. Categories are listed in this order on the public prize page.
        </p>
      </div>

      {problem ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{problem}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid max-w-3xl gap-4">
        {categories.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No categories yet. Prizes without a category use the Brick by Brick scene.
          </p>
        ) : (
          categories.map((category, index) => (
            <section key={category.id} aria-labelledby={`category-${category.id}`} className="grid gap-4 rounded-md border border-border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id={`category-${category.id}`} className="font-semibold">
                  {index + 1}. {category.name} <span className="text-sm font-normal text-muted-foreground">· {sceneLabel(category.sceneKey)}</span>
                </h2>
                <div className="flex gap-1">
                  <form action={moveCategoryAction.bind(null, eventId, category.id, "up")}>
                    <button
                      type="submit"
                      disabled={index === 0}
                      aria-label={`Move ${category.name} up`}
                      className="inline-flex size-8 items-center justify-center rounded-md border border-border hover:bg-secondary disabled:opacity-30"
                    >
                      <ArrowUp className="size-4" aria-hidden="true" />
                    </button>
                  </form>
                  <form action={moveCategoryAction.bind(null, eventId, category.id, "down")}>
                    <button
                      type="submit"
                      disabled={index === categories.length - 1}
                      aria-label={`Move ${category.name} down`}
                      className="inline-flex size-8 items-center justify-center rounded-md border border-border hover:bg-secondary disabled:opacity-30"
                    >
                      <ArrowDown className="size-4" aria-hidden="true" />
                    </button>
                  </form>
                </div>
              </div>
              <ExistingCategory
                eventId={eventId}
                category={{ id: category.id, name: category.name, description: category.description, sceneKey: category.sceneKey, prizeCount: category._count.prizes }}
              />
            </section>
          ))
        )}
        <NewCategoryForm eventId={eventId} />
      </div>
    </div>
  );
}
