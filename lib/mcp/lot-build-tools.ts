// Lot Builder (connector side): the tools that let Claude in the Claude app
// sort a batch Todd sent to the Lot Builder (lib/listings/lot-build.ts) —
// look at numbered contact sheets, say what each piece is, flag pulls and
// pieces that need another photo, and propose numbered lots. Offered only on
// connections where Todd turned listing writing on. Nothing here combines,
// approves or publishes anything: Todd builds the lots from the Lot Builder
// page, and they then come through listing_queue like any other draft.

import { argStr, rawContent, type ToolDef } from "./protocol";
import { claudeBuildIdentify, claudeBuildList, claudeBuildPacket, claudeBuildPiece, claudeBuildPlan, claudeBuildSheet } from "@/lib/listings/lot-build";

export function lotBuildTools(who: string): ToolDef[] {
  return [
    {
      name: "lot_build_list",
      title: "Lot Builder sessions",
      description:
        "Todd's open Lot Builder sessions: big batches of one item type (LP records, sewing patterns…) he already knows are lot material and wants sorted into smaller lots. Shows how many pieces each has, how many are waiting for your look, pulls, pieces needing a photo, and lots proposed or built.",
      inputSchema: { type: "object", properties: {} },
      run: async () => claudeBuildList(),
    },
    {
      name: "lot_build_get",
      title: "Open a Lot Builder session",
      description:
        "Everything about one session, as text: the sorting rules, every piece (number, identification, value alone, verdict, lot, whether it's waiting for your look), the lots so far, and the Expert Guide(s) for the item type — the guide decides what to pull and the type and size of lot. Read it first, then look at the pieces with lot_build_sheet.",
      inputSchema: { type: "object", properties: { build_id: { type: "string" } }, required: ["build_id"] },
      run: async (a) => rawContent(await claudeBuildPacket(argStr(a, "build_id", 40) ?? "")),
    },
    {
      name: "lot_build_sheet",
      title: "Contact sheets of a session's pieces",
      description:
        "Numbered contact sheets of the pieces' front photos (the badge on a tile is the piece number), up to two sheets per call. Work through the session from=1 upward; the reply says where to continue. Use per=4–6 when the pieces carry small text you need to read, 9–16 to move fast. only: 'sorting' (default: pieces not yet built or pulled), 'needs_look' (never looked at, or Todd added a photo), 'all'.",
      inputSchema: {
        type: "object",
        required: ["build_id"],
        properties: {
          build_id: { type: "string" },
          from: { type: "number", default: 1, description: "First piece number to show" },
          count: { type: "number", default: 18, description: "How many pieces (max 32)" },
          per: { type: "number", default: 9, description: "Pieces per sheet (2–16)" },
          only: { type: "string", enum: ["sorting", "needs_look", "all"], default: "sorting" },
        },
      },
      run: async (a) => {
        const only = a.only === "all" || a.only === "needs_look" ? a.only : "sorting";
        return rawContent(await claudeBuildSheet(argStr(a, "build_id", 40) ?? "", Number(a.from ?? 1), Number(a.count ?? 18), Number(a.per ?? 9), only));
      },
    },
    {
      name: "lot_build_piece",
      title: "One piece's photos, full size",
      description:
        "All of one piece's own photos at full size (up to 8) — when its tile on the contact sheet is too small to read, or after Todd added the photo you asked for.",
      inputSchema: { type: "object", required: ["build_id", "n"], properties: { build_id: { type: "string" }, n: { type: "number", description: "Piece number" } } },
      run: async (a) => rawContent(await claudeBuildPiece(argStr(a, "build_id", 40) ?? "", Number(a.n))),
    },
    {
      name: "lot_build_identify",
      title: "Save what pieces are, and pull / photo alerts",
      readOnly: false,
      description:
        "Save your read of pieces (many per call): identification (what a buyer would search), est_value_usd (what it would sell for alone, from the Expert Guide's bands) and a verdict — 'lot' (stays lot material), 'pull' (earns its own listing; reason required — Todd sees it as an alert) or 'need_photo' (the photo doesn't settle what it is or whether it's a pull; photo_request required: exactly what to photograph). Pieces Todd decided himself keep his verdict. Only Todd's Lot Builder page changes; nothing is combined or listed.",
      inputSchema: {
        type: "object",
        required: ["build_id", "pieces"],
        properties: {
          build_id: { type: "string" },
          pieces: {
            type: "array",
            minItems: 1,
            maxItems: 80,
            items: {
              type: "object",
              required: ["n"],
              properties: {
                n: { type: "number", description: "Piece number" },
                identification: { type: "string", description: "One line: e.g. artist – title, label + catalogue no., format" },
                est_value_usd: { type: "number" },
                verdict: { type: "string", enum: ["lot", "pull", "need_photo"] },
                reason: { type: "string", description: "Required for pull: why it sells better alone (name the guide rule)" },
                photo_request: { type: "string", description: "Required for need_photo: exactly what to photograph" },
              },
            },
          },
        },
      },
      run: async (a) => claudeBuildIdentify(argStr(a, "build_id", 40) ?? "", a.pieces, who),
    },
    {
      name: "lot_build_plan",
      title: "Propose the lots",
      readOnly: false,
      description:
        "Propose (or revise) the session's lots: each with a name (the theme a buyer would search), the piece numbers, a reason naming the Expert Guide rule behind its type and size, and a suggested lot price. Leave 'no' out for a new lot (FIA gives it the next number — the numbers are Todd's physical piles and are never reused); send 'no' to revise a lot, which then holds exactly the pieces you send plus any Todd placed there. Lots not in the call are left as they are. A piece goes in one lot; pieces Todd placed, and built or pulled pieces, stay put (the reply lists them). A lot has 2–60 pieces. note: a short summary for Todd (what the guide said about lot size, anything left unplaced and why). Nothing is combined — Todd builds the lots from the Lot Builder page.",
      inputSchema: {
        type: "object",
        required: ["build_id"],
        properties: {
          build_id: { type: "string" },
          lots: {
            type: "array",
            maxItems: 60,
            items: {
              type: "object",
              required: ["name", "pieces"],
              properties: {
                no: { type: "number", description: "Existing lot number, to revise it" },
                name: { type: "string" },
                pieces: { type: "array", items: { type: "number" }, maxItems: 60 },
                reason: { type: "string" },
                suggested_price: { type: "number" },
                guide_id: { type: "string", description: "The Expert Guide the lot's shape came from" },
              },
            },
          },
          note: { type: "string" },
        },
      },
      run: async (a) => claudeBuildPlan(argStr(a, "build_id", 40) ?? "", a, who),
    },
  ];
}
