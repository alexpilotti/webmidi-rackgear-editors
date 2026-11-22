// Copyright (C) 2026 Alessandro Pilotti
// SPDX-License-Identifier: AGPL-3.0-or-later

// Names of the 225 ROM presets, from the Preset List of the owner's manual
// (docs/G-Force_Manual_EN.pdf, printed pp.57–61). ROM 1–100 use the spelling the
// unit stores (docs/samples/gforce-rom-100.syx). ROM n is ROM_NAMES[n - 1].

export const ROM_NAMES: readonly string[] = [
  "Mono Reverb", "Mono Chorus", "Mono Dyn Delay", "Mono Harmony C-maj",
  "Mono Doubler", "Mono Tremolo", "Mono Touchwah", "Mono Phaser",
  "Mono Crank it Up", "Mono Pedal Delay", "Mono Pedal Pitch", "Mono Farout Phaser",
  "Stereo Reverb", "Stereo Chorus", "Stereo Wide Panner", "Stereo Dyn Delay",
  "Stereo Harmony C-maj", "Stereo Doubler", "Stereo Light Tremolo", "Stereo Summers Strum",
  "Stereo Clean Lead", "Stereo Crank it Up", "Stereo Touchwah", "Stereo Pedal Delay",
  "Stereo Pedal Pitch", "3-Way Reverb", "3-Way Chorus", "3-Way Delay Doubler",
  "3-Way Slap+Slow Dly", "3-Way Dyn Delay", "3-Way Harmony A-maj", "3-Way Doubler",
  "3-Way Lead Octave Up", "3-Way Panner", "3-Way LAs Favoured", "3-Way Pedal Reverb",
  "3-way Pedal Octaver", "Go Direct", "Clean Rhythm Room", "Clean notes n chords",
  "Garden Party", "Love and Affection", "Arpeggiators Dream", "Power Chord",
  "For Acoustic Guitar", "Troubadour", "Sunset Groove", "Lipstick Color",
  "Nice Chorus", "Lush Chorus", "Double Jeopardy", "Tone Girdle",
  "Phat Chorus", "Crowded House", "Captain Crunch", "Rockabilly Boogie",
  "Thick Ducktape Delay", "Slap Back Delay", "A Little bit Country", "On The Edge",
  "A Clean Fortress", "Gated Delay", "60s Flanging", "Funky Chorus",
  "Flange Yer Face", "Dream Phaser", "Churner", "Stereo Tremolo",
  "Beatle Chords", "Phased Tremolo", "In My Room", "Spin Off",
  "Vibropedal Room", "Tremolo + Reverb", "Day at the Beach", "Spinner",
  "Wahble Gatelike", "Filterfun Funkypick", "Park the Wah here", "Tube Scream",
  "Raunchy Rhythm", "Malcolm", "Rubbery Room", "Crunch Phasecomp",
  "Fuzzphaser Pedal", "A little Crunch", "Loose Tubes", "Less is Paul",
  "Yee Ha", "Flange Box", "Flanger in Verb", "Surround Reverb",
  "Guitar Hero", "Landau Clean", "Ballad Clean", "Ed Now and Then",
  "So Stern", "LA Studio rack", "Straight Lead", "Lead",
  "Westcoast Lead", "Fusionlead", "Clean Chorused Delay", "Clean Ducked Swell",
  "Echocomplex", "Pedal Feed Delay", "Final Frontier", "Wishey Wash Tap",
  "Twang Slap", "Answering Echo", "Wes M Jazz Lead", "Low Note Thicken",
  "Pitch -12 and -5", "C+W Diaton Solo in A", "Eats Your Attack", "Pedal Octave Down",
  "Pedal Octave Up", "Pitch Dm 5 and 3", "Pedal Add Octave Up", "Flanger Beautyverb",
  "Verb Morphed to Dly", "I've Been Drinking", "Panner Pedal", "Picking Style",
  "Envelope Filter", "Nervosa Doubler", "Blues Room", "Hammer to Fall",
  "Iron Man", "Thick'n Juicy Lead", "Smooth Tubedrive", "Duckman Lead",
  "Lead Pedal Wah", "Touch Wah Driven", "Pedal Iiaahh", "Driven Lead",
  "Octavia Lead", "The Smiths", "Cyber Sci-fi Surfer", "Steppers in Time",
  "Spaceyplace", "Bluebox Echophased", "Echoverb", "Duality Effects",
  "Bowling Multitaps", "Slow Swell Pad", "Expandelay", "Infinity and Beyond",
  "Deep Bass 9", "Flange Pedal Speed", "Duck on Crack", "Sus4 Dreamscape",
  "Crazy Brown Lead", "Eastern Ocean", "Skysaw Doubler", "Synthesized Leads",
  "Sexwah Pedalead Fuzz", "Industrial Mayhem", "Electric Church", "Trance Yer Ass Off",
  "Owner Solo", "Double Fridge Solo", "Tribute 2 Bootsy", "War of the Worlds",
  "Inside Out Dyn Pan", "Far Away Vibrato", "Dynamic Lesley", "Varispeed Phaser",
  "Dark Envelope Filter", "Touch Wah + Octave", "Who's Next.", "Broken Speaker",
  "Touch Res and Delay", "Jam With Loop", "Pedal Hold + Reverb", "Very Scary Horror",
  "Talking Whales", "Flyverb Ducker", "Chord Stabs", "Bright Room",
  "Church", "Grand Hall", "Cathedral", "Spring Reverb",
  "Slow Reverb", "Chorus Straight", "Chorus Straight Fast", "Flanger Straight",
  "Flanger Straight Fast", "Vibrato", "Classic Tremolo", "Stereo Tremolo",
  "Square Tremolo", "Stereo Pan Tap Tempo", "Surround Panner", "Straight Delay",
  "Two Delays", "Tape Delay", "Triplet Ping-Pong", "4 Tap Delay Pedal",
  "Dynamic Delay", "Soft Compressor", "Hard Compressor", "Limiter",
  "Dual Detune Pedal", "Whammy Down", "Whammy Up", "G-major Pitch Pedal",
  "D-minor 5 and 3", "Octave Dubbing", "Phase Off", "Phaser Pedal Speed",
  "Clean Wah Pedal", "Clean Touch-Wah", "Clean Auto Wah", "Formant Touch",
  "Formant Pedal", "Resonance Pedal", "Auto Resonance", "Drive 1",
  "Drive 2", "Drive 3", "Noise Gate Slow", "Noise Gate Slow",
  "Empty Routing",
];

