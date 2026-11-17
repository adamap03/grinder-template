import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// The browser's database endpoint (see src/integrations/supabase/client.ts). The bearer token decides whose rows
// a request can see or change; access rules live in src/lib/notion-db.server.ts.
const Body = z.discriminatedUnion("op", [
  z.object({ op: z.literal("query"), q: z.object({ table: z.string().max(60), action: z.enum(["select", "insert", "update", "upsert", "delete"]) }).passthrough() }),
  z.object({ op: z.literal("rpc"), fn: z.string().max(60), args: z.record(z.unknown()).optional() }),
  z.object({ op: z.literal("upload"), path: z.string().max(400), name: z.string().max(200), type: z.string().max(200), data: z.string().max(15_000_000) }),
  z.object({ op: z.literal("download"), path: z.string().max(400) }),
  z.object({ op: z.literal("remove"), paths: z.array(z.string().max(400)).max(20) }),
  z.object({ op: z.literal("auth"), action: z.enum(["signup", "signin", "password"]), email: z.string().max(254).optional(), password: z.string().max(200).optional() }),
]);

const json = (body: unknown, status = 200) => Response.json(body, { status });

export const Route = createFileRoute("/api/db")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return json({ data: null, error: { message: "Invalid request" } }, 400);
        const b = parsed.data;
        const db = await import("@/lib/notion-db.server");
        try {
          const auth = request.headers.get("authorization") || "";
          const user = auth.startsWith("Bearer ") ? await db.verifyToken(auth.slice(7).trim()) : null;
          if (auth && !user) return json({ data: null, error: { message: "Your session has ended. Sign in again." } }, 401);
          const scope = { uid: user?.id ?? null };
          switch (b.op) {
            case "query":
              return json(await db.execute(b.q as Parameters<typeof db.execute>[0], scope));
            case "rpc":
              return json(await db.rpc(b.fn, b.args ?? {}, scope));
            case "upload":
              return json(await db.uploadFile(scope, b.path, b.name, b.type, b.data));
            case "download":
              return json(await db.downloadFile(scope, b.path));
            case "remove":
              return json(await db.removeFiles(scope, b.paths));
            case "auth": {
              const { clientKey, hit, reset } = await import("@/lib/rate-limit");
              const email = (b.email ?? "").trim().toLowerCase();
              if (b.action !== "password" && (!hit(`auth-ip:${clientKey(request)}`, 20, 15 * 60_000) || !hit(`auth-email:${email}`, 10, 15 * 60_000)))
                return json({ data: null, error: { message: "Too many attempts. Please wait 15 minutes and try again." } }, 429);
              if (b.action === "signup") return json(await db.signUp(b.email ?? "", b.password ?? ""));
              if (b.action === "signin") {
                const r = await db.signIn(b.email ?? "", b.password ?? "");
                if (!r.error) reset(`auth-email:${email}`);
                return json(r);
              }
              if (!user) return json({ data: null, error: { message: "Sign in first." } }, 401);
              return json(await db.changePassword(user.id, b.password ?? ""));
            }
          }
        } catch (e) {
          console.error("api/db:", e);
          // Notion refusing the integration is a setup problem, not a passing outage: say how to fix it.
          if (/^Notion (401|403|404)\b/.test((e as Error).message))
            return json({ data: null, error: { message: "Notion refused access. Check the integration secret is still valid and that the Grinder page is still shared with the integration (••• then Connections)." } }, 500);
          return json({ data: null, error: { message: "The database is unavailable right now. Please retry." } }, 500);
        }
      },
    },
  },
});
