import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extract } from "./extract.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOG_PATH = resolve(ROOT, "data/log.jsonl");
const CORRECTIONS_PATH = resolve(ROOT, "data/corrections.jsonl");
const TRAINING_PATH = resolve(ROOT, "data/training.jsonl");

export function appendEntry(path, entry) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(entry) + "\n", "utf8");
}

export function readLog(path = LOG_PATH) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function addNote({ transcript, extraction, audioFile, model, durationSec, corrected }) {
  const entry = {
    id: randomUUID().slice(0, 8),
    recordedAt: new Date().toISOString(),
    audioFile: audioFile ?? null,
    durationSec: durationSec ?? null,
    model: model ?? null,
    transcript,
    corrected: corrected ?? null,
    species: extraction.species,
    behaviours: extraction.behaviours,
    unmatchedTokens: extraction.unmatchedTokens,
    wasEdited: Boolean(corrected) && corrected.trim() !== transcript.trim(),
  };
  appendEntry(LOG_PATH, entry);
  return entry;
}

export function recordCorrection(entryId, correctedText, note) {
  const log = readLog();
  const entry = log.find((e) => e.id === entryId);
  if (!entry) return null;

  entry.corrected = correctedText;
  entry.wasEdited = correctedText.trim() !== entry.transcript.trim();

  if (entry.wasEdited) {
    const extraction = extract(correctedText);
    entry.species = extraction.species;
    entry.behaviours = extraction.behaviours;
    entry.unmatchedTokens = extraction.unmatchedTokens;
    entry.matchedAfterCorrection = extraction.matchedSpeciesCount;
  }

  writeFileSync(LOG_PATH, log.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");

  if (entry.wasEdited) {
    appendEntry(CORRECTIONS_PATH, {
      id: entryId,
      recordedAt: entry.recordedAt,
      reference: correctedText,
      hypothesis: entry.transcript,
      note: note ?? null,
    });
    appendEntry(TRAINING_PATH, {
      text: correctedText,
      source: "user-correction",
      recordedAt: entry.recordedAt,
    });
  }

  return entry;
}

export function writeTrainingCorpus(target = TRAINING_PATH) {
  const corrections = readLog(CORRECTIONS_PATH);
  if (corrections.length === 0) return { count: 0, path: target };
  const rows = corrections.map((c) => JSON.stringify({ text: c.reference, source: "user-correction" }));
  writeFileSync(target, rows.join("\n") + "\n", "utf8");
  return { count: corrections.length, path: target };
}
