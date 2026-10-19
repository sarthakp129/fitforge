/**
 * exerciseService.js
 * Extensible exercise discovery layer unifying:
 *  1. Built-in curated catalogue (102 exercises with biomechanical tags)
 *  2. User custom exercises (persisted in SQLite custom_exercises table)
 *  3. Biomechanical substitution finder (matching movement patterns and joint safety)
 */
import { EXERCISES, exerciseById } from './planEngine.js';
import { all, get, run, parseJson } from '../db.js';

/**
 * Searches across built-in and user custom exercises.
 */
export function searchExercises({ query = '', muscle = '', category = '', equipment = '', userId = null, limit = 200 } = {}) {
  const q = String(query || '').toLowerCase().trim();
  const targetMuscle = String(muscle || '').toLowerCase().trim();
  const cat = String(category || '').toLowerCase().trim();
  const eq = String(equipment || '').toLowerCase().trim();

  // 1. Built-in exercises
  let list = EXERCISES.map((e) => ({ ...e, source: 'built_in' }));

  if (cat && cat !== 'all' && cat !== 'custom') {
    list = list.filter((e) => e.category === cat);
  }
  if (eq && eq !== 'all') {
    list = list.filter((e) => e.equipment === eq);
  }
  if (targetMuscle && targetMuscle !== 'all') {
    list = list.filter((e) => (e.muscles || []).some((m) => m.toLowerCase().includes(targetMuscle)));
  }
  if (q) {
    list = list.filter((e) =>
      `${e.name} ${(e.muscles || []).join(' ')} ${e.pattern || ''} ${e.category} ${e.equipment}`.toLowerCase().includes(q)
    );
  }

  // 2. User custom exercises
  let customList = [];
  if (userId) {
    try {
      const rows = all('SELECT * FROM custom_exercises WHERE user_id = ? ORDER BY id DESC', userId);
      customList = rows.map((r) => {
        const muscles = parseJson(r.muscles, []);
        return {
          id: `custom_ex_${r.id}`,
          db_id: r.id,
          name: r.name,
          category: r.category || 'isolation',
          equipment: r.equipment || 'dumbbell',
          muscles: Array.isArray(muscles) ? muscles : [muscles].filter(Boolean),
          pattern: r.pattern || 'accessory',
          instructions: r.instructions || '',
          source: 'custom',
        };
      });

      if (cat && cat !== 'all') {
        customList = customList.filter((e) => cat === 'custom' || e.category === cat);
      }
      if (eq && eq !== 'all') {
        customList = customList.filter((e) => e.equipment === eq);
      }
      if (targetMuscle && targetMuscle !== 'all') {
        customList = customList.filter((e) => (e.muscles || []).some((m) => m.toLowerCase().includes(targetMuscle)));
      }
      if (q) {
        customList = customList.filter((e) =>
          `${e.name} ${(e.muscles || []).join(' ')} ${e.pattern || ''} ${e.category} ${e.equipment}`.toLowerCase().includes(q)
        );
      }
    } catch {
      /* ignore */
    }
  }

  const combined = [...customList, ...list];

  const categories = [...new Set(['custom', ...EXERCISES.map((e) => e.category)])].filter(Boolean);
  const equipments = [...new Set(EXERCISES.map((e) => e.equipment))].filter(Boolean);
  const muscles = [...new Set(EXERCISES.flatMap((e) => e.muscles || []))].sort();

  return {
    count: combined.length,
    exercises: combined.slice(0, limit),
    facets: {
      categories,
      equipment: equipments,
      muscles,
    },
  };
}

/**
 * Gets exercise details by id.
 */
export function getExerciseById(id, userId = null) {
  if (!id) return null;
  const target = String(id).trim();

  // Custom exercise
  if (target.startsWith('custom_ex_') && userId) {
    const dbId = Number(target.replace('custom_ex_', ''));
    const r = get('SELECT * FROM custom_exercises WHERE id = ? AND user_id = ?', dbId, userId);
    if (r) {
      return {
        id: `custom_ex_${r.id}`,
        db_id: r.id,
        name: r.name,
        category: r.category || 'isolation',
        equipment: r.equipment || 'dumbbell',
        muscles: parseJson(r.muscles, []),
        pattern: r.pattern || 'accessory',
        instructions: r.instructions || '',
        source: 'custom',
      };
    }
  }

  const builtin = exerciseById(target);
  if (builtin) return { ...builtin, source: 'built_in' };

  return null;
}

/**
 * Finds biomechanically safe substitutions for an exercise.
 */
export function getExerciseSubstitutes(exerciseId, userId = null, { equipment = null, maxResults = 6 } = {}) {
  const base = getExerciseById(exerciseId, userId);
  if (!base) return [];

  const baseMuscles = new Set((base.muscles || []).map((m) => m.toLowerCase()));
  const allAvailable = EXERCISES.filter((e) => e.id !== base.id);

  // Score candidates: same pattern gets +3, each overlapping muscle gets +2, same equipment gets +1
  const scored = allAvailable.map((candidate) => {
    let score = 0;
    if (candidate.pattern && base.pattern && candidate.pattern === base.pattern) {
      score += 4;
    }
    const overlap = (candidate.muscles || []).filter((m) => baseMuscles.has(m.toLowerCase())).length;
    score += overlap * 2;
    if (equipment && candidate.equipment === equipment) {
      score += 3;
    } else if (candidate.equipment === base.equipment) {
      score += 1;
    }
    return { exercise: candidate, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxResults).map((s) => s.exercise);
}

/**
 * Custom exercise persistence.
 */
export function createCustomExercise(userId, data) {
  const name = String(data.name || '').trim().slice(0, 120);
  if (!name) throw new Error('Exercise name is required.');

  const category = String(data.category || 'isolation').trim().slice(0, 50);
  const equipment = String(data.equipment || 'dumbbell').trim().slice(0, 50);
  const pattern = String(data.pattern || 'accessory').trim().slice(0, 50);
  const instructions = String(data.instructions || '').trim().slice(0, 2000);

  let muscles = [];
  if (Array.isArray(data.muscles)) muscles = data.muscles;
  else if (typeof data.muscles === 'string') muscles = data.muscles.split(',').map((s) => s.trim()).filter(Boolean);

  const { lastInsertRowid } = run(
    `INSERT INTO custom_exercises (user_id, name, category, equipment, muscles, pattern, instructions)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    userId, name, category, equipment, JSON.stringify(muscles), pattern, instructions
  );

  return {
    id: `custom_ex_${lastInsertRowid}`,
    db_id: lastInsertRowid,
    name,
    category,
    equipment,
    muscles,
    pattern,
    instructions,
    source: 'custom',
  };
}

export function deleteCustomExercise(userId, id) {
  const dbId = Number(String(id).replace('custom_ex_', ''));
  const res = run('DELETE FROM custom_exercises WHERE id = ? AND user_id = ?', dbId, userId);
  return res.changes > 0;
}

export function getUserCustomExercises(userId) {
  const rows = all('SELECT * FROM custom_exercises WHERE user_id = ? ORDER BY name ASC', userId);
  return rows.map((r) => ({
    id: `custom_ex_${r.id}`,
    db_id: r.id,
    name: r.name,
    category: r.category || 'isolation',
    equipment: r.equipment || 'dumbbell',
    muscles: parseJson(r.muscles, []),
    pattern: r.pattern || 'accessory',
    instructions: r.instructions || '',
    source: 'custom',
    created_at: r.created_at,
  }));
}
