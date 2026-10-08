import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_PATH = resolve(ROOT, "data/pack.json");

const PLACE = {
  name: "Chidambaram, Tamil Nadu, India",
  lat: 11.6959,
  lng: 79.8,
  radiusKm: 30,
};

const AVES_TAXON_ID = 3;
const PAGE_SIZE = 100;
const MIN_OBSERVATIONS = 2;
const MAX_PAGES = 10;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function binomialKey(name) {
  const cleaned = String(name ?? "")
    .replace(/[×✕]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  const parts = cleaned.split(" ").filter((p) => p && !p.includes("("));
  return parts.slice(0, 2).join(" ");
}

function fullKey(name) {
  return String(name ?? "")
    .replace(/[×✕]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

async function fetchPage(page) {
  const url = new URL("https://api.inaturalist.org/v1/observations/species_counts");
  url.searchParams.set("lat", String(PLACE.lat));
  url.searchParams.set("lng", String(PLACE.lng));
  url.searchParams.set("radius", String(PLACE.radiusKm));
  url.searchParams.set("taxon_id", String(AVES_TAXON_ID));
  url.searchParams.set("order_by", "count");
  url.searchParams.set("per_page", String(PAGE_SIZE));
  url.searchParams.set("page", String(page));

  const res = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "chidambaram-birdnudge/0.1" },
  });
  if (!res.ok) throw new Error(`iNaturalist responded ${res.status} on page ${page}`);
  return res.json();
}

async function collectSpecies() {
  const seen = new Map();
  let page = 1;
  let totalResults = 0;

  while (page <= MAX_PAGES) {
    const payload = await fetchPage(page);
    const rows = payload.results ?? [];
    if (page === 1) totalResults = payload.total_results ?? 0;
    if (rows.length === 0) break;

    for (const row of rows) {
      const taxon = row.taxon ?? {};
      const name = taxon.name;
      if (!name) continue;

      const record = {
        inatTaxonId: taxon.id ?? null,
        scientific: name,
        common: taxon.preferred_common_name ?? taxon.common_name ?? null,
        rank: taxon.rank ?? null,
        observations: row.count ?? 0,
        photoUrl: taxon.default_photo?.medium_url ?? null,
        key: fullKey(name),
        binomial: binomialKey(name),
      };

      const existing = seen.get(record.key);
      if (!existing || record.observations > existing.observations) {
        seen.set(record.key, record);
      }
    }

    if (seen.size >= totalResults) break;
    page += 1;
    await sleep(250);
  }

  return { species: [...seen.values()], totalResults };
}

async function main() {
  console.log(`Fetching Aves within ${PLACE.radiusKm} km of ${PLACE.name} ...`);
  const { species, totalResults } = await collectSpecies();

  const kept = species
    .filter((s) => s.observations >= MIN_OBSERVATIONS)
    .sort((a, b) => b.observations - a.observations);

  const pack = {
    generatedAt: new Date().toISOString(),
    source: {
      name: "iNaturalist Research-grade-aware open observations (species_counts)",
      url: "https://api.inaturalist.org/v1/observations/species_counts",
      license: "iNaturalist terms of use; individual observations retain their own licences",
    },
    place: PLACE,
    filters: {
      taxonId: AVES_TAXON_ID,
      minObservations: MIN_OBSERVATIONS,
      totalSeenOnHub: totalResults,
    },
    count: kept.length,
    species: kept.map((s, i) => ({ rank: i + 1, ...s })),
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(pack, null, 2) + "\n", "utf8");

  console.log(`Hub reports ${totalResults} species in range.`);
  console.log(`Kept ${kept.length} with >= ${MIN_OBSERVATIONS} observations.`);
  console.log(`Wrote ${OUT_PATH}`);
  kept.slice(0, 12).forEach((s, i) => {
    console.log(`  ${String(i + 1).padStart(3)}. ${s.scientific} — ${s.common ?? "(no common name)"}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
