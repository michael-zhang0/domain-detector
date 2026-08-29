// Tests for incantation matching. Run: node test/voice.test.mjs
//
// Speech recognition output is unpredictable — spacing, kanji vs kana, and
// mishearings all vary — so the accepted forms are pinned down here rather than
// discovered by shouting at the laptop.
//
// 領域展開 alone is the trigger. The domain's name after it is optional: the
// full line still matches, because the opening is inside it either way.

import { matchesIncantation, normalise } from "../js/voice.js";

let failures = 0;
function check(name, got, want) {
  const ok = got === want;
  if (!ok) failures++;
  const shown = name === "" ? "(empty)" : name;
  console.log(`${ok ? "PASS" : "FAIL"}  ${shown.padEnd(34)} ${got} (want ${want})`);
}

console.log("the opening alone is enough:");
for (const input of [
  "領域展開",
  "りょういきてんかい",
  "リョウイキテンカイ",
  "ryoiki tenkai",
  "Ryouiki Tenkai",
  "領域展開！",
  "「領域展開」",
  "ええと、領域展開",
]) {
  check(input, matchesIncantation(input), true);
}

console.log("\nthe full line still works:");
for (const input of [
  "領域展開 伏魔御廚子",
  "領域展開　伏魔御厨子",
  "りょういきてんかい ふくまみずし",
  "ryoiki tenkai fukuma mizushi",
  "領域展開、伏魔御廚子。",
]) {
  check(input, matchesIncantation(input), true);
}

console.log("\nthe name on its own is not a trigger:");
for (const input of ["伏魔御廚子", "ふくまみずし", "fukuma mizushi"]) {
  check(input, matchesIncantation(input), false);
}

console.log("\nnot the incantation:");
for (const input of [
  "",
  "hello there",
  "こんにちは",
  "domain expansion",
  // Halves of the opening are too generic to fire on their own.
  "領域",
  "展開",
  "ryoiki",
  "tenkai",
]) {
  check(input, matchesIncantation(input), false);
}

console.log("\nnormalisation:");
check("katakana folds to hiragana", normalise("リョウイキテンカイ"), "りょういきてんかい");
check("spacing and punctuation dropped", normalise("領域展開、 伏魔御廚子。"), "領域展開伏魔御廚子");

console.log(failures ? `\n${failures} failing` : "\nall passing");
process.exit(failures ? 1 : 0);
