/**
 * planEngine — deterministic, offline plan generator.
 *
 * Two jobs:
 *  1. It is the *fallback* whenever Groq is unavailable, rate-limited, or the
 *     key has no budget left, so FitForge never shows an empty screen.
 *  2. It defines the canonical JSON schema that the AI is also forced to
 *     return, so the frontend has exactly one renderer for both sources.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  macroTargets, tdee, bmr, calorieTarget, clamp, round, ageFrom, GOALS, weeklyRate,
} from './nutrition.js';

const here = dirname(fileURLToPath(import.meta.url));
const EXERCISES = JSON.parse(readFileSync(join(here, '../data/exercises.json'), 'utf8'));
const FOODS = JSON.parse(readFileSync(join(here, '../data/foods.json'), 'utf8'));

export const exerciseById = (id) => EXERCISES.find((e) => e.id === id) || null;

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export const EQUIPMENT_FILTERS = {
  full_gym: null,
  barbell_and_dumbbell: ['barbell', 'dumbbell', 'bodyweight', 'band', 'kettlebell'],
  dumbbell_only: ['dumbbell', 'bodyweight', 'band', 'kettlebell'],
  home_bodyweight: ['bodyweight', 'band'],
  machines_cables: ['machine', 'cable', 'dumbbell', 'bodyweight'],
};

const REP_SCHEMES = {
  strength: { main: '3-6', acc: '6-8', load: '80-88% 1RM', restMain: 180, restAcc: 120, rpe: '8-9' },
  muscle_gain: { main: '6-10', acc: '10-15', load: '65-80% 1RM', restMain: 120, restAcc: 75, rpe: '7-8' },
  recomp: { main: '6-10', acc: '10-15', load: '68-80% 1RM', restMain: 120, restAcc: 75, rpe: '7-8' },
  maintain: { main: '6-10', acc: '10-15', load: '65-78% 1RM', restMain: 105, restAcc: 70, rpe: '7' },
  fat_loss: { main: '8-12', acc: '12-20', load: '60-75% 1RM', restMain: 90, restAcc: 45, rpe: '7-8' },
  endurance: { main: '12-20', acc: '15-25', load: '55-70% 1RM', restMain: 60, restAcc: 45, rpe: '7' },
};

const SETS = {
  beginner: { main: 3, acc: 2, primary: 2, secondary: 2 },
  intermediate: { main: 4, acc: 3, primary: 3, secondary: 3 },
  advanced: { main: 4, acc: 3, primary: 3, secondary: 4 },
};

const SPLITS = {
  1: ['full'],
  2: ['full_a', 'full_b'],
  3: ['push', 'pull', 'legs'],
  4: ['upper', 'lower', 'push', 'pull'],
  5: ['push', 'pull', 'legs', 'upper', 'lower'],
  6: ['push', 'pull', 'legs', 'push', 'pull', 'legs'],
  7: ['push', 'pull', 'legs', 'upper', 'lower', 'full_a', 'recovery'],
};

const LIB = {
  push: {
    primary: ['bench_press', 'db_bench_press', 'overhead_press', 'db_shoulder_press', 'incline_db_press', 'machine_chest_press', 'dips', 'push_up'],
    secondary: ['incline_barbell_press', 'cable_fly', 'pec_deck', 'lateral_raise', 'cable_lateral_raise'],
    finisher: ['tricep_pushdown', 'overhead_tricep_ext', 'skullcrusher', 'face_pull'],
  },
  pull: {
    primary: ['pull_up', 'lat_pulldown', 'barbell_row', 'seated_cable_row', 'db_row', 'chest_supported_row', 'chin_up', 'assisted_pullup', 'inverted_row', 't_bar_row'],
    secondary: ['straight_arm_pulldown', 'face_pull', 'rear_delt_fly', 'face_pull_prone', 'shrug'],
    finisher: ['barbell_curl', 'db_curl', 'hammer_curl', 'incline_db_curl', 'preacher_curl'],
  },
  legs: {
    primary: ['back_squat', 'front_squat', 'goblet_squat', 'leg_press', 'trap_bar_deadlift', 'hack_squat', 'bulgarian_split_squat'],
    secondary: ['romanian_deadlift', 'hip_thrust', 'walking_lunge', 'step_up', 'leg_extension', 'lying_leg_curl', 'seated_leg_curl'],
    finisher: ['standing_calf_raise', 'seated_calf_raise', 'glute_bridge', 'nordic_curl'],
  },
  upper: {
    primary: ['bench_press', 'barbell_row', 'overhead_press', 'lat_pulldown', 'db_bench_press', 'seated_cable_row'],
    secondary: ['incline_db_press', 'chest_supported_row', 'lateral_raise', 'face_pull', 'pec_deck'],
    finisher: ['db_curl', 'tricep_pushdown', 'hammer_curl', 'overhead_tricep_ext'],
  },
  lower: {
    primary: ['back_squat', 'romanian_deadlift', 'leg_press', 'hip_thrust', 'front_squat'],
    secondary: ['bulgarian_split_squat', 'walking_lunge', 'leg_extension', 'lying_leg_curl'],
    finisher: ['standing_calf_raise', 'seated_calf_raise'],
  },
  full_a: {
    primary: ['back_squat', 'bench_press', 'barbell_row'],
    secondary: ['db_shoulder_press', 'romanian_deadlift', 'pull_up', 'goblet_squat', 'db_row'],
    finisher: ['plank', 'farmer_carry', 'db_curl', 'tricep_pushdown'],
  },
  full_b: {
    primary: ['trap_bar_deadlift', 'overhead_press', 'lat_pulldown'],
    secondary: ['bulgarian_split_squat', 'incline_db_press', 'db_row', 'leg_press'],
    finisher: ['hanging_leg_raise', 'suitcase_carry', 'hammer_curl', 'lateral_raise'],
  },
  full: {
    primary: ['back_squat', 'bench_press', 'barbell_row', 'overhead_press', 'romanian_deadlift', 'pull_up', 'goblet_squat', 'db_row'],
    secondary: ['leg_press', 'incline_db_press', 'seated_cable_row', 'hip_thrust', 'bulgarian_split_squat', 'lateral_raise'],
    finisher: ['plank', 'farmer_carry', 'db_curl', 'tricep_pushdown', 'hanging_leg_raise'],
  },
  recovery: {
    primary: ['incline_walk', 'rowing_machine'],
    secondary: ['bird_dog', 'dead_bug', 'side_plank'],
    finisher: ['jump_rope', 'med_ball_slam'],
  },
};

const CORE_IDS = ['plank', 'hanging_leg_raise', 'cable_crunch', 'dead_bug', 'pallof_press', 'ab_wheel', 'side_plank', 'russian_twist', 'woodchop'];
const CONDITIONING_IDS = ['treadmill_intervals', 'assault_bike', 'rowing_machine', 'battle_ropes', 'jump_rope', 'burpee', 'sled_push', 'incline_walk', 'kb_swing'];

const CUES = {
  squat: 'Brace 360°, knees tracking over toes, depth to at least parallel, drive the floor apart.',
  'hip hinge': 'Push hips back, soft knees, flat back, bar stays against the legs, squeeze glutes to lock out.',
  'horizontal press': 'Shoulder blades retracted and depressed, elbows ~45-60°, bar to lower chest, press up and slightly back.',
  'vertical press': 'Ribs down, glutes squeezed, bar path close to the face then back over the ears.',
  'vertical pull': 'Initiate with the elbows, chest tall, pull to the collarbone/upper chest, control the eccentric.',
  'horizontal pull': 'Hinge slightly, pull the elbows to the hips, pause one second, resist the stretch back.',
  'isolation curl': 'Elbows pinned, no swinging, 2-second negative, full stretch at the bottom.',
  'isolation extension': 'Elbows fixed, squeeze at lockout for one second, slow eccentric.',
  'isolation raise': 'Lead with the elbows, small forward lean, no shrugging, stop at shoulder height.',
  fly: 'Soft elbows, stretch across the chest, squeeze as the hands meet, never go past shoulder line.',
  'anti-extension': 'Ribs down, pelvis neutral, breathe behind the brace, no lower-back arch.',
  flexion: 'Exhale hard at the top, slow 3-second lowering, no momentum.',
  carry: 'Tall spine, shoulders packed, short fast steps, breathe continuously.',
  conditioning: 'Nasal breathing where possible, pace you could hold 20% longer, stop before form breaks.',
  'olympic lift': 'Only when technique is coached; otherwise swap for a trap-bar jump or KB swing.',
  complex: 'Move between exercises without resting; reset the bar only between rounds.',
  rotation: 'Rotate from the thoracic spine, hips stay square, control both directions.',
  'anti-rotation': 'Resist the pull, ribs down, no hip shift.',
  'anti-lateral flexion': 'Stack shoulders over the elbow, hips lifted, long line from head to heels.',
  'scapular raise': 'Thumbs up, lift from the shoulder blade, no shrug.',
  'isolation shrug': 'Straight up, 1-second hold, slow down, no rolling.',
  'isolation pulldown': 'Arms straight, pull from the lats, squeeze at the bottom.',
  'unilateral squat': 'Front foot flat, torso upright, rear leg is support only, even reps both sides.',
  'unilateral lunge': 'Long stride, vertical shin, drop the back knee toward the floor.',
  'unilateral step': 'Step high, drive through the whole foot, no push off the floor leg.',
  'hip extension': 'Chin tucked, ribs down, squeeze glutes hard at the top, no lumbar overextension.',
  plyometric: 'Land soft and quiet, full reset between reps, quality over quantity.',
  power: 'Max intent on every rep, long rest, stop when bar speed drops.',
  'steady state': 'Zone 2: conversational pace, 60-70% max HR.',
  'isometric hold': 'Hold the position, breathe steadily the whole time, stop before form breaks rather than after.',
};

function cueFor(ex) {
  return CUES[ex.pattern] || CUES[ex.category] || 'Control the eccentric for 2-3 seconds, breathe out on the effort, never sacrifice position for load.';
}

function allowed(ex, equipment) {
  const f = EQUIPMENT_FILTERS[equipment];
  if (!f) return true;
  return f.includes(ex.equipment);
}

/**
 * Selects up to `count` exercises that are actually possible with the athlete's
 * equipment. Never violates the equipment filter — a home-bodyweight plan must
 * not contain a barbell, so shortfalls are handled by HOME_POOL top-ups below.
 */
