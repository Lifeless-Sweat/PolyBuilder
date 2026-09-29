# PolyTrack Track Generator

Generates random, drivable [PolyTrack](https://www.kodub.com/apps/polytrack) tracks and
outputs a track code you can paste straight into the game's import field. No PolyTrack
account, editor skills, or manual building required — just run it and get a track.

## Quick start (no coding required)

1. Go to the **Actions** tab of this repo.
2. Click **Generate Track** on the left, then the **Run workflow** button.
3. Optionally set a track length, theme (Summer/Winter/Desert), or a specific seed number
   (leave blank for a random track every time).
4. Click the green **Run workflow** button and wait ~10-20 seconds.
5. Open the finished run — the track code is printed on the run's summary page, and also
   saved to `track_code.txt` in the repo (with a text preview in `track_preview.txt`).
6. Copy the code and paste it into PolyTrack's import field.

## Running it yourself (optional, needs Node.js)

```bash
node polytrack_generator.js
```

Useful flags:

| Flag | Default | What it does |
|---|---|---|
| `--seed <n>` | random | Same seed always produces the same track |
| `--pieces <n>` | 30 | Roughly how many pieces long the track is |
| `--turn <0-1>` | 0.3 | How curvy the track is (higher = more turns) |
| `--ramp <0-1>` | 0.12 | How often hills show up |
| `--env <name>` | Summer | `Summer`, `Winter`, or `Desert` |
| `--tries <n>` | 40 | How many random drafts to generate before picking the best |
| `--refine <n>` | 400 | How many small tweaks to try on the best draft |
| `--plain` | off | Skip the self-review step (`--tries 1 --refine 0`), just build one random track |
| `--out <file>` | - | Save the track code to a file |
| `--preview <file>` | - | Save the text-map preview to a file |

The generator doesn't just place random pieces — it builds a batch of candidate tracks,
scores each one (rewarding a healthy mix of curves and straights, chicanes, and a finish
that isn't right on top of the start; penalizing long boring straight stretches and
one-direction spirals), keeps the best one, then keeps nudging it further and only keeps
changes that improve the score.

## Files

- **`polytrack_generator.js`** — the generator. Builds a random self-avoiding path from
  start to finish, places checkpoints along the way, scores and refines the result, then
  encodes it into a real PolyTrack track code. Every generated track is automatically
  checked for overlaps and for every piece actually connecting to the next before it's
  printed.
- **`polytrack_codec.js`** — encodes/decodes PolyTrack's actual track code format
  (the "PolyTrack2..." string): custom base62 encoding wrapped around double-zlib-compressed
  binary track data. This is what makes the generator's output a real, importable code
  rather than just an abstract layout.
- **`.github/workflows/generate-track.yml`** — the GitHub Actions workflow behind the
  Quick Start above.

## How the pieces fit together

All of this was reverse-engineered from real exported PolyTrack track codes (there's no
official format documentation) — decoding real tracks, testing hypotheses, and correcting
them against what actually happened in-game.

- **Grid:** the game's grid step is 4 units.
- **Straight / start / finish / checkpoint** each occupy a single grid cell. Rotation
  0 or 2 means the piece runs along the Z axis; 1 or 3 means the X axis.
- **Curves** are bigger than they look: each one spans a 2x2 block of cells with a wide
  radius-6 arc, not a single cell. Its rotation picks which two sides of that block it
  opens on, and the piece is a fixed right-turn shape — entering from its "near" face
  turns you right, entering from its "far" face turns you left. Getting this wrong
  (treating curves as 1-cell pieces) is what used to make generated tracks fall apart.
- **Ramps** are a single cell like a straight piece, but the next piece sits one height
  level higher (or lower, for a downhill piece). Only one ramp type (id 33) has been
  confirmed this way; PolyTrack has at least 10 more ramp shapes/sizes that aren't wired
  in yet (see "Known limitations" below).

## Known limitations

- **Only one ramp type is used.** PolyTrack has 11 ramp pieces of different lengths and
  heights; only the smallest is confirmed and enabled in the generator. Using the others
  without testing them the same way caused floating, disconnected track sections.
- **Loops (tracks that return to their own start) aren't generated** — only point-to-point
  tracks (start → checkpoints → finish). Closing a loop needs the last piece to land back
  on the start's exact position and height, which is a harder constraint than this
  generator currently solves for.
- **Checkpoint order** is numbered 0, 1, 2... in the order the track visits them; this
  matches how the pieces were placed but hasn't been separately confirmed against the
  game's own checkpoint-order rules.

## Credits

The track code container format (compression + custom base62 encoding) was reverse-engineered
by [Ireozar](https://codeberg.org/Ireozar)'s open-source
[`polytrack-codes`](https://docs.rs/polytrack-codes) Rust crate. The piece IDs, curve/ramp
geometry, and connection rules on top of that were worked out from scratch for this project
by decoding real exported tracks.
