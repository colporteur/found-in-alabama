// Centralized links — edit here, used across Header, Footer, and Find Me page.

export type LinkEntry = {
  name: string;
  url: string;
  handle?: string;
  blurb?: string;
};

export const marketplaces: LinkEntry[] = [
  {
    name: "eBay",
    url: "https://www.ebay.com/str/yellowhammeryields",
    handle: "yellowhammeryields",
    blurb:
      "Books, collectibles, ephemera, and harder-to-find pieces. Watch for periodic sales — and we always take offers.",
  },
  {
    name: "Etsy",
    url: "https://www.etsy.com/shop/colporteurfinds",
    handle: "colporteurfinds",
    blurb:
      "Vintage only — paper, advertising, small antiques, and the genuinely old.",
  },
  {
    name: "Poshmark",
    url: "https://poshmark.com/closet/colporteurbooks",
    handle: "@colporteurbooks",
    blurb:
      "Clothing, accessories, and lifestyle. Make offers — and bundle for an extra discount.",
  },
  {
    name: "Mercari",
    url: "https://www.mercari.com/u/colporteur",
    handle: "@colporteur",
    blurb:
      "A bit of everything, fast-moving. Make offers — and bundle for an extra discount.",
  },
  {
    name: "Depop",
    url: "https://www.depop.com/colporteurbooks",
    handle: "@colporteurbooks",
    blurb:
      "Vintage clothing and the unusual. Make offers — and bundle for an extra discount.",
  },
  {
    name: "Whatnot",
    url: "https://www.whatnot.com/user/alabamacollects",
    handle: "@alabamacollects",
    blurb:
      "Live shows and timed-release listings. Follow for stream notifications.",
  },
];

export const socials: LinkEntry[] = [
  {
    name: "Instagram",
    url: "https://www.instagram.com/foundinalabama/",
    handle: "@foundinalabama",
  },
  {
    name: "Facebook",
    url: "https://www.facebook.com/profile.php?id=61590344686773",
    handle: "Found in Alabama",
  },
  {
    name: "Pinterest",
    url: "https://www.pinterest.com/FoundInAlabama/",
    handle: "@FoundInAlabama",
  },
  {
    name: "Bluesky",
    url: "https://bsky.app/profile/foundinalabama.bsky.social",
    handle: "@foundinalabama.bsky.social",
  },
];

export const comingSoonSocials: string[] = [];

export const contact = {
  phone: "256-684-1253",
  phoneTel: "+12566841253",
  smsHref: "sms:+12566841253",
  serviceArea: [
    "Anniston / Oxford",
    "Huntsville",
    "Lineville / Wedowee",
    "Gadsden",
    "Birmingham",
    "Pell City",
    "Auburn / Opelika",
    "Carrollton, GA",
    "Alexander City / Sylacauga / Talladega",
  ],
};
