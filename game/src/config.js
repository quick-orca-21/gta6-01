// Shared constants for Palm City Heat: the city's shape, the sunset palette and the tuning numbers
// every other module reads. One place to change how big the city is or how fast anything moves.

// The city is a grid of roads. Roads run along x and z at every multiple of ROAD_STEP from
// -GRID..GRID; the blocks between them hold the buildings.
export const GRID = 3; // roads at -3..3 steps each way (7 avenues, 7 streets)
export const ROAD_STEP = 56; // distance between neighbouring roads
export const ROAD_HALF = 8; // half the width of a road (16 wide)
export const BLOCK_HALF = (ROAD_STEP - ROAD_HALF * 2) / 2; // 20: half the buildable block
export const CITY_EDGE = GRID * ROAD_STEP + ROAD_HALF; // 176: last road's outer edge
export const WORLD_SEED = 20261119;

// The shore: sand starts at z = BEACH_Z, the waterline at WATER_Z, south of the city (+z).
export const BEACH_Z = 196;
export const WATER_Z = 224;

// Sunset palette.
export const COLORS = {
  sky: 0x2a1450,
  fog: 0x59355e,
  sun: 0xffb36b,
  ground: 0x241a33,
  road: 0x2e2438,
  roadLine: 0xffc46b,
  sidewalk: 0x4a3a5c,
  sand: 0xc9a06a,
  water: 0x11607a,
  sandWet: 0xa8825c,
};

// Player tuning.
export const PLAYER = {
  walkSpeed: 5.2,
  runSpeed: 8.6,
  radius: 0.85,
  maxHealth: 100,
  punchRange: 2.4,
  punchDamage: 34,
};

// Car tuning (arcade).
export const CAR = {
  accel: 26,
  brake: 34,
  reverseMax: 11,
  drag: 0.55,
  gripTurn: 1.9, // steering rate scale
  radius: 2.3,
  maxHealth: 100,
};

// Wanted levels: crimes add heat, heat decays when the police lose sight of you.
export const HEAT = {
  steal: 1.0,
  runOver: 1.6,
  shootPed: 2.0,
  shootCar: 0.6,
  punchPed: 0.6,
  hitCop: 1.2,
  crash: 0.25,
  decayPerSecond: 0.09,
  decayDelay: 5, // seconds out of sight before heat starts to fall
  max: 5,
};

// Where the story starts: on foot outside the Harborlight Garage, south-east of downtown.
export const START_POS = { x: 128, z: 128 };
export const GARAGE_POS = { x: 140, z: 140 }; // Mara's garage forecourt (mission 1 drop-off)
export const MARA_POS = { x: 132, z: 133 }; // Mara waits by the garage doors
