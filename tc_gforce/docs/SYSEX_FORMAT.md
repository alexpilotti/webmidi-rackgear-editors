# G-Force User bank dump format

TC Electronic never published the G-Force SysEx format. Everything here was
worked out from dumps of a real unit (`samples/`), sent with
**Utility → User Bank to MIDI**. Items marked *guess* are not confirmed yet.
`tests/run.ts` checks the confirmed items against the samples.

## Samples

| File | User bank contents |
|---|---|
| `gforce-user-bank-a.syx` | User 1 = "Mono Reverb" (copied from ROM), DECAY TIME 2.4 s |
| `gforce-user-bank-b.syx` | as A, renamed "TEST ABC" |
| `gforce-user-bank-c.syx` | as B, DECAY TIME 2.5 s |
| `gforce-user-bank-d.syx` | User 1 "Mono Reverb", User 2 "Tremendous Delay", User 5 "Rhythmic"; Users 3–4 empty |

A first capture with an empty User bank sent only the header message, with a
block count of `02` (its data blocks were not recorded).

## Messages

All messages start with `F0 00 20 1F` (TC Electronic) and the SysEx device ID
(`00` on the sampled unit; *guess:* the I/O Setup "Sysex device ID" setting).

**Header**, 9 bytes:

```
F0 00 20 1F id 10 nh nl F7
```

`nh nl` = number of data blocks that follow (`00 0C` = 12, `00 32` = 50).
*Guess:* a 14-bit count, high 7 bits first.

**Data block**, 137 bytes, sent once per block:

```
F0 00 20 1F id 11 ix  n0 n1 … n127  ck F7
```

- `ix`: block index, 0, 1, 2 … *Guess:* it wraps at 128 in long dumps.
- `n0 … n127`: 64 data bytes, each sent as two nibbles, **high nibble first**.
- `ck`: `(−sum of the 64 decoded bytes) & 0x7F`. Confirmed on every block of
  all four samples.

Decoding the blocks in order gives a byte stream of `64 × count` bytes.

## Byte stream

| Offset | Size | Meaning |
|---|---|---|
| `0x00` | 4 | magic `DD EE AA BB` |
| `0x04` | 100 | one byte per User slot: `01` = stored, `00` = empty |
| `0x68` | 614 × n | one record per slot, User 1 … the last stored slot |
| … | | zero padding to a multiple of 64 |

Empty slots below the last stored one are sent as 614 zero bytes. Slots after
the last stored one are not sent, so a bank with only User 1 stored is 12
blocks, and one with User 5 as the last stored slot is 50 blocks:
`0x68 + 5 × 614 = 3174` bytes, padded to 3200.

## Preset record (614 bytes)

| Offset | Size | Meaning |
|---|---|---|
| `0x000` | 2 | preset number, big-endian: `00 E1` = User 1, `00 E2` = User 2, `00 E5` = User 5. *Guess:* 224 + the User number (after the 225 ROM presets). |
| `0x002` | 20 | name, ASCII, padded with spaces |
| `0x016` | 592 | parameters; not decoded yet, except: |
| `0x253` | 1 | Reverb DECAY TIME in 0.1 s steps (`18` = 2.4 s, `19` = 2.5 s), on the "Mono Reverb" preset |

The name and DECAY TIME offsets come from diffing samples A–C: nothing else
changed. *Guess:* the DECAY TIME offset is the same in every preset. The
other presets may lay out their blocks differently.

The checklist of parameters still to find, and the method, is in
[PARAMETERS.md](PARAMETERS.md).

## Open questions

- The meaning of the other 591 parameter bytes. Each needs a dump pair that
  differs by one known change, like B → C.
- Whether the record layout depends on the routing or the blocks in use.
- Whether the G-Force accepts a dump with a different SysEx ID, and what it
  answers after **MIDI to User Bank** (no reply has been seen yet).
