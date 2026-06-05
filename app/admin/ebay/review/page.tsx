// Phase eBay-1.1: the manual review/approve queue was replaced by the
// auto-categorize flow. This page now just redirects old bookmarks.

import { redirect } from "next/navigation";

export default function ReviewRedirect() {
  redirect("/admin/ebay/auto-categorize");
}
