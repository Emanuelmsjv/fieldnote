import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeWav, toMonoAt } from "./audio-io.mjs";
import { loadSentences, fixturePath } from "./make-fixtures.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SAMPLE_RATE = 16000;

const DIGITS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen", "twenty",
];

const BIRD_TOKENS = new Set([
  "heron", "egret", "kite", "bulbul", "koel", "tern", "redshank", "stork",
  "cormorant", "robin", "pipit", "parakeet", "ibis", "kingfisher", "jacana",
  "darter", "openbill", "fantail", "flycatcher", "barbet", "hoopoe", "shikra",
  "swamphen", "stint", "greenshank", "magpie", "sparrow", "tit", "eagle",
  "wader", "larb",
]);

function argValue(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

export function normalizeText(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\b(\d+)\b/g, (m) => DIGITS[Number(m)] ?? m)
    .replace(/[.,!?;:"()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(text) {
  const n = normalizeText(text);
  return n.length ? n.split(" ") : [];
}

function levenshtein(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

export function wordErrorRate(reference, hypothesis) {
  if (reference.length === 0) return hypothesis.length === 0 ? 0 : 1;
  return levenshtein(reference, hypothesis) / reference.length;
}

function multisetRecall(referenceTokens, hypothesisSet) {
  const birdRefs = referenceTokens.filter((t) => BIRD_TOKENS.has(t));
  if (birdRefs.length === 0) return null;
  const hits = birdRefs.filter((t) => hypothesisSet.has(t)).length;
  return { total: birdRefs.length, hits, ratio: hits / birdRefs.length };
}

function pct(x) {
  return `${(x * 100).toFixed(1)}%`;
}

async function main() {
  const model = argValue("--model", "Xenova/whisper-tiny.en");
  const dtype = argValue("--dtype", "q8");
  const label = argValue("--label", model.split("/").pop() + "@" + dtype);
  const outJson = argValue("--out", null);

  const { pipeline, env } = await import("@huggingface/transformers");
  env.allowLocalModels = false;

  const sentences = loadSentences();
  const missing = sentences.filter((s) => !existsSync(fixturePath(s.id)));
  if (missing.length) {
    console.error(`${missing.length} fixture(s) missing. Run: node src/make-fixtures.mjs`);
    process.exitCode = 1;
    return;
  }

  console.log(`model   ${model}`);
  console.log(`dtype   ${dtype}`);
  console.log("");
  process.stderr.write("loading");

  const asr = await pipeline("automatic-speech-recognition", model, { dtype });
  process.stderr.write("\rloaded  \n");

  const rows = [];
  for (const s of sentences) {
    const { samples, sampleRate } = decodeWav(fixturePath(s.id));
    const audio = toMonoAt(samples, sampleRate, SAMPLE_RATE);
    const out = await asr(audio, { max_new_tokens: 128 });
    const hypothesis = out.text ?? "";
    const ref = tokenize(s.text);
    const hyp = tokenize(hypothesis);
    const wer = wordErrorRate(ref, hyp);
    const bird = multisetRecall(ref, new Set(hyp));

    rows.push({
      id: s.id,
      category: s.category,
      reference: s.text,
      hypothesis,
      wer,
      birdRefs: bird ? bird.total : 0,
      birdHits: bird ? bird.hits : 0,
    });

    const mark = wer === 0 ? "ok " : wer < 0.2 ? "~~ " : "XX ";
    process.stderr.write(`${mark}${s.id} wer=${wer.toFixed(2)} bird=${bird ? `${bird.hits}/${bird.total}` : "-"}\n`);
  }

  const byCategory = {};
  for (const cat of ["ordinary", "species", "mixed"]) {
    const subset = rows.filter((r) => r.category === cat);
    if (!subset.length) continue;
    const mean = subset.reduce((a, r) => a + r.wer, 0) / subset.length;
    const totalRefs = subset.reduce((a, r) => a + r.wer * tokenize(r.reference).length, 0);
    const totalWords = subset.reduce((a, r) => a + tokenize(r.reference).length, 0);
    byCategory[cat] = {
      n: subset.length,
      meanWer: mean,
      corpusWer: totalWords ? totalRefs / totalWords : 0,
    };
  }

  const birdRows = rows.filter((r) => r.birdRefs > 0);
  const birdRefs = birdRows.reduce((a, r) => a + r.birdRefs, 0);
  const birdHits = birdRows.reduce((a, r) => a + r.birdHits, 0);
  const exact = rows.filter((r) => r.wer === 0).length;

  const totalWords = rows.reduce((a, r) => a + tokenize(r.reference).length, 0);
  const totalErrors = rows.reduce((a, r) => a + r.wer * tokenize(r.reference).length, 0);

  const summary = {
    model,
    dtype,
    label,
    generatedAt: new Date().toISOString(),
    sentences: rows.length,
    exactMatches: exact,
    corpusWer: totalWords ? totalErrors / totalWords : 0,
    byCategory,
    birdNameTokens: { total: birdRefs, recovered: birdHits, recall: birdRefs ? birdHits / birdRefs : 0 },
    rows,
  };

  console.log("");
  console.log(`  ${label}   ${rows.length} sentences`);
  console.log("");
  console.log(`  exact word-for-word matches : ${exact}/${rows.length}  (${pct(exact / rows.length)})`);
  console.log(`  corpus word error rate      : ${pct(summary.corpusWer)}`);
  console.log("");
  console.log("  word error rate by category");
  for (const [cat, v] of Object.entries(byCategory)) {
    console.log(`    ${cat.padEnd(9)} n=${String(v.n).padStart(2)}  mean WER ${pct(v.meanWer).padStart(7)}  corpus WER ${pct(v.corpusWer).padStart(7)}`);
  }
  console.log("");
  console.log(`  bird-name tokens recovered  : ${birdHits}/${birdRefs}  (${pct(summary.birdNameTokens.recall)})`);

  if (outJson) {
    mkdirSync(dirname(resolve(ROOT, outJson)), { recursive: true });
    writeFileSync(resolve(ROOT, outJson), JSON.stringify(summary, null, 2) + "\n", "utf8");
    console.log("");
    console.log(`wrote ${outJson}`);
  }

  return summary;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