function pick(ids, equipment, count, used) {
  const out = [];
  for (const id of ids) {
    if (out.length >= count) break;
    if (used.has(id)) continue;
    const ex = exerciseById(id);
    if (!ex || !allowed(ex, equipment)) continue;
    out.push(ex);
    used.add(id);
  }
  return out;
}

/** Always-available substitutes so no equipment profile produces an empty day. */
const HOME_POOL = {
  push: ['push_up', 'band_chest_press', 'pike_push_up', 'band_overhead_press', 'dips', 'band_lateral_raise', 'band_pushdown', 'handstand_push_up'],
  pull: ['inverted_row', 'band_row', 'towel_row', 'band_lat_pulldown', 'pull_up', 'chin_up', 'band_pull_apart', 'band_curl', 'superman'],
  legs: ['bodyweight_squat', 'reverse_lunge', 'glute_bridge', 'single_leg_rdl', 'band_squat', 'single_leg_bridge', 'wall_sit', 'step_up'],
  recovery: ['bird_dog', 'dead_bug', 'side_plank', 'plank', 'jump_rope', 'incline_walk'],
};
HOME_POOL.upper = [...HOME_POOL.push.slice(0, 4), ...HOME_POOL.pull.slice(0, 4)];
HOME_POOL.lower = [...HOME_POOL.legs];
HOME_POOL.full = [...HOME_POOL.legs.slice(0, 3), ...HOME_POOL.push.slice(0, 3), ...HOME_POOL.pull.slice(0, 3)];
HOME_POOL.full_a = HOME_POOL.full;
HOME_POOL.full_b = [...HOME_POOL.full].reverse();

