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
| `--jump <0-1>` | 0.08 | How often jumps show up (an uphill ramp, then 1-2 cells of open air, then a landing) |
| `--start-height <n>` | 5 | Height the whole track starts at (0 = flat ground) |
| `--style <name>` | - | A preset from the PolyTrack map-types guide: `technical`, `speedtech`, `speedfun`, `fakespeed`, `fullspeed` (see below) |
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

## Styles

`--style` follows the Map Types Guide spectrum, from most braking/drifting/turns to least. Each style sets
how curvy, how hilly and how jumpy the track is, and changes what the quality score rewards. Measured on
40 tracks each (about 20 to 40 pieces):

| Style | Curves per 10 pieces | Typical longest straight | Ramps / jumps per track |
|---|---|---|---|
| `technical` | 6.5 | 2 pieces | 0 / 0 |
| `speedtech` | 5.0 | 3 pieces | 0.4 / 0.1 |
| `speedfun` | 4.0 | 5 pieces | 1 / 0.3 (same as the defaults) |
| `fakespeed` | 1.8 | 9 pieces | 3 / 1.7 |
| `fullspeed` | 0 | 28 pieces | 5 / 4 |

Notes: `--ramp`, `--jump`, `--cp-every` and `--name` replace a style's value. `--turn` only nudges the
random drafts - the style's scoring still steers the result back toward the style. Only the tight
`TurnShort` curve exists so far, so Full Speed is a straight run with hills and jumps until gentle curves
are added, and Speed Tech's "inversions" need wall-ride pieces the generator doesn't use yet.

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
- **Ramps** rise toward the direction given by their rotation (0/1/2/3 = north/west/south/east)
  and their block height is the *low* end. Going uphill means facing the ramp along your travel
  direction; going downhill is the same piece turned around. Three ramps are in use:
  `PlaneSlopeUp` (1 cell, +1 level), `PlaneSlopeUpLong` (2 cells, +2) and `PlaneSlope`
  (1 cell, +2). Measured from 9 real community routes, where the rule matched 94% of the
  junctions that could be checked.

## Known limitations

- **Only three ramp types are used.** The wide, half and left/right ramp variants are still out,
  because the routes don't contain enough of them to trust their size.
- **Loops (tracks that return to their own start) aren't generated** — only point-to-point
  tracks (start → checkpoints → finish). Closing a loop needs the last piece to land back
  on the start's exact position and height, which is a harder constraint than this
  generator currently solves for.
- **Checkpoint order** is numbered 0, 1, 2... in the order the track visits them; this
  matches how the pieces were placed but hasn't been separately confirmed against the
  game's own checkpoint-order rules.
- **Road pieces beyond the confirmed set** (TurnLong family, S-turns, the other ramps,
  intersections, wall-ride and tilted pieces, plain `Checkpoint`) are still out, because
  each needs a real exit-side test before it can connect safely.

## Credits

The track code container format (compression + custom base62 encoding) was reverse-engineered
by [Ireozar](https://codeberg.org/Ireozar)'s open-source
[`polytrack-codes`](https://docs.rs/polytrack-codes) Rust crate. The full piece ID list
comes from the [PolyModLoader wiki](https://wiki-vp.polymodloader.com/pmlapi/EditorExtras).
The curve/ramp connection geometry on top of both of those was worked out from scratch for
this project by decoding real exported tracks.
