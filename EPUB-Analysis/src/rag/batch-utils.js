async function mapWithConcurrency(items = [], worker, options = {}) {
  const values = Array.isArray(items) ? items : [];
  const concurrency = Math.max(1, Number(options.concurrency || 4));
  const stopOnError = options.stopOnError !== false;
  const results = new Array(values.length);
  let nextIndex = 0;
  let firstError = null;

  async function runWorker() {
    while (true) {
      if (firstError && stopOnError) {
        return;
      }

      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= values.length) {
        return;
      }

      try {
        results[currentIndex] = await worker(values[currentIndex], currentIndex);
      } catch (error) {
        if (stopOnError) {
          firstError = error;
          return;
        }

        results[currentIndex] = {
          error: error.message,
          failed: true,
          index: currentIndex,
        };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length || 1) }, () => runWorker())
  );

  if (firstError) {
    throw firstError;
  }

  return results;
}

function chunkIntoBatches(items = [], batchSize = 25) {
  const values = Array.isArray(items) ? items : [];
  const size = Math.max(1, Number(batchSize || 25));
  const batches = [];

  for (let index = 0; index < values.length; index += size) {
    batches.push(values.slice(index, index + size));
  }

  return batches;
}

module.exports = {
  chunkIntoBatches,
  mapWithConcurrency,
};
