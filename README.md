# fieldnote

Speak a field note outdoors. It is transcribed **on your own machine**, with no
account, no API key, no signal and no per-minute cost. The note is then reduced
to structured observations — species, count, behaviour — and accumulated into a
log you can actually read back.

This is not a wrapper around a speech API. The point of the project is the
measurement underneath it, which came out backwards.

## The finding

Ordinary speech is transcribed **perfectly** by Whisper `tiny.en`. Bird names are
not. On a 38-sentence controlled set:

| model | size class | exact matches | corpus WER | ordinary WER | species WER | bird-name tokens recovered |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: |
| `tiny` | q8, smaller | 19/38 (50.0%) | 9.6% | **0.0%** | 14.0% | **54.5%** (18/33) |
| `base` | q8, larger | 18/38 (47.4%) | 11.3% | **0.0%** | 18.0% | 48.5% (16/33) |

Two things fall out of that table:

1. **Nearly half of all bird-name tokens are lost.** Not mispronounced, dropped.
2. **The bigger model is worse at it.** Doubling parameter count made species WER
   go *up*, from 14.0% to 18.0%, and bird-name recovery go *down*, from 54.5% to
   48.5%.

Scaling a general-purpose model does not buy a regional bird vocabulary. What
works is fine-tuning on the domain, and fine-tuning requires open weights.

Some real transcripts from the fixtures, unedited:

```
reference:  Coppersmith barbet on the neem tree.
transcript: Copper Smith-Barbit on the name tree.

reference:  Paddyfield pipit on a bare patch of ground.
transcript: Patty Field Pippett on a bare patch of ground.
```

## How the design follows from that

If transcription of bird names is unreliable, a spoken note cannot be trusted as
data. So:

1. **The transcript is always shown.** Never hidden, never silently cleaned up.
2. **Anything that does not match a local species is flagged**, not dropped and
   not accepted. The unmatched words are listed, because that is where the
   mangling is visible.
3. **Corrections are kept and exported as a fine-tuning corpus.** Fixing a note
   is how the tool gets better, and that path only exists because the weights
   are open.

Step 3 is the part a cloud API cannot offer. You cannot fine-tune Whisper on
Chidambaram bird vocabulary, and shipping field audio to a third party to
transcribe it would mean publishing the location of every rare sighting you make.

The qualification gate is deliberately cautious. Saying "cormorants" does **not**
get matched to *Little Cormorant*, because the local pack contains three cormorant
species and the honest answer is that the note is ambiguous. Bare "redshank" *is*
matched, because only one redshank occurs locally.

## Quick start

Requires Node 20+. No Python, no GPU, no API keys.

```bash
npm install
npm run setup        # builds data/pack.json from iNaturalist open observations
npm test             # 17 checks on the extraction logic, no model needed
npm run eval         # transcribes 38 fixtures with whisper-tiny.en (~2 min)
npm run eval:base    # same fixtures with whisper-base.en
npm run eval:compare # writes docs/eval.md
```

Models are downloaded from the Hugging Face hub on first use and cached. After
that everything runs offline.

## Using it

```bash
node src/note.mjs add notes/morning.wav     # transcribe, extract, log
node src/note.mjs list                      # recent notes
node src/note.mjs correct <id> "..."        # fix a transcript, adds training data
node src/note.mjs report                    # writes docs/log.md and data/log.csv
node src/note.mjs training                  # export the fine-tuning corpus
```

Audio must be 16-bit PCM WAV. Phone recorders produce `.m4a` or `.ogg`:

```bash
ffmpeg -i clip.m4a clip.wav
```

A real run:

```
$ node src/note.mjs add notes/mix-01.wav

  transcribed 4.48s in 0.95s, fully offline

  [0b496222]  2026-10-08T16:13:46
  heard:      Two purple herons and one little egret in the tank before sunrise.
  matched species:
          2  Purple Heron
          1  Little Egret
```

## The evaluation set

`data/eval/sentences.json` holds 38 sentences in three categories: `ordinary`,
`species`, and `mixed` field-note phrasing with numbers and place names.

Audio is generated from the text by `npm run fixtures` using the Windows SAPI
voice, so the set is deterministic and regenerable, and the 38 WAV files are
committed so the result is checkable without regenerating anything. Fixture
generation is Windows-only; everything else runs anywhere.

Bird-name recovery is a bag-of-words check of whether each bird-name token in the
reference appears anywhere in the transcript. That is deliberate: it catches the
specific failure where a name is split or replaced rather than merely
mispronounced, which a positional alignment would score more generously.

## Honest limitations

- **The fixtures are synthetic TTS.** A single SAPI voice, no accent variation, no
  wind, no real field noise. Treat the absolute numbers as indicative and the
  tiny-vs-base comparison as the actual result.
- **No fine-tuning is implemented.** The corpus is exported; training it needs a
  GPU and is the obvious next step.
- **English only.** `whisper-tiny.en` cannot transcribe Tamil at all. A Tamil
  field note is out of scope, which is a real limitation for this region.
- **Behaviour detection is a keyword list**, not a model. It will miss anything
  not in `src/extract.mjs`.
- **The local species list is a filter, not a validator.** A prediction inside the
  pack means "plausible here", not "correct". Both can be locally plausible when
  only one is present.
- Counts are extracted from spoken number words and are frequently absent.

## Data sources and licensing

| Component | Licence |
| :--- | :--- |
| This repository | CC BY-NC-SA 4.0 |
| `Xenova/whisper-tiny.en`, `Xenova/whisper-base.en` | Apache-2.0 |
| `data/pack.json` | derived from iNaturalist open observations; individual observations keep their own licences |
| `data/eval/sentences.json` | original, CC0-1.0 |
| Evaluation audio fixtures | generated locally with the Windows SAPI voice |

Whisper weights are Apache-2.0, which makes them easier to use commercially than
most open models in this series. The iNaturalist-derived pack inherits the
per-observation licences of the underlying photographs and names, so this
repository is kept non-commercial.

`data/log.jsonl` is gitignored on purpose. A field log is a record of where you
went and what you saw.
