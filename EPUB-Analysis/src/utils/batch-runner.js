/**
 * Batch parallel runner utilities for EPUB validation.
 *
 * runInBatches   — processes items N at a time, bounded memory for large files
 * runWithConcurrency — semaphore-based, more granular control
 */

/**
 * Process items in sequential batches of parallel work.
 * Memory is bounded to batchSize concurrent operations at any time.
 *
 * @param {Array}    items      - items to process
 * @param {number}   batchSize  - concurrent items per batch
 * @param {Function} fn         - async (item, globalIndex) => result
 * @returns {Array} results in original order
 */
async function runInBatches(items, batchSize, fn) {
  const results = [];
  const size = Math.max(1, batchSize);
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    const batchResults = await Promise.all(
      batch.map((item, localIdx) => fn(item, i + localIdx))
    );
    results.push(...batchResults);
  }
  return results;
}

/**
 * Run with a rolling concurrency cap (semaphore pattern).
 * Results are returned in original order.
 *
 * @param {Array}    items         - items to process
 * @param {number}   maxConcurrent - max simultaneous operations
 * @param {Function} fn            - async (item, index) => result
 * @returns {Array} results in original order
 */
async function runWithConcurrency(items, maxConcurrent, fn) {
  const results = new Array(items.length);
  const pool = new Set();

  for (let i = 0; i < items.length; i++) {
    const idx = i;
    const p = fn(items[idx], idx).then((r) => {
      results[idx] = r;
      pool.delete(p);
    });
    pool.add(p);
    if (pool.size >= Math.max(1, maxConcurrent)) {
      await Promise.race(pool);
    }
  }
  await Promise.all(pool);
  return results;
}

/**
 * Read env integer with positive fallback.
 */
function envInt(name, fallback) {
  const v = parseInt(process.env[name] || "", 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

module.exports = { runInBatches, runWithConcurrency, envInt };
