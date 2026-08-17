// Phase eBay-1.1: the separate pull-listings step was replaced by the
// auto-categorize flow, which snapshots the queue from eBay live at
// run start. This page now just redirects old bookmarks.

import { redirect } from "next/navigation";

export default function PullRedirect() {
  redirect("/admin/ebay/auto-categorize");
}
