// Tests for incantation matching. Run: node test/voice.test.mjs
//
// Speech recognition output is unpredictable — spacing, kanji vs kana, and
// mishearings all vary — so the accepted forms are pinned down here rather than
// discovered by shouting at the laptop.

import { matchesIncantation, normalise } from "../js/voice.js";

const cases = [
  // Full line, as ja-JP recognition tends to return it.
  ["領域展開 伏魔御廚子", true],
  ["領域展開　伏魔御厨子", true],
  ["りょういきてんかい ふくまみずし", true],
  ["リョウイキテンカイ フクマミズシ", true],
  // Either half alone is enough — recognition often clips one.
  ["領域展開", true],
  ["伏魔御廚子", true],
  ["ふくまみずし", true],
  // Punctuation and interim spacing.
  ["領域展開、伏魔御廚子。", true],
  ["「領域展開」", true],
  // Romaji, for anyone running recognition in English.
  ["ryoiki tenkai", true],
  ["Ryouiki Tenkai fukuma mizushi", true],
  ["fukuma mizuchi", true],
  // Embedded in a longer utterance.
  ["ええと、領域展開！", true],
  // Should not fire.
  ["", false],
  ["hello there", false],
  ["こんにちは", false],
  ["domain expansion", false],
  ["展開", false],          // too generic on its own
  ["領域", false],          // ditto
  ["ryoiki", false],        // needs the second word
];

let failures = 0;
for (const [input, want] of cases) {
  const got = matchesIncantation(input);
  const ok = got === want;
  if (!ok) failures++;
  const shown = input === "" ? "(empty)" : input;
  console.log(`${ok ? "PASS" : "FAIL"}  ${shown.padEnd(30)} -> ${got} (want ${want})`);
  if (!ok) console.log(`         normalised: "${normalise(input)}"`);
}

console.log(failures ? `\n${failures} failing` : "\nall passing");
process.exit(failures ? 1 : 0);