function progressionFor(goal, experience) {
  if (experience === 'beginner') {
    return {
      model: 'Linear progression',
      rule: 'Add 2.5 kg (upper) / 5 kg (lower) every session once you hit the top of the rep range on all sets.',
      weekly: 'Volume stays flat for 3 weeks; load climbs steadily.',
      deload: 'Every 5th week: halve the sets, keep the load, stop every set 4 reps short.',
    };
  }
  if (goal === 'strength') {
    return {
      model: 'Wave loading',
      rule: 'Week 1 top set 3×85%, week 2 4×82%, week 3 5×78%, week 4 repeat with +2.5% on the top set.',
      weekly: 'Intensity undulates, volume drops as intensity rises.',
      deload: 'Week 4 is a reduced-volume repeat, not a true deload. Every 8th week take 5 days off heavy work.',
    };
  }
  return {
    model: 'Double progression',
    rule: 'Work within the rep range; when you hit the top rep on every set with clean form, add 2.5-5% next session.',
    weekly: 'Weeks 1-3 add a set or reps to the first two exercises, week 4 deloads.',
    deload: 'Every 4th week: 50% of the sets, same load, RPE ≤ 6.',
  };
}

function warmupBlock(focus) {
  const items = [
    { exercise: 'Zone 1 cardio (bike / rower / brisk walk)', detail: '4-6 min, build to a light sweat' },
    { exercise: 'Dynamic mobility flow', detail: 'world\'s greatest stretch ×5/side, leg swings ×10/side, shoulder CARs ×5' },
  ];
  if (['push', 'upper', 'full', 'full_a', 'full_b'].includes(focus)) {
    items.push({ exercise: 'Band pull-aparts + scap push-ups', detail: '2 × 15, wake up the stabilisers' });
  }
  if (['legs', 'lower', 'full', 'full_a', 'full_b'].includes(focus)) {
    items.push({ exercise: 'Bodyweight squat → hinge pattern', detail: '2 × 10, then 2 ramp sets at 40% and 60% of working load' });
  }
  items.push({ exercise: 'Ramp sets on the first lift', detail: '5 reps @ 50%, 3 @ 70%, 1 @ 85% of the working weight' });
  return { name: 'Warm-up', type: 'warmup', minutes: 10, items };
}

