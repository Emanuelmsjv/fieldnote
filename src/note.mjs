import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { decodeWav, toMonoAt } from "./audio-io.mjs";
import { extract } from "./extract.mjs";
import { addNote, readLog, recordCorrection, writeTrainingCorpus } from "./log.mjs";

const SAMPLE_RATE = 16000;
const DEFAULT_MODEL = process.env.FIELDNOTE_MODEL ?? "Xenova/whisper-tiny.en";
const DEFAULT_DTYPE = process.env.FIELDNOTE_DTYPE ?? "q8";

let cachedAsr = null;

async function getAsr(model, dtype) {
  if (cachedAsr) return cachedAsr;
  const { pipeline, env } = await import("@huggingface/transformers");
  env.allowLocalModels = false;
  process.stderr.write(`loading ${model} (${dtype}) ...\n`);
  cachedAsr = await pipeline("automatic-speech-recognition", model, { dtype });
  process.stderr.write("loaded\n");
  return cachedAsr;
}

function usage() {
  console.log(`fieldnote — offline voice field notes for Chidambaram

usage:
  node src/note.mjs add <file.wav>            transcribe, extract, log
  node src/note.mjs list                      show recent entries
  node src/note.mjs correct <id> "<text>"     fix a transcript, adds training data
  node src/note.mjs report                    printable summary
  node src/note.mjs training                  export fine-tuning corpus

env:
  FIELDNOTE_MODEL   default ${DEFAULT_MODEL}
  FIELDNOTE_DTYPE   default ${DEFAULT_DTYPE}
`);
}

function showEntry(e) {
  console.log("");
  console.log(`  [${e.id}]  ${e.recordedAt}`);
  console.log(`  heard:      ${e.transcript.trim()}`);
  if (e.wasEdited) console.log(`  corrected:  ${e.corrected.trim()}`);
  if (e.species.length) {
    console.log(`  matched species:`);
    for (const s of e.species) {
      const n = s.count === null ? (s.uncertainCount ? "several" : "count?") : s.count;
      console.log(`    ${String(n).padStart(7)}  ${s.name}`);
    }
  } else {
    console.log(`  matched species: none`);
  }
  if (e.unmatchedTokens.length) {
    console.log(`  unmatched words (may be a mangled species name):`);
    console.log(`    ${e.unmatchedTokens.slice(0, 12).join(", ")}`);
  }
  if (e.wasEdited) console.log("  note: transcript was corrected, so it counts as training data");
}

async function cmdAdd(file) {
  if (!existsSync(file)) {
    console.error(`no such file: ${file}`);
    process.exitCode = 1;
    return;
  }

  const { samples, sampleRate } = decodeWav(file);
  const audio = toMonoAt(samples, sampleRate, SAMPLE_RATE);
  const asr = await getAsr(DEFAULT_MODEL, DEFAULT_DTYPE);
  const started = Date.now();
  const out = await asr(audio, { max_new_tokens: 200 });
  const elapsed = (Date.now() - started) / 1000;

  const transcript = out.text ?? "";
  const extraction = extract(transcript);
  const entry = addNote({
    transcript,
    extraction,
    audioFile: file,
    model: `${DEFAULT_MODEL}@${DEFAULT_DTYPE}`,
    durationSec: Number((audio.length / SAMPLE_RATE).toFixed(2)),
  });

  console.log("");
  console.log(`  transcribed ${entry.durationSec}s in ${elapsed.toFixed(2)}s, fully offline`);
  showEntry(entry);
  console.log("");
  console.log(`  if the transcript is wrong: node src/note.mjs correct ${entry.id} "what you actually said"`);
}

function cmdList() {
  const log = readLog();
  if (!log.length) {
    console.log("  log is empty. Add one with: node src/note.mjs add <file.wav>");
    return;
  }
  console.log("");
  console.log(`  ${log.length} note(s)`);
  for (const e of log) {
    const first = (e.species[0]?.name ?? e.unmatchedTokens.slice(0, 2).join(" ") ?? "").slice(0, 44);
    console.log(`    ${e.id}  ${e.recordedAt.slice(0, 19).replace("T", " ")}  ${first.padEnd(44)} ${e.wasEdited ? "edited" : ""}`);
  }
}

function cmdCorrect(id, text) {
  const entry = recordCorrection(id, text);
  if (!entry) {
    console.error(`no entry with id ${id}`);
    process.exitCode = 1;
    return;
  }
  showEntry(entry);
  console.log("");
  console.log("  saved, and exported to data/training.jsonl for fine-tuning");
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "add":
      if (!rest[0]) return usage();
      return cmdAdd(resolve(process.cwd(), rest[0]));
    case "list":
      return cmdList();
    case "correct":
      if (!rest[0] || !rest.slice(1).join(" ")) return usage();
      return cmdCorrect(rest[0], rest.slice(1).join(" "));
    case "report":
      return (await import("./report.mjs")).report();
    case "training": {
      const r = writeTrainingCorpus();
      console.log("");
      console.log(`  ${r.count} corrected note(s) -> ${r.path}`);
      if (r.count === 0) {
        console.log("  nothing yet. Run: node src/note.mjs correct <id> \"...\"");
      } else {
        console.log("  this is the corpus you would fine-tune on. That step needs a GPU and is not");
        console.log("  implemented here, because fine-tuning is only possible with open weights.");
      }
      return;
    }
    default:
      return usage();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
