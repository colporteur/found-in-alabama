// GET /api/admin/newsletter/subscribers/export
//
// CSV download of every confirmed subscriber. Backup / migration tool.
// Returns text/csv; the admin UI links to it with a download attribute.

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, newsletterSubscribers } from "@/db";
import { desc, eq } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function csvEscape(s: string): string {
  if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const rows = await db
    .select({
      email: newsletterSubscribers.email,
      status: newsletterSubscribers.status,
      source: newsletterSubscribers.source,
      confirmedAt: newsletterSubscribers.confirmedAt,
      createdAt: newsletterSubscribers.createdAt,
    })
    .from(newsletterSubscribers)
    .where(eq(newsletterSubscribers.status, "confirmed"))
    .orderBy(desc(newsletterSubscribers.confirmedAt));

  const lines: string[] = ["email,status,source,confirmed_at,created_at"];
  for (const r of rows) {
    lines.push(
      [
        csvEscape(r.email),
        csvEscape(r.status),
        csvEscape(r.source ?? ""),
        r.confirmedAt ? new Date(r.confirmedAt).toISOString() : "",
        r.createdAt ? new Date(r.createdAt).toISOString() : "",
      ].join(",")
    );
  }
  const csv = lines.join("\n") + "\n";
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="newsletter-subscribers-${stamp}.csv"`,
    },
  });
}