function finisherBlock(profile) {
  const items = [];
  if (['fat_loss', 'endurance'].includes(profile.goal)) {
    items.push({ exercise: 'Intervals', detail: profile.goal === 'fat_loss' ? '8 × 30 s hard / 90 s easy' : '5 × 3 min at threshold, 2 min easy' });
  }
  if (profile.focus_areas && /core|abs/i.test(profile.focus_areas)) {
    items.push({ exercise: 'Core circuit', detail: 'plank 45 s + dead bug ×10 + side plank 30 s/side, 3 rounds' });
  }
  items.push({ exercise: 'Cool-down', detail: '5 min easy walk + static stretch the two muscles you trained hardest, 30 s each' });
  return { name: 'Finisher & cool-down', type: 'finisher', minutes: 10, items };
}

export function buildTrainingPlan(profile, opts = {}) {
  const goal = profile.goal || 'recomp';
  const experience = profile.experience || 'intermediate';
  const equipment = profile.equipment || 'full_gym';
  const days = clamp(profile.days_per_week || 4, 1, 7);
  const minutes = clamp(profile.session_minutes || 60, 20, 150);
  const weeks = clamp(opts.weeks || 4, 1, 16);
  const scheme = REP_SCHEMES[goal] || REP_SCHEMES.recomp;
  const sets = SETS[experience] || SETS.intermediate;
  const split = SPLITS[days] || SPLITS[4];
  const injuries = String(profile.injuries || '').toLowerCase();
  const banned = [];
  if (/knee/.test(injuries)) banned.push('leg_extension', 'bulgarian_split_squat', 'walking_lunge', 'jump_rope', 'box_jump');
  if (/back|lumbar|disc/.test(injuries)) banned.push('deadlift', 'front_squat', 'back_squat', 'good_morning', 'sumo_deadlift');
  if (/shoulder/.test(injuries)) banned.push('overhead_press', 'dips', 'handstand_push_up', 'bench_press', 'arnold_press');
  if (/wrist|elbow/.test(injuries)) banned.push('barbell_curl', 'skullcrusher', 'straight_arm_pulldown');

  const used = new Set();
  const schedule = split.map((focus, i) => {
    const lib = LIB[focus] || LIB.full;
    const exercises = [];
    const filter = (list, n) =>
      pick(list, equipment, n, used).filter((e) => !banned.includes(e.id));

    const primaries = filter(lib.primary, sets.primary);
    const secondaries = filter(lib.secondary, sets.secondary);
    const finishers = filter(lib.finisher, experience === 'beginner' ? 1 : 2);

    const addExercise = (ex, role) => {
      const isMain = role === 'primary';
      const reps = isMain ? scheme.main : scheme.acc;
      const exSets = isMain ? sets.main : sets.acc;
      exercises.push({
        exercise_id: ex.id,
        name: ex.name,
        role,
        sets: exSets,
        reps,
        load: isMain ? scheme.load : `${Math.max(50, parseInt(scheme.load, 10) - 8)}-70% 1RM`,
        tempo: isMain ? '2-0-1' : '2-1-2',
        rest_s: isMain ? scheme.restMain : scheme.restAcc,
        rpe: scheme.rpe,
        muscles: ex.muscles,
        equipment: ex.equipment,
        cues: cueFor(ex),
        progression: isMain
          ? 'Add load when you top the rep range on all sets (double progression).'
          : 'Chase a deeper stretch and a harder squeeze before you add weight.',
      });
    };

    primaries.forEach((e) => addExercise(e, 'primary'));
    secondaries.forEach((e) => addExercise(e, 'secondary'));

    if (focus !== 'recovery' && exercises.length) {
      const core = pick(CORE_IDS.filter((id) => !banned.includes(id)), equipment, 1, used);
      core.forEach((e) => addExercise(e, 'accessory'));
    }
    if (['fat_loss', 'endurance'].includes(goal) && focus !== 'recovery') {
      const cond = pick(CONDITIONING_IDS.filter((id) => !banned.includes(id)), equipment, 1, used);
      cond.forEach((e) => addExercise(e, 'conditioning'));
    }
    finishers.forEach((e) => addExercise(e, 'accessory'));

    // Guarantee a usable session for every equipment profile: if the filtered
    // library came up short (e.g. home bodyweight), top up from HOME_POOL.
    const minimum = focus === 'recovery' ? 3 : experience === 'beginner' ? 5 : 6;
    if (exercises.length < minimum) {
      const lib = LIB[focus] || LIB.full;
      const extra = pick(
        [...lib.primary, ...lib.secondary, ...lib.finisher, ...(HOME_POOL[focus] || HOME_POOL.full)],
        equipment, minimum - exercises.length, used
      );
      extra.forEach((e) => addExercise(e, 'accessory'));
    }

    const workingSets = exercises.reduce((s, e) => s + e.sets, 0);
    return {
      day: i + 1,
      day_name: DAY_NAMES[i] || `Day ${i + 1}`,
      title: focus === 'recovery' ? 'Active Recovery & Mobility' : `${titleFor(focus)}${split.filter((f) => f === focus).indexOf(focus) > 0 ? ' B' : ''}`,
      focus,
      duration_min: focus === 'recovery' ? Math.round(minutes * 0.5) : minutes,
      blocks: [warmupBlock(focus), { name: 'Main work', type: 'main', items: [] }, finisherBlock(profile)],
      exercises,
      working_sets: workingSets,
      notes: focus === 'recovery'
        ? 'Keep the effort easy. The goal is blood flow and range of motion, not fatigue.'
        : `Log every set. Leave ${goal === 'strength' ? '1-2' : '1-3'} reps in reserve on the final set of each exercise.`,
    };
  });

  const totalSets = schedule.reduce((s, d) => s + d.working_sets, 0);

  return {
    meta: {
      name: planName(goal, days, experience),
      kind: 'training',
      weeks,
      days_per_week: days,
      session_minutes: minutes,
      goal,
      experience,
      equipment,
      weekly_working_sets: totalSets,
      generated_at: new Date().toISOString(),
    },
    overview: `${days} training days per week, ${weeks}-week block, ${minutes} minute sessions. ` +
      `${totalSets} working sets per week spread across the split below. Target ${GOALS[goal]?.label || goal} ` +
      `at roughly ${weeklyRate(profile) || 0} kg/week of bodyweight change.`,
    principles: [
      `Progressive overload with ${progressionFor(goal, experience).model.toLowerCase()}.`,
      'Every set logged: weight, reps, RPE. Unlogged training is uncoached training.',
      `Protein ${macroTargets(profile).protein_g} g/day, calories ${macroTargets(profile).calories} kcal/day.`,
      `${clamp(profile.sleep_hours || 7, 5, 10)} h sleep — adaptation happens off the gym floor.`,
      injuries ? `Working around: ${profile.injuries}. Pain above 3/10 means regress the exercise, not the effort.` : 'Warm up properly; joint pain is a stop signal, muscle burn is not.',
    ],
    schedule,
    progression: progressionFor(goal, experience),
    weekly_progression: Array.from({ length: weeks }, (_, i) => ({
      week: i + 1,
      label: i + 1 === weeks ? 'Deload' : `Build ${i + 1}`,
      volume: i + 1 === weeks ? '50% of sets, RPE ≤ 6' : `${100 + i * 5}% of week-1 load on main lifts`,
      instruction: i + 1 === weeks
        ? 'Same exercises, half the sets, leave 4 reps in reserve, add 10 min easy cardio daily.'
        : 'Hit the top of every rep range before adding load; keep rest periods honest.',
    })),
  };
}

