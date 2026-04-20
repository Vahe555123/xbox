const { initDb } = require('../src/db/schema');
const pool = require('../src/db/pool');
const config = require('../src/config');
const digisellerService = require('../src/services/digisellerService');

async function main() {
  const digisellerId = Number(process.argv[2]) || config.digiseller.defaultProductId;
  if (!digisellerId) throw new Error('Digiseller product id is required');

  await initDb();
  const { run, samples } = await digisellerService.refreshPriceRateTable({ digisellerId });
  console.log(JSON.stringify({
    runId: run.id,
    digisellerId: run.digiseller_id,
    status: run.status,
    samples: samples.length,
    minRate: run.min_rate,
    maxRate: run.max_rate,
    avgRate: run.avg_rate,
    first: samples[0] || null,
    last: samples[samples.length - 1] || null,
  }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
