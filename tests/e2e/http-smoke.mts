import { config } from "dotenv";
import { createDb } from "@/lib/db";
import { changeEventStatus, createEvent } from "@/modules/events/server/events";
import { eventInputSchema } from "@/modules/events/domain/event-rules";

config({ path: ".env.test", quiet: true });

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3100";
const PASSWORD = process.env.SMOKE_ADMIN_PASSWORD ?? "";

type Check = { name: string; ok: boolean; detail: string };
const checks: Check[] = [];

function check(name: string, ok: boolean, detail: string) {
  checks.push({ name, ok, detail });
}

async function get(path: string, cookie?: string) {
  return fetch(`${BASE}${path}`, { redirect: "manual", headers: cookie ? { cookie } : {} });
}

async function postForm(path: string, body: Record<string, string>, headers: Record<string, string>) {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(body).toString(),
  });
}

async function main() {
  if (!PASSWORD) throw new Error("Set SMOKE_ADMIN_PASSWORD to the administrator password of the target database.");
  const database = createDb(process.env.TEST_DATABASE_URL ?? "");
  const input = (name: string) => eventInputSchema.parse({ name, description: "Smoke test", venue: "Test site", welcomeMessage: "", accent: "blueprint-blue", startsAt: "" });
  const published = await createEvent(database, input("Smoke Published Event"));
  await changeEventStatus(database, published.id, "PUBLISHED", async () => {});
  const draft = await createEvent(database, input("Smoke Draft Event"));

  for (const path of ["/", "/events", "/about", `/events/${published.slug}`, `/presentation/${published.slug}`]) {
    const response = await get(path);
    check(`public ${path}`, response.status === 200, `HTTP ${response.status}`);
  }
  for (const path of [`/events/${draft.slug}`, `/presentation/${draft.slug}`, `/presentation/${draft.id}`]) {
    const response = await get(path);
    check(`draft hidden ${path}`, response.status === 404, `HTTP ${response.status}`);
  }
  const home = await (await get("/")).text();
  check("home lists published, hides draft", home.includes("Smoke Published Event") && !home.includes("Smoke Draft Event"), "content check");

  for (const path of [`/api/admin/media/${draft.id}`, `/api/admin/events/${draft.id}/imports/${draft.id}/report`]) {
    const response = await get(path);
    check(`anonymous ${path.split("/").slice(0, 4).join("/")} refused`, response.status === 401, `HTTP ${response.status}`);
  }

  for (const path of [
    "/admin",
    "/admin/events",
    "/admin/events/new",
    `/admin/events/${draft.id}`,
    "/admin/audit-logs",
    "/admin/settings",
    "/admin/participants",
    "/admin/imports",
    `/admin/events/${draft.id}/participants`,
    `/admin/events/${draft.id}/fields`,
    `/admin/events/${draft.id}/imports/new`,
  ]) {
    const response = await get(path);
    const location = response.headers.get("location") ?? "";
    check(`anonymous ${path} redirected`, [303, 307, 308].includes(response.status) && location.endsWith("/admin/login"), `HTTP ${response.status} -> ${location}`);
  }

  const noOrigin = await postForm("/api/admin/session", { password: PASSWORD }, { accept: "application/json" });
  check("login without Origin refused", noOrigin.status === 403 && !noOrigin.headers.get("set-cookie"), `HTTP ${noOrigin.status}`);
  const evil = await postForm("/api/admin/session", { password: PASSWORD }, { accept: "application/json", origin: "https://evil.example" });
  check("cross-origin login refused", evil.status === 403 && !evil.headers.get("set-cookie"), `HTTP ${evil.status}`);
  const wrong = await postForm("/api/admin/session", { password: "definitely wrong" }, { accept: "application/json", origin: BASE });
  check("wrong password refused", wrong.status === 401 && !wrong.headers.get("set-cookie"), `HTTP ${wrong.status}`);

  const login = await postForm("/api/admin/session", { password: PASSWORD }, { accept: "application/json", origin: BASE });
  const setCookie = login.headers.get("set-cookie") ?? "";
  check("login succeeds", login.status === 200, `HTTP ${login.status}`);
  check(
    "session cookie flags",
    /^__Host-pcascade-session=[A-Za-z0-9_-]{43};/.test(setCookie) && /HttpOnly/i.test(setCookie) && /Secure/i.test(setCookie) && /SameSite=lax/i.test(setCookie) && /Path=\//.test(setCookie),
    setCookie.replace(/=[A-Za-z0-9_-]{43}/, "=<token>"),
  );
  const cookie = setCookie.split(";")[0] ?? "";

  for (const path of [
    "/admin",
    "/admin/events",
    `/admin/events/${draft.id}`,
    "/admin/audit-logs",
    "/admin/settings",
    "/admin/participants",
    "/admin/imports",
    `/admin/events/${draft.id}/participants`,
    `/admin/events/${draft.id}/participants/new`,
    `/admin/events/${draft.id}/fields`,
    `/admin/events/${draft.id}/imports`,
    `/admin/events/${draft.id}/imports/new`,
  ]) {
    const response = await get(path, cookie);
    check(`signed-in ${path}`, response.status === 200, `HTTP ${response.status}`);
  }
  const audit = await (await get("/admin/audit-logs", cookie)).text();
  check("audit page reports intact chain", audit.includes("Chain intact"), audit.includes("Chain broken") ? "chain broken" : "ok");
  const login2 = await get("/admin/login", cookie);
  check("login page redirects when signed in", [303, 307].includes(login2.status), `HTTP ${login2.status}`);

  const evilLogout = await postForm("/api/admin/session/logout", {}, { cookie, origin: "https://evil.example" });
  check("cross-origin logout refused", evilLogout.status === 403, `HTTP ${evilLogout.status}`);
  const logout = await postForm("/api/admin/session/logout", {}, { cookie, origin: BASE });
  check("logout", logout.status === 303 && /Max-Age=0/i.test(logout.headers.get("set-cookie") ?? ""), `HTTP ${logout.status}`);
  const after = await get("/admin", cookie);
  check("old cookie rejected after logout", [303, 307].includes(after.status), `HTTP ${after.status}`);

  await database.$disconnect();
  for (const result of checks) console.log(`${result.ok ? "PASS" : "FAIL"}  ${result.name}  (${result.detail})`);
  console.log(`${checks.filter((result) => result.ok).length}/${checks.length} passed`);
  if (checks.some((result) => !result.ok)) process.exitCode = 1;
}

void main();