function titleFor(focus) {
  return ({
    push: 'Push — Chest, Shoulders, Triceps',
    pull: 'Pull — Back, Biceps, Rear Delts',
    legs: 'Legs — Quads, Hams, Glutes',
    upper: 'Upper Body',
    lower: 'Lower Body',
    full: 'Full Body',
    full_a: 'Full Body A',
    full_b: 'Full Body B',
    recovery: 'Active Recovery',
  })[focus] || 'Training Day';
}

function planName(goal, days, experience) {
  const style = { strength: 'Strength', muscle_gain: 'Hypertrophy', recomp: 'Recomposition', fat_loss: 'Lean Out', endurance: 'Conditioning', maintain: 'Maintenance' }[goal] || 'Training';
  return `FitForge ${style} · ${days}×/week · ${experience}`;
}

/* ------------------------------ nutrition ------------------------------- */

const PLANT_OK = ['carb', 'fruit', 'veg', 'fat'];

const DIET_FILTERS = {
  vegan: (f) => {
    if (PLANT_OK.includes(f.category)) return true;
    if (f.category === 'supplement') return /plant|pea|soy/i.test(f.name);
    return f.tags.includes('vegan'); // tofu, tempeh, seitan, lentils, beans…
  },
  vegetarian: (f) => {
    if (PLANT_OK.includes(f.category) || f.category === 'supplement') return true;
    if (f.category === 'dairy') return true;
    return f.tags.some((t) => ['vegetarian', 'vegan', 'egg'].includes(t));
  },
  pescatarian: (f) =>
    DIET_FILTERS.vegetarian(f) || /salmon|tuna|cod|prawn|fish/i.test(f.name),
  omnivore: () => true,
};

