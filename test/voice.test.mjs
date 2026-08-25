// Tests for incantation matching. Run: node test/voice.test.mjs
//
// Speech recognition output is unpredictable — spacing, kanji vs kana, and
// mishearings all vary — so the accepted forms are pinned down here rather than
// discovered by shouting at the laptop.
//
// Both halves of 領域展開・伏魔御廚子 are required. matchesIncantation asks
// whether one transcript holds the whole line; halvesIn reports the halves
// separately, which is what lets VoiceTrigger accumulate them across the
// several results one utterance usually produces.

import { matchesIncantation, halvesIn, normalise } from "../js/voice.js";

let failures = 0;
function check(name, got, want) {
  const ok = got === want;
  if (!ok) failures++;
  const shown = name === "" ? "(empty)" : name;
  console.log(`${ok ? "PASS" : "FAIL"}  ${shown.padEnd(34)} ${got} (want ${want})`);
}

console.log("full line in a single transcript:");
for (const [input, want] of [
  ["領域展開 伏魔御廚子", true],
  ["領域展開　伏魔御厨子", true],
  ["りょういきてんかい ふくまみずし", true],
  ["リョウイキテンカイ フクマミズシ", true],
  ["領域展開、伏魔御廚子。", true],
  ["「領域展開 伏魔御廚子」", true],
  ["ryoiki tenkai fukuma mizushi", true],
  ["Ryouiki Tenkai, Fukuma Mizuchi", true],
  ["ええと、領域展開 伏魔御廚子！", true],
  // Mixed scripts, which recognition does produce.
  ["領域展開 fukuma mizushi", true],
]) {
  check(input, matchesIncantation(input), want);
}

console.log("\nhalf a line is not enough:");
for (const input of [
  "領域展開",
  "りょういきてんかい",
  "ryoiki tenkai",
  "伏魔御廚子",
  "ふくまみずし",
  "fukuma mizushi",
]) {
  check(input, matchesIncantation(input), false);
}

console.log("\nnot the incantation at all:");
for (const input of ["", "hello there", "こんにちは", "domain expansion", "展開", "領域", "ryoiki"]) {
  check(input, matchesIncantation(input), false);
}

console.log("\nhalves reported separately (for accumulation):");
{
  const a = halvesIn("領域展開");
  check("領域展開 -> opening", a.opening, true);
  check("領域展開 -> name", a.name, false);

  const b = halvesIn("ふくまみずし");
  check("ふくまみずし -> opening", b.opening, false);
  check("ふくまみずし -> name", b.name, true);

  const c = halvesIn("領域展開 伏魔御廚子");
  check("full line -> opening", c.opening, true);
  check("full line -> name", c.name, true);

  const d = halvesIn("こんにちは");
  check("unrelated -> opening", d.opening, false);
  check("unrelated -> name", d.name, false);
}

console.log("\nnormalisation:");
check("katakana folds to hiragana", normalise("フクマミズシ"), "ふくまみずし");
check("spacing and punctuation dropped", normalise("領域展開、 伏魔御廚子。"), "領域展開伏魔御廚子");

console.log(failures ? `\n${failures} failing` : "\nall passing");
process.exit(failures ? 1 : 0);
