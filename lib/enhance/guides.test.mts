import { routeGuides, guideSection, ITEM_SPECIFICS_HEADING, isFamilySelection, familyOfSelection, type GuideMeta } from "./guides";

const g = (id: string, family: string, parent: string | null, keywords: string[]): GuideMeta => ({
  id, name: id, file: id + ".md", keywords, family, parent, stage: "list", priority: 1, description: "", updated: null,
});

const POOL: GuideMeta[] = [
  g("postcard-guide", "Postcards", null, ["postcard","post card","rppc","real photo","linen","chrome","curt teich","tichnor","dexter","plastichrome","petley","greetings from","large letter"]),
  g("holiday", "Postcards", "postcard-guide", ["halloween postcard","christmas postcard","santa","valentine postcard","easter postcard","winsch","clapsaddle","embossed holiday"]),
  g("linen", "Postcards", "postcard-guide", ["linen postcard","curt teich","ct art-colortone","tichnor","colourpicture","kropp","metrocraft","large letter","greetings from"]),
  g("chrome", "Postcards", "postcard-guide", ["chrome postcard","dexter press","mike roberts","plastichrome","curteichcolor","view postcard","glossy postcard"]),
  g("southwest", "Postcards", "postcard-guide", ["native american postcard","navajo","hopi","pueblo","taos","adobe","santa fe","new mexico","arizona","fred harvey","petley"]),
  g("rppc", "Postcards", "postcard-guide", ["rppc","real photo postcard","azo","velox","cyko","stamp box","divided back"]),
  g("vintage-photo-guide", "Photographs", null, ["vintage photo","photograph","snapshot","kodak","1950s","press photo"]),
  g("cabinet-cards", "Photographs", "vintage-photo-guide", ["cabinet card","cdv","carte de visite","tintype","albumen","studio portrait","backmark"]),
];
const POSTCARDS = POOL.filter((x) => x.family === "Postcards");

let n = 0, bad = 0;
function t(label: string, pool: GuideMeta[], text: string, want: string[]) {
  n++;
  const got = routeGuides(pool, text).map((x) => x.id).sort().join(",");
  const exp = [...want].sort().join(",");
  if (got === exp) { console.log("PASS " + label); return; }
  bad++; console.log("FAIL " + label + "\n   got  [" + got + "]\n   want [" + exp + "]");
}

t("linen title in the Postcards family", POSTCARDS,
  "vintage linen postcard greetings from mobile alabama curt teich", ["postcard-guide", "linen"]);
t("santa is not santa fe", POSTCARDS,
  "antique christmas postcard santa embossed holiday winsch", ["postcard-guide", "holiday"]);
t("santa fe routes southwest", POSTCARDS,
  "santa fe new mexico adobe pueblo petley postcard", ["postcard-guide", "southwest"]);
t("family gate across both families", POOL,
  "1890s cabinet card studio portrait backmark", ["vintage-photo-guide", "cabinet-cards"]);
t("no keyword match -> parents only", POSTCARDS,
  "an old piece of card stock", ["postcard-guide"]);
t("rppc", POSTCARDS, "rppc real photo postcard azo stamp box divided back", ["postcard-guide", "rppc"]);
t("single guide passes through", [POOL[0]], "anything", ["postcard-guide"]);

// family selection helpers
n++;
if (isFamilySelection("family:Postcards") && familyOfSelection("family:Postcards") === "Postcards"
    && !isFamilySelection("postcard-guide")) console.log("PASS family selection helpers");
else { bad++; console.log("FAIL family selection helpers"); }

// guideSection
const MD = `# Postcard Guide\n\nintro\n\n## Pricing rules\n\nband stuff\n\n## Item Specifics Map\n\n- Type -> Postcard\n- Era -> Linen\n\n## Supply and positioning\n\nother\n`;
n++;
const sec = guideSection(MD, ITEM_SPECIFICS_HEADING);
if (sec && sec.includes("Type -> Postcard") && sec.includes("Era -> Linen") && !sec.includes("Supply and positioning") && !sec.includes("band stuff")) {
  console.log("PASS guideSection extracts ITEM SPECIFICS MAP");
} else { bad++; console.log("FAIL guideSection\n" + sec); }
n++;
if (guideSection(MD, /nonexistent heading/i) === null) console.log("PASS guideSection returns null when absent");
else { bad++; console.log("FAIL guideSection null case"); }

console.log("\n" + (n - bad) + "/" + n + " passed");
process.exit(bad ? 1 : 0);