function foodPool(pref, allergies = '') {
  const keep = DIET_FILTERS[pref] || DIET_FILTERS.omnivore;
  const bad = String(allergies).toLowerCase().split(/[,\s]+/).filter((s) => s.length > 2);
  return FOODS.filter((f) => {
    if (!keep(f)) return false;
    const hay = `${f.name} ${f.tags.join(' ')}`.toLowerCase();
    return !bad.some((a) => hay.includes(a));
  });
}

const byCategory = (pool, cat) => pool.filter((f) => f.category === cat || (cat === 'carb' && f.category === 'fruit'));

/** rotate deterministically so plans differ day to day but stay reproducible */
let cursor = 0;
function rotate(list, seed = 0) {
  if (!list.length) return null;
  return list[(seed + cursor++) % list.length];
}

function scaleGrams(food, targetKcal) {
  const g = clamp((targetKcal / (food.kcal / 100)) , 10, 400);
  return Math.round(g / 5) * 5;
}

function mealFoods(meal, pool, seed) {
  const items = [];
  let kcalLeft = meal.calories;
  let proteinLeft = meal.protein_g;

  const proteinSrc = rotate(byCategory(pool, 'protein'), seed);
  const carbSrc = rotate(byCategory(pool, 'carb'), seed + 3);
  const fatSrc = rotate(byCategory(pool, 'fat'), seed + 7);
  const vegSrc = rotate(byCategory(pool, 'veg'), seed + 11);

  const add = (food, grams) => {
    const item = mealFoods_item(food, grams);
    items.push(item);
    kcalLeft -= item.calories;
    proteinLeft -= item.protein_g;
    return item;
  };

  // 1. protein anchor — sized to the meal's protein target, not to calories
  if (proteinSrc) add(proteinSrc, Math.round(clamp(proteinLeft / (proteinSrc.protein_g / 100), 40, 350) / 5) * 5);

  // 2. volume/fibre, effectively free
  if (vegSrc) add(vegSrc, vegSrc.serving_g);

  // 3. fat to roughly a third of the meal's fat allowance
  if (fatSrc && kcalLeft > 120) {
    const fatKcal = Math.min(kcalLeft * 0.35, meal.fat_g * 9 * 0.7);
    add(fatSrc, scaleGrams(fatSrc, fatKcal));
  }

  // 4. carbs fill what is left
  if (carbSrc && kcalLeft > 60) add(carbSrc, Math.round(clamp(kcalLeft / (carbSrc.kcal / 100), 20, 600) / 5) * 5);

  // 5. close the gap: a single large carb serving caps at 600 g, so high-calorie
  //    meals need a second source. Keep topping up until within ~4%.
  const carbs = byCategory(pool, 'carb');
  const proteins = byCategory(pool, 'protein');
  for (let guard = 0; guard < 6 && kcalLeft > meal.calories * 0.04; guard++) {
    const source = proteinLeft > 8 && proteins.length
      ? rotate(proteins, seed + guard * 3)
      : rotate(carbs, seed + guard * 5 + 1);
    if (!source) break;
    const grams = Math.round(clamp(kcalLeft / (source.kcal / 100), 15, 500) / 5) * 5;
    if (grams < 15) break;
    add(source, grams);
  }

  return items;
}

