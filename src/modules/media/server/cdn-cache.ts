import { dangerouslyDeleteByTag } from "@vercel/functions";
import type { CachePurger } from "@/modules/media/server/photo-store";

export const purgeCdnCache: CachePurger = async (tags) => {
  if (tags.length === 0) return;
  await dangerouslyDeleteByTag(tags);
};
