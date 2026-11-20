import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const adminFiles = walk(join(ROOT, "src", "app", "admin"));
const apiAdminFiles = walk(join(ROOT, "src", "app", "api", "admin"));

describe("admin authorization guard", () => {
  it("every server action in the admin area authenticates before doing anything else", () => {
    const actionFiles = adminFiles.filter((file) => file.endsWith("actions.ts"));
    expect(actionFiles.length).toBeGreaterThan(0);
    for (const file of actionFiles) {
      const source = readFileSync(file, "utf8");
      expect(source.trimStart().startsWith('"use server"'), `${relative(ROOT, file)} must start with "use server"`).toBe(true);
      const exported = [...source.matchAll(/export async function (\w+)\([^)]*\)[^{]*\{\s*\n\s*([^\n]+)/g)];
      expect(exported.length, `${relative(ROOT, file)} exports no actions`).toBeGreaterThan(0);
      for (const [, name, firstLine] of exported) {
        expect(firstLine, `${relative(ROOT, file)}: ${name} must call requireAdmin() first`).toMatch(/^(const \w+ = )?await requireAdmin\(\);$/);
      }
      expect(source).not.toMatch(/export (const|let|function) /);
    }
  });

  it("every console page checks the session itself instead of trusting the layout", () => {
    const pages = adminFiles.filter((file) => file.includes(`${join("admin", "(console)")}`) && file.endsWith("page.tsx"));
    expect(pages.length).toBeGreaterThanOrEqual(6);
    for (const page of pages) {
      expect(readFileSync(page, "utf8"), relative(ROOT, page)).toMatch(/await requireAdmin\(\)/);
    }
  });

  it("every admin API route rejects cross-origin posts and anonymous reads", () => {
    const routes = apiAdminFiles.filter((file) => file.endsWith("route.ts"));
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      const source = readFileSync(route, "utf8");
      if (/export async function POST/.test(source)) expect(source, relative(ROOT, route)).toMatch(/isSameOriginPost\(request/);
      if (/export async function GET/.test(source)) expect(source, relative(ROOT, route)).toMatch(/if \(!\(await getAdminSession\(\)\)\) return new Response\(null, \{ status: 401/);
      expect(source, relative(ROOT, route)).not.toMatch(/export async function (PUT|PATCH|DELETE)/);
    }
  });

  it("client components never import server-only modules", () => {
    const clientFiles = walk(join(ROOT, "src")).filter((file) => /\.tsx?$/.test(file) && readFileSync(file, "utf8").trimStart().startsWith('"use client"'));
    for (const file of clientFiles) {
      const source = readFileSync(file, "utf8");
      expect(source, relative(ROOT, file)).not.toMatch(/from "@\/(lib\/db|modules\/[\w-]+\/server)/);
    }
  });
});