function mealFoods_item(food, grams) {
  return {
    name: food.name,
    grams,
    calories: round((food.kcal / 100) * grams),
    protein_g: round((food.protein_g / 100) * grams, 1),
    carbs_g: round((food.carbs_g / 100) * grams, 1),
    fat_g: round((food.fat_g / 100) * grams, 1),
  };
}

export function buildNutritionPlan(profile, opts = {}) {
  const targets = macroTargets(profile);
  const base = tdee(profile);
  const pref = profile.diet_pref || 'omnivore';
  const pool = foodPool(pref, profile.allergies);
  const goal = profile.goal || 'recomp';
  const days = clamp(profile.days_per_week || 4, 1, 7);

  const highCal = targets.calories > 2900;
  const template = highCal
    ? [
        { name: 'Breakfast', pct: 0.22, time: '07:00' },
        { name: 'Lunch', pct: 0.28, time: '12:30' },
        { name: 'Pre-training', pct: 0.1, time: '16:00' },
        { name: 'Dinner', pct: 0.28, time: '19:30' },
        { name: 'Evening', pct: 0.12, time: '21:30' },
      ]
    : [
        { name: 'Breakfast', pct: 0.27, time: '07:30' },
        { name: 'Lunch', pct: 0.33, time: '12:30' },
        { name: 'Dinner', pct: 0.3, time: '19:00' },
        { name: 'Snack', pct: 0.1, time: '16:00' },
      ];

  cursor = 0;
  const meals = template.map((t, i) => {
    const calories = round(targets.calories * t.pct);
    const meal = {
      ...t,
      calories,
      protein_g: round(targets.protein_g * t.pct),
      carbs_g: round(targets.carbs_g * t.pct),
      fat_g: round(targets.fat_g * t.pct),
    };
    const foods = mealFoods(meal, pool, i * 5);
    const actual = foods.reduce(
      (a, f) => ({
        calories: a.calories + f.calories,
        protein_g: a.protein_g + f.protein_g,
        carbs_g: a.carbs_g + f.carbs_g,
        fat_g: a.fat_g + f.fat_g,
      }),
      { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
    );
    return {
      name: t.name,
      time: t.time,
      target_calories: calories,
      calories: round(actual.calories),
      protein_g: round(actual.protein_g, 1),
      carbs_g: round(actual.carbs_g, 1),
      fat_g: round(actual.fat_g, 1),
      foods,
      notes: i === 0
        ? 'Front-load protein — it drives satiety and muscle protein synthesis for the rest of the day.'
        : t.name === 'Pre-training'
          ? 'Low fat, easy carbs, 60-90 min before training.'
          : t.name === 'Evening'
            ? 'Slow-digesting protein before bed supports overnight recovery.'
            : 'Vegetables first, protein second, starch last — the order matters for fullness.',
    };
  });

  const totals = meals.reduce(
    (a, m) => ({
      calories: a.calories + m.calories,
      protein_g: a.protein_g + m.protein_g,
      carbs_g: a.carbs_g + m.carbs_g,
      fat_g: a.fat_g + m.fat_g,
    }),
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
  );

  const grocery = [...new Set(meals.flatMap((m) => m.foods.map((f) => f.name)))].sort();

  return {
    meta: {
      name: `FitForge ${GOALS[goal]?.label || goal} Nutrition`,
      kind: 'nutrition',
      diet_pref: pref,
      goal,
      generated_at: new Date().toISOString(),
    },
    targets: {
      ...targets,
      bmr: round(bmr(profile)),
      tdee: base,
      deficit_or_surplus: round(targets.calories - base),
      expected_rate: `${weeklyRate(profile) || 0} kg/week`,
      protein_pct: round((targets.protein_g * 4 * 100) / targets.calories),
      carbs_pct: round((targets.carbs_g * 4 * 100) / targets.calories),
      fat_pct: round((targets.fat_g * 9 * 100) / targets.calories),
    },
    rationale: `${round(bmr(profile))} kcal BMR (Mifflin-St Jeor) × ${profile.activity_level || 'moderate'} activity = ${base} kcal maintenance. ` +
      `A ${Math.round(((targets.calories - base) / base) * 100)}% adjustment targets ${GOALS[goal]?.label || goal} at about ${GOALS[goal]?.rate || 'steady'} progress, ` +
      `with protein at ${round(targets.protein_g / clamp(profile.weight_kg, 35, 250), 1)} g/kg to protect lean mass.`,
    meals,
    plan_totals: {
      calories: round(totals.calories),
      protein_g: round(totals.protein_g, 1),
      carbs_g: round(totals.carbs_g, 1),
      fat_g: round(totals.fat_g, 1),
    },
    training_day_adjustments: [
      `Training days (${days}/week): keep calories as written and place ${round(targets.carbs_g * 0.4)} g of carbs around the session.`,
      `Rest days: drop carbs to ${round(targets.carbs_g * 0.7)} g and add ${round(targets.fat_g * 0.2)} g fat — calories stay the same.`,
      'Hydrate to pale-straw urine colour; add a pinch of salt to water on heavy training days.',
    ],
    swap_list: pool.slice(0, 14).map((f) => ({
      food: f.name,
      per_100g: { calories: f.kcal, protein_g: f.protein_g, carbs_g: f.carbs_g, fat_g: f.fat_g },
      category: f.category,
    })),
    supplements: [
      { name: 'Creatine monohydrate', dose: '5 g daily, any time', note: 'Best-evidenced legal ergogenic. Optional but cheap and effective.' },
      { name: 'Vitamin D3', dose: '1000-2000 IU daily', note: 'Worth testing first if you get regular sun.' },
      { name: 'Whey / plant protein', dose: '1-2 scoops as needed', note: 'Only to close the protein gap, never to replace real food.' },
      ...(pref === 'vegan' ? [{ name: 'Vitamin B12', dose: '250 mcg daily or 2500 mcg weekly', note: 'Non-negotiable on a vegan diet.' }] : []),
    ],
    grocery,
    rules: [
      'Hit protein first, every meal, before you think about anything else.',
      '80% of calories from single-ingredient foods; the other 20% is whatever keeps this sustainable.',
      'Weigh food for two weeks to calibrate your eye — then you can go by portion.',
      `Track weekly average bodyweight, not daily. Adjust by ±${round(targets.calories * 0.05, -1)} kcal only after 2 flat weeks.`,
    ],
  };
}

/** Deterministic stand-in answer for the coach chat when AI is unavailable. */
export function coachFallback(profile, question = '') {
  const t = macroTargets(profile);
  const q = String(question).toLowerCase();
  if (/plateau|stuck|not losing|not gaining/.test(q)) {
    return `Two weeks of flat bodyweight is the trigger, not a single day. Right now your target is ${t.calories} kcal and ${t.protein_g} g protein. ` +
      `Check adherence for 7 days first — most plateaus are tracking drift, not metabolism. If adherence is honest and weight is flat, ` +
      `${profile.goal === 'fat_loss' ? `drop 200 kcal (to ${t.calories - 200}) or add 2,000 steps/day` : `add 200 kcal (to ${t.calories + 200}), mostly carbs around training`}. ` +
      `Strength going up while weight is flat means the recomp is working — leave it alone.`;
  }
  if (/protein/.test(q)) {
    return `Your target is ${t.protein_g} g/day (${round(t.protein_g / clamp(profile.weight_kg, 35, 250), 1)} g/kg). ` +
      `Spread it over ${Math.max(3, Math.ceil(t.protein_g / 40))} feeds of 30-45 g. Practical sources: 150 g cooked chicken breast ≈ 46 g, ` +
      `200 g Greek yogurt 0% ≈ 20 g, 3 whole eggs ≈ 19 g, 30 g whey ≈ 23 g.`;
  }
  if (/sore|doms|recovery|sleep|tired/.test(q)) {
    return `Soreness is not a progress metric — the log is. If you're sore beyond 72 h or sessions feel heavy at the same load, ` +
      `take the deload: 50% of your sets at the same weight for a week. Sleep ${clamp(profile.sleep_hours || 7, 7, 9)} h consistently, ` +
      `keep caffeine below 400 mg and none within 8 h of bed, and eat at ${t.calories} kcal with ${t.protein_g} g protein.`;
  }
  if (/supplement|creatine/.test(q)) {
    return `Creatine monohydrate 5 g/day is the only supplement I'd call essential-adjacent. Caffeine 3-6 mg/kg pre-training works. ` +
      `Everything else is marginal at best. Food, sleep and consistency beat any powder.`;
  }
  return `Based on your profile (${profile.goal || 'recomp'}, ${profile.experience || 'intermediate'}, ${profile.days_per_week || 4} days/week): ` +
    `train at ${t.calories} kcal with ${t.protein_g} g protein, ${t.carbs_g} g carbs and ${t.fat_g} g fat. ` +
    `Progress by topping the rep range before adding load, log every set, and re-weigh weekly under the same conditions. ` +
    `Ask me something specific — a stalled lift, a meal, a nagging joint — and I'll get precise. ` +
    `(Offline coach: AI generation is throttled right now.)`;
}

export { EXERCISES, FOODS };
