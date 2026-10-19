/**
 * foodService.js
 * Extensible food discovery layer unifying:
 *  1. Curated built-in foods (95 base foods + common staples)
 *  2. User custom foods (persisted in SQLite custom_foods table)
 *  3. External food search via Open Food Facts (cached in SQLite external_food_cache)
 *
 * Designed with strict offline fallback: external API errors/timeouts never crash searches.
 */
import { FOODS } from './planEngine.js';
import { all, get, run, parseJson } from '../db.js';
import { clamp, round } from './nutrition.js';

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Normalizes an external food product from Open Food Facts into FitForge schema.
 */
function normalizeOffProduct(p) {
  if (!p) return null;
  const name = String(p.product_name || p.product_name_en || p.generic_name || '').trim();
  if (!name || name.length < 2) return null;

  const nutriments = p.nutriments || {};
  const kcal100 = Number(nutriments['energy-kcal_100g'] ?? nutriments['energy-kcal'] ?? nutriments['energy-kcal_value'] ?? 0);
  const protein100 = Number(nutriments.proteins_100g ?? nutriments.proteins ?? 0);
  const carbs100 = Number(nutriments.carbohydrates_100g ?? nutriments.carbohydrates ?? 0);
  const fat100 = Number(nutriments.fat_100g ?? nutriments.fat ?? 0);

  // Skip invalid items where all macros are missing or negative
  if (kcal100 <= 0 && protein100 <= 0 && carbs100 <= 0 && fat100 <= 0) return null;

  const servingQuantity = Number(p.serving_quantity) || 0;
  const servingG = servingQuantity > 0 && servingQuantity <= 2000 ? round(servingQuantity, 1) : 100;
  const brand = String(p.brands || p.brand_owner || '').split(',')[0].trim();

  return {
    id: `off_${p.code || p._id || Math.random().toString(36).slice(2, 9)}`,
    name: brand ? `${name} (${brand})` : name,
    brand,
    category: p.categories_tags?.[0]?.replace(/^en:/, '').replace(/-/g, ' ') || 'packaged',
    serving_g: servingG,
    kcal: round(kcal100, 1),
    protein_g: round(protein100, 1),
    carbs_g: round(carbs100, 1),
    fat_g: round(fat100, 1),
    tags: [brand, 'open_food_facts'].filter(Boolean),
    source: 'open_food_facts',
    barcode: p.code || null,
  };
}

/**
 * Queries Open Food Facts with timeout, caching results in SQLite.
 */
async function fetchFromOpenFoodFacts(query, barcode = null) {
  const cacheKey = barcode ? `off:barcode:${barcode.trim()}` : `off:q:${query.trim().toLowerCase()}`;

  // Check SQLite cache first
  try {
    const cached = get('SELECT data_json, created_at FROM external_food_cache WHERE query_key = ?', cacheKey);
    if (cached) {
      const age = Date.now() - new Date(cached.created_at).getTime();
      if (age < CACHE_TTL_MS) {
        return parseJson(cached.data_json, []);
      }
    }
  } catch {
    /* cache lookup failure shouldn't abort search */
  }

  // Construct request URL
  let url;
  if (barcode) {
    url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json`;
  } else {
    url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=15`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2500);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'FitForge-FitnessApp/1.0 (fitness-discovery-service)',
        Accept: 'application/json',
      },
    });
    clearTimeout(timeoutId);

    if (!res.ok) return [];

    const json = await res.json();
    let normalized = [];

    if (barcode && json.product) {
      const item = normalizeOffProduct(json.product);
      if (item) normalized.push(item);
    } else if (Array.isArray(json.products)) {
      normalized = json.products.map(normalizeOffProduct).filter(Boolean);
    }

    // Persist into cache
    if (normalized.length > 0) {
      try {
        run(
          `INSERT OR REPLACE INTO external_food_cache (query_key, data_json, created_at) VALUES (?, ?, datetime('now'))`,
          cacheKey,
          JSON.stringify(normalized)
        );
      } catch {
        /* best effort cache */
      }
    }

    return normalized;
  } catch {
    // Offline, timeout, or network error: return empty array cleanly
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Searches across built-in, user custom, and cached external foods.
 */
export async function searchFoods({ query = '', category = '', barcode = '', userId = null, limit = 100 } = {}) {
  const q = String(query || '').toLowerCase().trim();
  const cat = String(category || '').toLowerCase().trim();

  // 1. Built-in foods
  let localList = FOODS.map((f) => ({ ...f, source: 'built_in' }));
  if (cat && cat !== 'all' && cat !== 'custom') {
    localList = localList.filter((f) => f.category === cat);
  }
  if (q) {
    localList = localList.filter((f) =>
      `${f.name} ${(f.tags || []).join(' ')} ${f.category}`.toLowerCase().includes(q)
    );
  }

  // 2. User custom foods (if user authenticated)
  let customList = [];
  if (userId) {
    try {
      const rows = all(
        'SELECT * FROM custom_foods WHERE user_id = ? ORDER BY id DESC',
        userId
      );
      customList = rows.map((r) => ({
        id: `custom_${r.id}`,
        db_id: r.id,
        name: r.name,
        brand: r.brand || '',
        category: r.category || 'custom',
        serving_g: r.serving_g || 100,
        kcal: r.kcal,
        protein_g: r.protein_g,
        carbs_g: r.carbs_g,
        fat_g: r.fat_g,
        tags: ['custom', r.category].filter(Boolean),
        source: 'custom',
      }));

      if (cat && cat !== 'all') {
        customList = customList.filter((f) => cat === 'custom' || f.category === cat);
      }
      if (q) {
        customList = customList.filter((f) =>
          `${f.name} ${f.brand} ${f.category}`.toLowerCase().includes(q)
        );
      }
    } catch {
      /* ignore */
    }
  }

  // 3. External lookup (only if query is at least 3 chars or barcode specified)
  let externalList = [];
  if ((q.length >= 3 || barcode) && (!cat || cat === 'all' || cat === 'packaged')) {
    externalList = await fetchFromOpenFoodFacts(q, barcode);
  }

  // Combine: custom foods first, then exact/high-relevance local foods, then external
  const combined = [...customList, ...localList, ...externalList];

  // De-duplicate by name (case-insensitive)
  const seen = new Set();
  const unique = [];
  for (const item of combined) {
    const key = item.name.toLowerCase().trim();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(item);
    }
  }

  const allCategories = [
    ...new Set([
      'custom',
      ...FOODS.map((f) => f.category),
      ...customList.map((f) => f.category),
    ]),
  ].filter(Boolean);

  return {
    count: unique.length,
    foods: unique.slice(0, limit),
    categories: allCategories,
  };
}

