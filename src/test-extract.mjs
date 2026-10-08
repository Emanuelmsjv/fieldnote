import { extract, tokenize } from "./extract.mjs";

const CASES = [
  { text: "Two purple herons and one little egret in the tank before sunrise.", expect: ["Purple Heron", "Little Egret"] },
  { text: "Five painted storks, a few cormorants and a black-headed ibis.", expect: ["Painted Stork", "Black-headed Ibis"] },
  { text: "I saw three white-throated kingfishers on a wire this morning.", expect: ["White-throated Kingfisher"] },
  { text: "There were some rose-ringed parakeets in the avenue trees.", expect: ["Rose-ringed Parakeet"] },
  { text: "Heard the Asian koel again at half past two, very loud.", expect: ["Asian Koel"] },
  { text: "Redshank and greenshank on the mudflat, low tide, about twenty birds.", expect: ["Common Redshank", "Common Greenshank"] },
  { text: "Copper Smith-Barbit on the name tree.", expect: [] },
  { text: "Brahminy kite, white-throated kingfisher and rose-ringed parakeet all in one tree.", expect: ["Brahminy Kite", "White-throated Kingfisher", "Rose-ringed Parakeet"] },
];

const COUNT_CASES = [
  { text: "Two purple herons and one little egret.", expect: { "Purple Heron": 2, "Little Egret": 1 } },
  { text: "Five painted storks in the shallows.", expect: { "Painted Stork": 5 } },
  { text: "Some rose-ringed parakeets overhead.", expect: { "Rose-ringed Parakeet": null } },
];

let pass = 0;
let fail = 0;

function check(label, ok, detail) {
  if (ok) {
    pass += 1;
    console.log(`  pass  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}`);
    if (detail) console.log(`        ${detail}`);
  }
}

console.log("");
console.log("  tokenize");
check("lowercases and strips punctuation", tokenize("Two, purple HERONS!")[1] === "purple", JSON.stringify(tokenize("Two, purple HERONS!")));
check("expands hyphenated words", tokenize("white-throated kingfisher")[2] === "kingfisher", JSON.stringify(tokenize("white-throated kingfisher")));

console.log("");
console.log("  species matching");
for (const c of CASES) {
  const got = extract(c.text).species.map((s) => s.name).sort();
  const want = [...c.expect].sort();
  const ok = JSON.stringify(got) === JSON.stringify(want);
  check(
    ok ? `${want.length ? want.join(" + ") : "no false positives"}` : c.text,
    ok,
    `expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`,
  );
}

console.log("");
console.log("  counts");
for (const c of COUNT_CASES) {
  const r = extract(c.text);
  for (const [name, want] of Object.entries(c.expect)) {
    const found = r.species.find((s) => s.name === name);
    const got = found ? found.count : "absent";
    check(`${name} -> ${want}`, got === want, `got ${JSON.stringify(got)}`);
  }
}

console.log("");
console.log("  qualifier collapse is only applied when the local pack is unambiguous");
{
  const bare = extract("Some cormorants on the wire.");
  check(
    "bare 'cormorants' does not claim Little Cormorant",
    bare.species.length === 0,
    `matched ${JSON.stringify(bare.species.map((s) => s.name))}`,
  );
  const qualified = extract("A little cormorant on the wire.");
  check(
    "qualified 'little cormorant' does match",
    qualified.species[0]?.name === "Little Cormorant",
    `matched ${JSON.stringify(qualified.species.map((s) => s.name))}`,
  );
  const redshank = extract("Redshank on the mudflat.");
  check(
    "bare 'redshank' matches Common Redshank when unambiguous",
    redshank.species[0]?.name === "Common Redshank",
    `matched ${JSON.stringify(redshank.species.map((s) => s.name))}`,
  );
}

console.log("");
console.log(`  ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
