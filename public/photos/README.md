# Photos folder

Drop the photos you sent me into this folder (or `public/` for the logo)
before deploying. The pages reference these specific filenames — name
them exactly as below and the site will pick them up.

## Logo (top priority — used on every page)

Save this in `public/`, NOT in `public/photos/`:

- `public/logo.png` — the yellow Alabama silhouette with "Found in
  Alabama" inside. Either of the two PNGs you sent works. Used in the
  site header on every page.

## Brand photos (used on specific pages)

Save these in `public/photos/`:

- `business-card.jpg` — the yellow Alabama "Get cash for:" card.
  Used on: home hero (alternate), We Buy page accent.
- `workspace.jpg` — the shipping/packing area photo.
  Used on: About page, optional home page accent.
- `estate-haul.jpg` — the back-room boxes and items.
  Used on: We Buy page hero.
- `bookshelf.jpg` — the shelves of books.
  Used on: Find Me page accent (optional).
- `christmas-collectibles.jpg` — the cookie jar / Santa figurines shelf.
  Used on: optional category-feature accent.

## Journal post photos

Save these in `public/photos/posts/`. The example posts in
`content/posts/` reference filenames starting with `example-`. When
you replace the example posts with real ones, name your photos to match
your post slug — e.g. for a haul post named `anniston-doctor-estate.md`,
use photos like `anniston-doctor-estate-hero.jpg` and
`anniston-doctor-estate-table.jpg`.

## Sizing

Web-friendly: long edge between 1600 and 2400 pixels.
JPEG quality 80 is plenty.

If you want to optimize, use https://squoosh.app — drag in, export at MozJPEG q80,
re-save with the same filename.

## Once placed

`git add public/photos/* && git commit -m "Add brand photos"`
then push and Vercel will rebuild automatically.
