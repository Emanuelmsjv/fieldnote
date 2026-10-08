import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SENTENCES = resolve(ROOT, "data/eval/sentences.json");
const AUDIO_DIR = resolve(ROOT, "data/eval/audio");

const VOICE = process.env.FIELDNOTE_VOICE ?? "Microsoft Zira Desktop";
const RATE = Number(process.env.FIELDNOTE_RATE ?? 0);
const FORCE = process.argv.includes("--force");

const psScript = (text, outPath) => `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SelectVoice('${VOICE.replace(/'/g, "''")}')
$s.Rate = ${RATE}
$s.SetOutputToWaveFile('${outPath.replace(/'/g, "''")}')
$s.Speak(@'
${text}
'@)
$s.SetOutputToNull()
$s.Dispose()
`;

export function isWindows() {
  return process.platform === "win32";
}

export function synthesize(text, outPath) {
  execFileSync(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-Command", psScript(text, outPath)],
    { stdio: "pipe" },
  );
}

export function loadSentences() {
  const raw = JSON.parse(readFileSync(SENTENCES, "utf8").replace(/^﻿/, ""));
  return raw.sentences ?? [];
}

export function fixturePath(id) {
  return resolve(AUDIO_DIR, `${id}.wav`);
}

async function main() {
  if (!isWindows()) {
    console.error("Fixture generation uses the Windows SAPI voices and only runs on Windows.");
    console.error("Audio fixtures are committed, so this is only needed when changing sentences.json.");
    process.exitCode = 1;
    return;
  }

  mkdirSync(AUDIO_DIR, { recursive: true });
  const sentences = loadSentences();

  let made = 0;
  let skipped = 0;

  for (const s of sentences) {
    const out = fixturePath(s.id);
    if (existsSync(out) && !FORCE) {
      skipped += 1;
      continue;
    }
    synthesize(s.text, out);
    made += 1;
  }

  console.log(`voice   ${VOICE}`);
  console.log(`rate    ${RATE}`);
  console.log(`made    ${made}`);
  console.log(`skipped ${skipped} (already present; use --force to regenerate)`);
  console.log(`audio   ${AUDIO_DIR}`);
}

main();
