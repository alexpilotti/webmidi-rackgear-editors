# G-Force photo checklist: lookup tables

Values of the editor's lookup tables that haven't been seen on the unit's
LCD yet. For each preset below: recall it (ROM, or the card bank with the
G-Card in), press the block key, and photograph the listed Edit pages. One
photo per page is enough; the title line shows the sub-algorithm.

The values come from the dumps in `samples/`. A value only counts where the
block is in the routing and in the right sub-algorithm, so the presets are
the fewest that cover every value (ROM first when it covers as many).

## Shot list

Every preset on the list has been photographed. The values still unseen
are below; no preset uses them, so they need a hand-set value on the unit.

## By table

Nothing: every value of every decoded table has been seen on the unit or placed by a dump.

Already seen, not listed: Room Type 0–2; Room Size 0–7 (all, HUGE the last); High Color 0–6;
Low Color 0–6; Color 0–7 (all); Ratio 0–15 (all); Chorus Curve 1–2
(at 0x23E: Triangle, Sine); Chorus Phase 0–2 (0, 90, 180: all the unit offers); Tremolo Curve 0 (Square); Surround Panner Curve 2 (Sine); Phaser Order 0–2 (all);
Tempo 0–16 (all; edit-parameters-4 placed the dotted and triplet values); LFO Speed 0–103 (all, from a video) and OFF = FF (-1, edit-parameters-4);
and the sub-algorithms Compressor SIMPLE and ADVANCED, Filter PARAMETRIC,
RESONANCE, WAH-WAH, FORMANT and PHASER, Pan+Trem SIMPLE TREMOLO, ADV. TREMOLO, SIMPLE PANNER and SURROUND PAN., Pitch
INTELLIGENT 2 VOICE, FIXED 1 VOICE, FIXED 2 VOICE and DUAL DETUNE, Delay STEREO, DUAL, DUAL TWO-TAP (both lines), QUAD-TAP and ONE-TAP, Chorus CLASSIC CHORUS, ADVANCED CHORUS, CLASSIC FLANGER and ADVANCED FLANGER,
Reverb SIMPLE and ADVANCED; Formant vowels 0–9 (HEAT, HIT, HEAD, HAD, BUT, FATHER, ALL, BOOT,
FOOT, BIRD); Simple Reverb TYPE 0–9 (all) and COLOR 0–7 (all); Resonance
TYPE 0–1, LOCUT/HICUT FR. (27/40/58 → 88.8/182/492 Hz, 70/77/89 → 3.77/5.20/9.04 kHz) and HI RESON.

The LFO SPEED table is complete (104 steps, 0.050 … 19.2 Hz, from a video). The Delay LOCUT and HICUT
are a long step table too. The cut filters so far:
step 0 = 10.0 Hz, 1 = 10.8 Hz, 25 = 63.2 Hz, 29 = 85.0 Hz, 32 = 106 Hz, 33 = 114 Hz, 39 = 178 Hz, 46 = 298 Hz, 52 = 464 Hz, 78 = 3.16 kHz,
80 = 3.66 kHz, 82 = 4.24 kHz, 83 = 4.56 kHz, 87 = 6.13 kHz, 99 = 14.9 kHz, 100 = 16.0 kHz. All sixteen fit 10 Hz × 1600^(n/100) (10 Hz … 16 kHz) to the digit, so the editor computes
the rest from it; the LOCUT and HICUT steps left are only spot checks.

No preset uses these values. To see them, set them by hand on any User preset and
photograph the page.
