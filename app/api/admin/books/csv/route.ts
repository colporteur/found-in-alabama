// GET /api/admin/books/csv?month=YYYY-MM — the month's sales with fees,
// postage, item cost and profit, for the spreadsheet / tax time.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { monthReport, reportCsv } from "@/lib/books/books";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const month = req.nextUrl.searchParams.get("month") ?? "";
  try {
    const csv = reportCsv(await monthReport(month));
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="fia-books-${month}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
