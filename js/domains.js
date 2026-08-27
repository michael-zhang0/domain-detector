// The domain roster.
//
// Everything that differs between domains lives here: the pose that opens it,
// the half of the incantation that names it, the art, the sound, and the
// optional asset paths. main.js walks this list and knows nothing about any
// particular domain, so adding a third is a matter of one more entry plus its
// matcher and background.
//
// Backgrounds are created lazily. Each one pre-renders at its first resize —
// a silhouette, a starfield — and there is no reason to pay for a domain
// nobody has opened.

import { matchMalevolentShrine, matchUnlimitedVoid } from "./gestures.js";
import { MalevolentShrine } from "./backgrounds/malevolent-shrine.js";
import { UnlimitedVoid } from "./backgrounds/unlimited-void.js";

export const DOMAINS = [
  {
    id: "malevolent-shrine",
    label: "Malevolent Shrine", // debug panel only; nothing is drawn on screen
    match: matchMalevolentShrine,
    // The naming half of the line. 領域展開 is shared and lives in voice.js.
    phrases: [
      "伏魔御廚子", // the 廚 and 厨 variants of the last character both appear
      "伏魔御厨子",
      "ふくまみずし",
      "fukumamizushi",
      "fukumamizuchi",
    ],
    createBackground: () => new MalevolentShrine(),
    audioProfile: "shrine",
    assets: {
      art: "assets/malevolent-shrine.mp4",
      cue: "assets/malevolent-shrine-cue.mp3",
      bed: "assets/malevolent-shrine-bed.mp3",
    },
  },
  {
    id: "unlimited-void",
    label: "Unlimited Void",
    match: matchUnlimitedVoid,
    phrases: [
      "無量空処",
      "無量空処し", // recognition sometimes tacks a trailing kana on
      "むりょうくうしょ",
      "muryoukuusho",
      "muryokusho",
      "muryoukusho",
      "muryokuusho",
    ],
    createBackground: () => new UnlimitedVoid(),
    audioProfile: "void",
    assets: {
      art: "assets/unlimited-void.mp4",
      cue: "assets/unlimited-void-cue.mp3",
      bed: "assets/unlimited-void-bed.mp3",
    },
  },
];

export const domainById = (id) => DOMAINS.find((d) => d.id === id) ?? null;