/**
 * Finds a food by id or exact name.
 */
export function getFoodByIdOrName(idOrName, userId = null) {
  if (!idOrName) return null;
  const target = String(idOrName).trim();

  // Custom food check
  if (target.startsWith('custom_') && userId) {
    const dbId = Number(target.replace('custom_', ''));
    const r = get('SELECT * FROM custom_foods WHERE id = ? AND user_id = ?', dbId, userId);
    if (r) {
      return {
        id: `custom_${r.id}`,
        db_id: r.id,
        name: r.name,
        brand: r.brand || '',
        category: r.category || 'custom',
        serving_g: r.serving_g || 100,
        kcal: r.kcal,
        protein_g: r.protein_g,
        carbs_g: r.carbs_g,
        fat_g: r.fat_g,
        source: 'custom',
      };
    }
  }

  // Built-in check
  const builtin = FOODS.find((f) => f.id === target || f.name.toLowerCase() === target.toLowerCase())
    || FOODS.find((f) => target.toLowerCase().includes(f.name.split(',')[0].toLowerCase()));
  if (builtin) return { ...builtin, source: 'built_in' };

  return null;
}

/**
 * Custom food persistence.
 */
export function createCustomFood(userId, data) {
  const name = String(data.name || '').trim().slice(0, 120);
  if (!name) throw new Error('Food name is required.');

  const brand = String(data.brand || '').trim().slice(0, 100);
  const category = String(data.category || 'custom').trim().slice(0, 50);
  const serving_g = clamp(Number(data.serving_g) || 100, 1, 5000);
  const kcal = clamp(Number(data.kcal || data.calories) || 0, 0, 2000);
  const protein_g = clamp(Number(data.protein_g) || 0, 0, 200);
  const carbs_g = clamp(Number(data.carbs_g) || 0, 0, 200);
  const fat_g = clamp(Number(data.fat_g) || 0, 0, 200);

  const { lastInsertRowid } = run(
    `INSERT INTO custom_foods (user_id, name, brand, category, serving_g, kcal, protein_g, carbs_g, fat_g, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'custom')`,
    userId, name, brand, category, serving_g, kcal, protein_g, carbs_g, fat_g
  );

  return {
    id: `custom_${lastInsertRowid}`,
    db_id: lastInsertRowid,
    name, brand, category, serving_g, kcal, protein_g, carbs_g, fat_g, source: 'custom',
  };
}

export function deleteCustomFood(userId, id) {
  const dbId = Number(String(id).replace('custom_', ''));
  const res = run('DELETE FROM custom_foods WHERE id = ? AND user_id = ?', dbId, userId);
  return res.changes > 0;
}

export function getUserCustomFoods(userId) {
  const rows = all('SELECT * FROM custom_foods WHERE user_id = ? ORDER BY name ASC', userId);
  return rows.map((r) => ({
    id: `custom_${r.id}`,
    db_id: r.id,
    name: r.name,
    brand: r.brand || '',
    category: r.category || 'custom',
    serving_g: r.serving_g || 100,
    kcal: r.kcal,
    protein_g: r.protein_g,
    carbs_g: r.carbs_g,
    fat_g: r.fat_g,
    source: 'custom',
    created_at: r.created_at,
  }));
}
