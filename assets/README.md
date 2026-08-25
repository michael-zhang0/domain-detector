# assets

Optional. Drop files here with these exact names and they replace the generated
art and audio. Each is picked up independently — anything missing falls back to
the procedural version, so this folder can stay empty.

| Filename | What it does |
|---|---|
| `malevolent-shrine-cue.mp3` | plays once, on activation — replaces the synthesised hit |
| `malevolent-shrine-bed.mp3` | loops while the domain is open, cut on reset |
| `malevolent-shrine.mp4` | looping background video — replaces the drawn shrine |

The names must match exactly, or the app will not find them. To use different
names or formats, edit `ASSETS` at the top of `../js/main.js`.

`.wav`, `.ogg`, and `.m4a` decode fine — the browser reads the file itself, not
the extension. But the path in `ASSETS` has to match whatever you name it, and
`../serve.mjs` needs a content type for the extension.

Nothing here is tracked or supplied with the project: source your own audio and
footage.
