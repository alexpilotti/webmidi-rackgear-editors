// Copyright (C) 2026 Alessandro Pilotti
// SPDX-License-Identifier: AGPL-3.0-or-later

// Preset names of the TC Electronic G-Card (245 presets in card banks 1–3),
// from the preset table of its manual (docs/388-tcelectronicGForceBrochure.pdf).
// Bank 1 uses the names the unit stores (a dump of card bank 1): 19 differ from
// the manual, by its typos ("Rhyhmic"), the 20-character limit ("Subtle Jazz
// RevDelay") or case and punctuation. Bank b preset n is GCARD_NAMES[b - 1][n - 1].

export const GCARD_NAMES: readonly (readonly string[])[] = [
  // Card bank 1, spelled as the unit stores them (docs/samples/gforce-g-card-1.syx)
  [
    "Run Like Hell", "Tremendous Delay", "Drunk at Sea", "VibroVerber",
    "Rhythmic", "Wah Octadelay", "Harmonizer Pedal", "Heavens Arpeggiator",
    "Hells Arpeggiator", "Aural Vertigo", "Revvy Chorus Delay", "Basie Envelopes",
    "Revwapanic", "High Life Delay", "Subtle Jazz RevDelay", "Trans Wah Organ",
    "Philly Wah", "Rhythm Spread", "PJs Autowah", "Pedal Martians",
    "Instant Pumpkin", "Blues Drive Delay", "VariSpeedFlangeOrgan", "Mutron Bass Pedal",
    "PhaserBass VariSpeed", "Power Sweeper", "Funky Mosquito Buzz", "Jimi-s Cry Baby",
    "Woo Power", "Fuzy-s ARPsynthLead1", "VintageARPsynthQuack", "Psychedelic Sweeper1",
    "Psychedelic Sweeper2", "Real Auto Wah", "Flanged Cry Baby", "Guitar Trio",
    "Funk Rick O Shea", "Bionic Seagulls", "FazeTrem PedalShadow", "Franks Panwah",
    "Swell Strings Pedal", "Sweltering Pedal", "Tele Something Good", "Tap Swell-in",
    "Pedal Maj-Min", "Syntharpeggiator", "PanningOctaveChorus", "Thin Surfer Dude",
    "Whales-Tap Delay", "Piggy", "Vital Idol", "Ambient Stutter",
    "Wash", "Eno-Mono", "Spider Talk", "Visionary",
    "Bridge of Size", "Jezebel in Hell", "Spazz Monkey", "Miked JC120 Lator",
    "Miked JC120 Lator2", "Miked Ampulator 1", "Leslie Pedal", "Pedal Board 1",
    "CycloPanner", "Ambient Bloom 3", "Ambient Bloom 4", "Wonderful Life",
    "Talk To Me Fuzz", "FuzzFadeIn", "FuzzWahPedal", "Fuzz Funn",
    "Ghost Heart", "Odd Ball", "What RU Laughing At", "Amniotica  1",
    "Amniotica  2", "Sarggasso Trenchcoat", "SnapSynapse", "ChorVyrbe",
    "The Big C", "WahEkoWahDelay", "Secret Missionary", "TheOnlyGoodInYOUisME",
    "Martino 1", "Martino 2", "Martino 3", "SciFi Soundtrack",
    "Nylon 4ths", "Nylon 5ths", "EnGulfed", "Sembello Blue EZ",
    "Stringy 5ths", "Backwards In Time", "SembelloPulse", "Double Mint",
    "Lots of Overtones", "Medium Phuz + Mutron", "Sweepin Repercussion", "Swirling and Wet",
  ],
  // Card bank 2
  [
    "Infinite Filtersweep", "Clean Tele + Vibe", "Alice Warble", "LFO Surround Pan+Dly",
    "Play 1 Low Note", "Jangle King", "Rich and Clean", "Hillbilly Hippy Yeah",
    "Trancer Blaster", "The Crystal Cave", "Im Down There", "Echo 5 Buz Chamber 2",
    "Pik n Pedal Paintbox", "Hi5Buzz", "Trem-o-Verb-a-tail", "Vapor Trails",
    "Chicken Dust", "Raver Rezz Guitar", "Fart Jello", "Sexy Chicken",
    "Funky Pigeon", "Space Albatross", "Big Soft", "Play in 5ths Please",
    "Dark+Subtle", "Purty Sizic Shpace", "Slowfar", "Barroom Splatter",
    "Float Around", "Sweeping Saw Pulse", "Medieval Space", "Slow Vibro Sweep",
    "Alaska", "Corrines Shimmer", "Dis-Orient", "Shimmering",
    "ECM After Dark", "Mellow Blue", "Groove Pick", "Metropolis",
    "Depth", "Animal", "Strat Gotyer Tongue", "Stratocas Maximus",
    "Waffles", "Cat Bark", "Reverse Suck", "Hibandfunkatron",
    "HiQmuchron", "Methane Knee", "SquelchPappyPedal", "Neptune",
    "Funkadeliciousness", "Retro-Verb", "Talk Talk", "Pannergeist",
    "Slingblade", "Wow and Flutter", "Cowboys", "Head-East",
    "Swingphase", "Chorus Groove", "Echoplex", "Sus4 Pedal",
    "Hope DDL Dynamic Pan", "8va Sweeps", "Pedal+8va DDL Dynpan", "8va Up Dynamics",
    "5+8va Up Dynamics", "Chord Destroyer", "8va Up Dynattack", "Pansquish Dynamic",
    "Rhythmic PitchAscend", "Pitch Mod Pan Sicko", "Wild Duck", "LFO Funk",
    "Big Soft Pitcher", "Wahchoplexx", "Womanizer", "Two Tone",
    "Bob's Auto Womp", "Shimmer Without You", "Trem-O-Vibe", "Beloved",
    "Soul Rape", "Warm Place", "Massacre", "Waves of Light",
    "Hipness", "Upsy-Daisy", "Flashback", "Her Little Secret",
    "Dry As A Cloud", "Walking in the World", "Voodoo Puke", "Down to Earth",
    "Staccato Funk", "Chorusroom + Delay", "Extreme Dual Delays", "Simple Blues Delay",
  ],
  // Card bank 3
  [
    "Talking Guitar", "Ghengis Cohen", "Sunset Drive", "Back Seat Slap",
    "Fretless Heaven", "Down n Up Delays", "Chorusplate Echo", "Chatta Cross",
    "Mod-u-lator", "Wah Booty Room", "Grungesweep Echos", "ECM Echoverb",
    "Brite Doubled Room", "Glistener", "1200 Below Zero", "Voxsweep Spacedelay",
    "Slap Happy", "Ducked Tape Delay", "Emotional Lead", "Lead 1",
    "Wa Lead", "Bombastic Raunch", "Big Generator", "Ping-Pong",
    "Celestial Solo", "Clean Dream Lead", "Stereo Vibrato", "Strum Chorus",
    "Fusion Bass", "Rick Bass", "Echowobble", "Refractions",
    "Discipline", "Roto Vibey", "Sub Bass Earthquake", "Q36 Space Modulator",
    "James Brown Rhythm", "Super Stereo Rhythm", "Novo Tremolo", "Rez-o-matic Rhythm",
    "Rock n Rhythm Guitar", "Metal Flange", "Martian Lead Sitar", "Big Lead",
    "Panned Pitch",
  ],
];

