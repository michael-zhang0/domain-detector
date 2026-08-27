// Tests for incantation matching. Run: node test/voice.test.mjs
//
// Speech recognition output is unpredictable — spacing, kanji vs kana, and
// mishearings all vary — so the accepted forms are pinned down here rather than
// discovered by shouting at the laptop.
//
// Both halves are required: the shared opening 領域展開, then the half that
// names the domain. matchesIncantation asks which domain one transcript names
// outright; halvesIn reports the halves separately, which is what lets
// VoiceTrigger accumulate them across the several results one utterance
// usually produces.
//
// DOMAINS is imported rather than duplicated, so this tests the phrase lists
// the app actually uses.

import { matchesIncantation, halvesIn, normalise } from "../js/voice.js";
import { DOMAINS } from "../js/domains.js";

const SHRINE = "malevolent-shrine";
const VOID = "unlimited-void";

let failures = 0;
function check(name, got, want) {
  const ok = got === want;
  if (!ok) failures++;
  const shown = name === "" ? "(empty)" : name;
  console.log(`${ok ? "PASS" : "FAIL"}  ${shown.padEnd(36)} ${got} (want ${want})`);
}

const names = (t) => matchesIncantation(t, DOMAINS);

console.log("full line names its domain:");
for (const [input, want] of [
  ["領域展開 伏魔御廚子", SHRINE],
  ["領域展開　伏魔御厨子", SHRINE],
  ["りょういきてんかい ふくまみずし", SHRINE],
  ["リョウイキテンカイ フクマミズシ", SHRINE],
  ["ryoiki tenkai fukuma mizushi", SHRINE],
  ["領域展開、伏魔御廚子。", SHRINE],
  ["領域展開 無量空処", VOID],
  ["りょういきてんかい むりょうくうしょ", VOID],
  ["リョウイキテンカイ ムリョウクウショ", VOID],
  ["ryoiki tenkai muryou kuusho", VOID],
  ["Ryouiki Tenkai, Muryo Kusho", VOID],
  ["ええと、領域展開 無量空処！", VOID],
  // Mixed scripts, which recognition does produce.
  ["領域展開 fukuma mizushi", SHRINE],
  ["領域展開 muryokusho", VOID],
]) {
  check(input, names(input), want);
}

console.log("\nhalf a line names nothing:");
for (const input of [
  "領域展開",
  "ryoiki tenkai",
  "伏魔御廚子",
  "ふくまみずし",
  "無量空処",
  "むりょうくうしょ",
]) {
  check(input, names(input), null);
}

console.log("\nnot an incantation:");
for (const input of ["", "hello there", "こんにちは", "domain expansion", "展開", "領域", "ryoiki"]) {
  check(input, names(input), null);
}

console.log("\nhalves reported separately (for accumulation):");
{
  const a = halvesIn("領域展開", DOMAINS);
  check("領域展開 -> opening", a.opening, true);
  check("領域展開 -> name", a.name, null);

  const b = halvesIn("ふくまみずし", DOMAINS);
  check("ふくまみずし -> opening", b.opening, false);
  check("ふくまみずし -> name", b.name, SHRINE);

  const c = halvesIn("むりょうくうしょ", DOMAINS);
  check("むりょうくうしょ -> name", c.name, VOID);

  const d = halvesIn("領域展開 無量空処", DOMAINS);
  check("full void line -> opening", d.opening, true);
  check("full void line -> name", d.name, VOID);

  const e = halvesIn("こんにちは", DOMAINS);
  check("unrelated -> opening", e.opening, false);
  check("unrelated -> name", e.name, null);
}

console.log("\nthe two domains must not be confusable:");
check("shrine line is not the void", names("領域展開 伏魔御廚子") === VOID, false);
check("void line is not the shrine", names("領域展開 無量空処") === SHRINE, false);
// Every phrase must belong to exactly one domain, or naming is ambiguous.
{
  const seen = new Map();
  let clashes = 0;
  for (const d of DOMAINS) {
    for (const p of d.phrases) {
      if (seen.has(p) && seen.get(p) !== d.id) clashes++;
      seen.set(p, d.id);
    }
  }
  check("no phrase is shared between domains", clashes, 0);
}

console.log("\nnormalisation:");
check("katakana folds to hiragana", normalise("フクマミズシ"), "ふくまみずし");
check("spacing and punctuation dropped", normalise("領域展開、 無量空処。"), "領域展開無量空処");

console.log(failures ? `\n${failures} failing` : "\nall passing");
process.exit(failures ? 1 : 0);