/**
 * Blocks routed in ROM 1–100, read from their routing grids in
 * docs/samples/gforce-rom-100.syx (ROM 1–100 copied to User 1–100). Bit k is
 * the block with grid code 4 + k (CPR, FIL, PAN, PIT, DLY, DRV, CHO, REV). The
 * Recall page's SELECT grid shows them; later ROM presets are not dumped yet.
 */
export const ROM_BLOCKS: readonly number[] = [
  0x81, 0xc1, 0x91, 0x99, 0x89, 0x84, 0x8b, 0x92, 0xa1, 0xd1,
  0xc9, 0x96, 0x81, 0xc1, 0xc4, 0xd1, 0x99, 0x89, 0x84, 0xd1,
  0xd8, 0xf1, 0x8b, 0xd1, 0xc9, 0x80, 0xc0, 0x90, 0x10, 0x90,
  0xd8, 0x98, 0xd8, 0x84, 0xd0, 0x90, 0xd8, 0x03, 0xd1, 0xd3,
  0x13, 0x9f, 0xc3, 0xf3, 0xd3, 0x9f, 0x93, 0xcf, 0xc1, 0xd1,
  0x90, 0x13, 0xc3, 0x93, 0x18, 0x93, 0x98, 0x31, 0x91, 0xd8,
  0x98, 0xd0, 0xd3, 0xd3, 0xcb, 0xa3, 0xdf, 0x04, 0xc3, 0x96,
  0x84, 0x8c, 0xc9, 0x84, 0xd7, 0x84, 0xc3, 0xd3, 0x8e, 0xb2,
  0xf3, 0xf2, 0xeb, 0x3b, 0xb3, 0xf3, 0xf2, 0xe3, 0xdf, 0xc3,
  0xd1, 0xa7, 0x88, 0xd9, 0x98, 0x8a, 0x89, 0xdb, 0x99, 0x90,
];