/**
 * Blocks routed in each G-Card preset, read from the routing grids in
 * docs/samples/gforce-g-card-1.syx (card bank 1 copied to the User bank). Bit k
 * is the block with grid code 4 + k, as in ROM_BLOCKS. Banks 2 and 3 are not
 * dumped yet. Bank b preset n is GCARD_BLOCKS[b - 1][n - 1].
 */
export const GCARD_BLOCKS: readonly (readonly number[])[] = [
  [
    0x1d, 0x55, 0xc7, 0xc7, 0x19, 0x1a, 0x19, 0x18, 0x18, 0xc7,
    0xd0, 0x0b, 0x87, 0x50, 0x90, 0x0e, 0x1a, 0x19, 0x1b, 0x19,
    0x55, 0x30, 0x40, 0x0a, 0x0a, 0x22, 0x2a, 0x22, 0x2a, 0x2a,
    0x22, 0x62, 0x62, 0x02, 0x62, 0x99, 0x9b, 0x9b, 0x96, 0x87,
    0x18, 0x50, 0xff, 0xdf, 0xbb, 0x99, 0xdd, 0xff, 0xf5, 0x22,
    0x49, 0xa4, 0xd1, 0xd1, 0xd2, 0xde, 0xd4, 0x9a, 0xd1, 0xff,
    0xff, 0xff, 0x24, 0xff, 0x04, 0xdd, 0xdd, 0xc9, 0xea, 0xe8,
    0x32, 0x2a, 0x9f, 0xeb, 0xd6, 0xdf, 0xdf, 0xdf, 0xdf, 0xdf,
    0xdf, 0xdb, 0xdf, 0xdf, 0x9b, 0x9b, 0x9b, 0x5f, 0xdd, 0xdd,
    0xf9, 0x8b, 0xff, 0xf8, 0xf9, 0xd9, 0x9b, 0x77, 0xe7, 0xd8,
  ],
];
