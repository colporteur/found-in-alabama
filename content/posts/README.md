# Writing a journal post

Each post is a single `.md` (markdown) file in this folder. The filename
becomes the URL slug — `anniston-doctor-estate.md` → `/journal/anniston-doctor-estate`.

The top of each file is "frontmatter" — fields between two `---` lines —
followed by the post body in markdown.

## Three post types

### Haul

For "look what we just pulled out of an estate" posts.

```markdown
---
title: "Estate of a retired Anniston physician"
date: "2026-04-22"
type: "haul"
hero: "/photos/posts/anniston-doctor-estate-hero.jpg"
excerpt: "Three generations of carefully kept things..."
featured: true
items:
  - title: "Heywood-Wakefield walnut end table"
    image: "/photos/posts/anniston-doctor-estate-table.jpg"
    links:
      ebay: "https://www.ebay.com/itm/12345"
      etsy: "https://www.etsy.com/listing/67890"
  - title: "Atomic-print armchair pair"
    image: "/photos/posts/anniston-doctor-estate-chairs.jpg"
    links:
      ebay: "https://www.ebay.com/itm/45678"
    sold: true
---

Story body in markdown here. **Bold**, *italics*, [links](https://example.com),
> blockquotes, and lists all work normally.
```

Set `sold: true` on an item once it sells — it'll grey out and the
marketplace links disappear.

### Live sale

For "we're going live on Whatnot" announcements.

```markdown
---
title: "Whatnot live show — Saturday May 17 at 7pm CT"
date: "2026-05-12"
type: "live-sale"
hero: "/photos/posts/may-17-show-hero.jpg"
excerpt: "Vintage paper, postcards, advertising, and oddities."
streamDate: "2026-05-17T19:00:00-05:00"
streamUrl: "https://www.whatnot.com/live/abc123"
---

Body explaining what'll be in the show.
```

`streamDate` is ISO format — `YYYY-MM-DDTHH:MM:SS-05:00` (the `-05:00`
is Central Time; use `-06:00` for Mountain etc.).

### Travel

For "we'll be in [city] on [dates]" picker-appointment announcements.

```markdown
---
title: "Picker appointments in Mobile — June 12-14"
date: "2026-06-01"
type: "travel"
hero: "/photos/posts/mobile-june-hero.jpg"
excerpt: "We'll be in the Mobile area for three days..."
city: "Mobile, AL"
dateStart: "2026-06-12"
dateEnd: "2026-06-14"
---

Body explaining what you're hunting for and how to set up an appointment.
```

## Publishing flow

1. Write the new `.md` file in this folder.
2. Drop any photos into `public/photos/posts/`.
3. `git add . && git commit -m "Add post: <slug>" && git push`
4. Vercel auto-deploys in about a minute.

## Tips

- The `featured: true` flag is used by future versions of the home
  page — for now it doesn't change anything.
- Posts sort newest-first by `date`.
- Excerpt should be one sentence — it shows on the journal index and
  in social-media previews.
- Hero image: 1600–2000px on the long edge, JPEG quality 80, optimize
  at https://squoosh.app.
