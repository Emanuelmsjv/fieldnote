import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACK_PATH = resolve(ROOT, "data/pack.json");

const NUMBERS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20, thirty: 30,
  a: 1, an: 1, couple: 2, several: null, few: null, many: null, some: null,
};

const UNCOUNTED = new Set(["several", "few", "many", "some", "lots"]);

const BEHAVIOURS = [
  "flying", "flew", "perched", "calling", "calling loudly", "singing", "feeding",
  "roosting", "roost", "swimming", "standing", "sitting", "soaring", "hovering",
  "wading", "diving", "courtship", "displaying", "nesting", "in flight",
];

const STOP_TOKENS = new Set([
  "the", "a", "an", "at", "in", "on", "over", "under", "near", "by", "and", "or",
  "of", "to", "from", "with", "but", "was", "is", "it", "there", "that", "this",
  "for", "very", "about", "before", "after", "again", "one", "some", "any",
  "i", "we", "he", "she", "they", "my", "our", "its", "his", "her", "their",
  "have", "has", "had", "were", "are", "am", "be", "do", "does", "did", "so",
  "not", "no", "yes", "now", "then", "when", "where", "what", "which", "who",
  "can", "could", "would", "should", "will", "shall", "may", "might", "must",
  "saw", "seen", "hear", "heard", "listening", "listen", "recorded", "recording",
]);

function normalizeWords(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[‐-―]/g, "-")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(text) {
  const normalized = normalizeWords(text);
  return normalized.length ? normalized.split(" ") : [];
}

export function loadSpeciesNames() {
  if (!existsSync(PACK_PATH)) return [];
  const raw = JSON.parse(readFileSync(PACK_PATH, "utf8").replace(/^﻿/, ""));
  const names = [];
  for (const s of raw.species ?? []) {
    if (s.common) names.push(s.common);
  }
  return names.sort((a, b) => b.length - a.length);
}

function nameToTokens(name) {
  const normalized = normalizeWords(name);
  return normalized.length ? normalized.split(" ") : [];
}

const QUALIFIERS = new Set(["common", "little", "great"]);

function pluralVariants(tokens) {
  const last = tokens[tokens.length - 1];
  if (!last) return [];
  const variants = [];
  if (!last.endsWith("s")) {
    variants.push([...tokens.slice(0, -1), `${last}s`]);
  }
  if (!last.endsWith("es") && !last.endsWith("s")) {
    variants.push([...tokens.slice(0, -1), `${last}es`]);
  }
  return variants;
}

function speciesIndex() {
  const parsed = loadSpeciesNames().map((name) => ({ name, toks: nameToTokens(name) }));

  const ownersByBase = new Map();
  for (const { toks } of parsed) {
    if (toks.length < 2 || !QUALIFIERS.has(toks[0])) continue;
    const key = toks.slice(1).join(" ");
    if (!ownersByBase.has(key)) ownersByBase.set(key, new Set());
    ownersByBase.get(key).add(toks.join(" "));
  }

  const index = new Map();
  const add = (toks, name) => {
    if (toks.length === 0 || toks.length > 4) return;
    const key = toks.join(" ");
    if (!index.has(key)) index.set(key, name);
  };

  for (const { name, toks } of parsed) {
    add(toks, name);
    for (const variant of pluralVariants(toks)) add(variant, name);

    if (toks.length < 2 || !QUALIFIERS.has(toks[0])) continue;
    const base = toks.slice(1);
    const owners = ownersByBase.get(base.join(" "));
    if (owners && owners.size === 1) {
      add(base, name);
      for (const variant of pluralVariants(base)) add(variant, name);
    }
  }

  return index;
}

function countBefore(tokens, at, window = 3) {
  const seen = [];
  for (let i = at - 1; i >= 0 && i >= at - window; i -= 1) {
    const t = tokens[i];
    if (t in NUMBERS) seen.push(t);
    else if (STOP_TOKENS.has(t)) continue;
    else break;
  }
  if (!seen.length) return { count: null, uncertain: false };
  const word = seen[0];
  if (UNCOUNTED.has(word)) return { count: null, uncertain: true };
  return { count: NUMBERS[word], uncertain: false };
}

export function extract(text) {
  const tokens = tokenize(text);
  const index = speciesIndex();
  const maxSpan = 4;

  const matches = [];
  const consumed = new Array(tokens.length).fill(false);

  for (let i = 0; i < tokens.length; i += 1) {
    if (consumed[i]) continue;
    for (let span = Math.min(maxSpan, tokens.length - i); span >= 1; span -= 1) {
      const slice = tokens.slice(i, i + span).join(" ");
      const name = index.get(slice);
      if (!name) continue;
      const { count, uncertain } = countBefore(tokens, i);
      matches.push({ species: name, tokenStart: i, tokenEnd: i + span, count, uncertain });
      for (let k = i; k < i + span; k += 1) consumed[k] = true;
      break;
    }
  }

  const behaviours = BEHAVIOURS.filter((b) => text.toLowerCase().includes(b));

  const matchedTokens = new Set();
  for (const m of matches) {
    for (let i = m.tokenStart; i < m.tokenEnd; i += 1) matchedTokens.add(i);
  }

  const candidates = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (consumed[i]) continue;
    const t = tokens[i];
    if (STOP_TOKENS.has(t) || t.length < 4) continue;
    candidates.push(t);
  }

  const residual = tokens.filter((_, i) => !consumed[i]);

  return {
    species: matches.map((m) => ({
      name: m.species,
      count: m.count,
      uncertainCount: m.uncertain,
    })),
    behaviours,
    matchedSpeciesCount: new Set(matches.map((m) => m.species)).size,
    unmatchedTokens: candidates,
    residualWordCount: residual.length,
    totalWords: tokens.length,
  };
}
