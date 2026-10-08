import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readLog, writeTrainingCorpus } from "./log.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_MD = resolve(ROOT, "docs/log.md");
const OUT_CSV = resolve(ROOT, "data/log.csv");

function csvEscape(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function report() {
  const log = readLog();

  if (!log.length) {
    console.log("  log is empty. Add a note with: node src/note.mjs add <file.wav>");
    return;
  }

  const speciesCounts = new Map();
  const behaviourCounts = new Map();
  const unmatchedCounts = new Map();
  const byDay = new Map();
  let matchedNotes = 0;
  let editedNotes = 0;

  for (const e of log) {
    if (e.species.length) matchedNotes += 1;
    if (e.wasEdited) editedNotes += 1;

    const day = String(e.recordedAt).slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);

    for (const s of e.species) {
      const cur = speciesCounts.get(s.name) ?? { name: s.name, notes: 0, individuals: 0, uncertain: 0 };
      cur.notes += 1;
      if (s.count === null) cur.uncertain += 1;
      else cur.individuals += s.count;
      speciesCounts.set(s.name, cur);
    }
    for (const b of e.behaviours) behaviourCounts.set(b, (behaviourCounts.get(b) ?? 0) + 1);
    for (const u of e.unmatchedTokens) unmatchedCounts.set(u, (unmatchedCounts.get(u) ?? 0) + 1);
  }

  const species = [...speciesCounts.values()].sort((a, b) => b.notes - a.notes || a.name.localeCompare(b.name));
  const behaviours = [...behaviourCounts.entries()].sort((a, b) => b[1] - a[1]);
  const unmatched = [...unmatchedCounts.entries()].sort((a, b) => b[1] - a[1]);
  const days = [...byDay.entries()].sort();

  const training = writeTrainingCorpus();

  const lines = [];
  lines.push("# Field log");
  lines.push("");
  lines.push(`Generated ${new Date().toISOString().slice(0, 10)} from ${log.length} note(s).`);
  lines.push("");
  lines.push(`- notes with at least one matched local species: ${matchedNotes}/${log.length}`);
  lines.push(`- notes whose transcript was corrected by hand: ${editedNotes}`);
  lines.push(`- corrected transcripts available as fine-tuning data: ${training.count}`);
  lines.push(`- days with observations: ${days.length}`);
  lines.push("");
  lines.push("## Species recorded");
  lines.push("");
  lines.push("notes | individuals | name | count uncertain");
  lines.push("---: | ---: | :--- | ---:");
  for (const s of species) {
    lines.push(`${String(s.notes).padStart(5)} | ${String(s.individuals).padStart(11)} | ${s.name} | ${s.uncertain || ""}`);
  }
  lines.push("");
  lines.push("## Behaviour mentioned");
  lines.push("");
  lines.push("notes | behaviour");
  lines.push("---: | :---");
  for (const [b, n] of behaviours) {
    lines.push(`${String(n).padStart(5)} | ${b}`);
  }
  lines.push("");
  lines.push("## Words that matched nothing in the local species list");
  lines.push("");
  lines.push("These are where transcription is most likely to have mangled a bird name.");
  lines.push("They are the raw material for fine-tuning.");
  lines.push("");
  lines.push("count | word");
  lines.push("---: | :---");
  for (const [w, n] of unmatched.slice(0, 40)) {
    lines.push(`${String(n).padStart(5)} | ${w}`);
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("recorded at | id | transcript | corrected | species");
  lines.push(":--- | :--- | :--- | :--- | :---");
  for (const e of log) {
    lines.push(
      `${String(e.recordedAt).slice(0, 19).replace("T", " ")} | ${e.id} | ` +
      `${csvEscape((e.transcript || "").trim())} | ${e.wasEdited ? csvEscape((e.corrected || "").trim()) : ""} | ` +
      `${csvEscape(e.species.map((s) => s.name).join(", "))}`,
    );
  }
  lines.push("");

  mkdirSync(dirname(OUT_MD), { recursive: true });
  writeFileSync(OUT_MD, lines.join("\n"), "utf8");

  const csvRows = [
    "recorded_at,id,transcript,corrected,species,counted,behaviours,unmatched",
    ...log.map((e) =>
      [
        e.recordedAt,
        e.id,
        csvEscape((e.transcript || "").trim()),
        csvEscape((e.corrected || "").trim()),
        csvEscape(e.species.map((s) => s.name).join("; ")),
        csvEscape(e.species.map((s) => (s.count === null ? (s.uncertainCount ? "several" : "?") : s.count)).join("; ")),
        csvEscape(e.behaviours.join("; ")),
        csvEscape(e.unmatchedTokens.join("; ")),
      ].join(","),
    ),
  ];
  mkdirSync(dirname(OUT_CSV), { recursive: true });
  writeFileSync(OUT_CSV, csvRows.join("\n") + "\n", "utf8");

  console.log("");
  console.log(`  notes            ${log.length}`);
  console.log(`  with a match     ${matchedNotes}`);
  console.log(`  hand-corrected   ${editedNotes}  (training examples: ${training.count})`);
  console.log(`  species recorded ${species.length}`);
  console.log(`  days             ${days.length}`);
  console.log("");
  console.log(`wrote ${OUT_MD}`);
  console.log(`wrote ${OUT_CSV}`);
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`) {
  report();
}
