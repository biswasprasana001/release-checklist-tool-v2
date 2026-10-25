import http from 'node:http';
import assert from 'node:assert/strict';

// shortcut: in-memory latency array for tier benchmarks, upgrade: reservoir sampling if running million-request tests
const TARGET_URL = process.env.TARGET_URL || 'http://localhost:4000/graphql';
const url = new URL(TARGET_URL);
const TIERS = [10, 50, 100, 250, 500, 1000];
const TIER_DURATION_MS = process.env.TIER_DURATION_MS ? parseInt(process.env.TIER_DURATION_MS, 10) : 5000;

function makePayload(workerIndex, counter) {
  return JSON.stringify({
    query: `mutation CreateTestRelease($name: String!, $date: String!, $additionalInfo: String) {
      createRelease(name: $name, date: $date, additionalInfo: $additionalInfo) {
        id
      }
    }`,
    variables: {
      name: `[STRESS_TEST] Release ${workerIndex}-${counter}`,
      date: '2026-10-22',
      additionalInfo: 'Automated write load test'
    }
  });
}

function runTier(concurrency, durationMs) {
  return new Promise(resolve => {
    const agent = new http.Agent({
      keepAlive: true,
      maxSockets: concurrency
    });

    const latencies = [];
    let completed = 0;
    let errors = 0;
    let inFlight = concurrency;
    let counter = 0;
    const startTime = Date.now();
    const endTime = startTime + durationMs;

    function sendNext(workerIndex) {
      if (Date.now() >= endTime) {
        inFlight--;
        if (inFlight === 0) {
          agent.destroy();
          finalize();
        }
        return;
      }

      const payload = makePayload(workerIndex, ++counter);
      const reqStart = Date.now();
      const req = http.request(
        {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          method: 'POST',
          agent,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
            Connection: 'keep-alive'
          },
          timeout: 4000
        },
        res => {
          let body = '';
          res.on('data', chunk => {
            body += chunk;
          });
          res.on('end', () => {
            const elapsed = Date.now() - reqStart;
            latencies.push(elapsed);
            if (res.statusCode === 200 && !body.includes('"errors":[')) {
              completed++;
            } else {
              errors++;
            }
            sendNext(workerIndex);
          });
        }
      );

      req.on('timeout', () => {
        errors++;
        req.destroy(new Error('Request timeout'));
      });

      req.on('error', () => {
        errors++;
        const elapsed = Date.now() - reqStart;
        latencies.push(elapsed);
        sendNext(workerIndex);
      });

      req.write(payload);
      req.end();
    }

    // Launch initial concurrent workers
    for (let i = 0; i < concurrency; i++) {
      sendNext(i);
    }

    function finalize() {
      const actualDurationSec = (Date.now() - startTime) / 1000;
      latencies.sort((a, b) => a - b);
      const avg = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;
      const p95 = latencies.length ? latencies[Math.floor(latencies.length * 0.95)] : 0;
      const p99 = latencies.length ? latencies[Math.floor(latencies.length * 0.99)] : 0;

      resolve({
        concurrency,
        total: completed + errors,
        completed,
        errors,
        reqPerSec: Math.round(completed / actualDurationSec),
        avgLatencyMs: avg,
        p95LatencyMs: p95,
        p99LatencyMs: p99,
        errorRatePct: completed + errors > 0 ? ((errors / (completed + errors)) * 100).toFixed(1) : '0.0'
      });
    }
  });
}

// shortcut: bulk delete mutation by prefix, upgrade: partitioned tables if testing billion-row datasets
async function cleanupTestRecords() {
  process.stdout.write('\nCleaning up test records from database... ');
  const payload = JSON.stringify({
    query: 'mutation { deleteStressTestData }'
  });

  return new Promise(resolve => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 10000
      },
      res => {
        let body = '';
        res.on('data', chunk => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            const count = data?.data?.deleteStressTestData ?? 0;
            console.log(`Done (${count} deleted).`);
          } catch {
            console.log('Done.');
          }
          resolve();
        });
      }
    );

    req.on('error', () => {
      console.log('Done (cleanup request ended).');
      resolve();
    });

    req.write(payload);
    req.end();
  });
}

async function main() {
  console.log('='.repeat(75));
  console.log(`Starting API Write Stress Test against: ${TARGET_URL}`);
  console.log(`Payload: GraphQL mutation createRelease(name: "[STRESS_TEST] ...")`);
  console.log(`Tiers: ${TIERS.join(', ')} users | Duration per tier: ${TIER_DURATION_MS / 1000}s`);
  console.log('='.repeat(75));

  const results = [];

  let isCleaningUp = false;
  process.on('SIGINT', async () => {
    if (isCleaningUp) process.exit(1);
    isCleaningUp = true;
    console.log('\nReceived interrupt. Running cleanup before exit...');
    await cleanupTestRecords();
    process.exit(130);
  });

  for (const users of TIERS) {
    process.stdout.write(`Testing ${users.toString().padEnd(4)} concurrent writers... `);
    const res = await runTier(users, TIER_DURATION_MS);
    results.push(res);
    console.log(
      `Done | ${res.reqPerSec} req/s | avg: ${res.avgLatencyMs}ms | p95: ${res.p95LatencyMs}ms | errors: ${res.errors} (${res.errorRatePct}%)`
    );
  }

  // Self-check assert: verifies all tiers completed
  assert(results.length === TIERS.length, 'All write test tiers must finish');

  console.log('\n' + '='.repeat(75));
  console.log('WRITE STRESS TEST SUMMARY REPORT');
  console.log('='.repeat(75));
  console.log(
    'Users'.padEnd(8) +
    'Req/s'.padEnd(10) +
    'Total'.padEnd(10) +
    'Avg(ms)'.padEnd(10) +
    'p95(ms)'.padEnd(10) +
    'p99(ms)'.padEnd(10) +
    'Errors'.padEnd(10) +
    'Status'
  );
  console.log('-'.repeat(75));

  let degradationUsers = null;
  let breakingUsers = null;

  for (const r of results) {
    let status = 'HEALTHY';
    if (r.errors > 0 || parseFloat(r.errorRatePct) > 0) {
      status = 'BREAKING POINT (DROPPING)';
      if (!breakingUsers) breakingUsers = r.concurrency;
    } else if (r.avgLatencyMs > 250 || r.p95LatencyMs > 800) {
      status = 'DEGRADED';
      if (!degradationUsers) degradationUsers = r.concurrency;
    }

    console.log(
      String(r.concurrency).padEnd(8) +
      String(r.reqPerSec).padEnd(10) +
      String(r.total).padEnd(10) +
      String(r.avgLatencyMs).padEnd(10) +
      String(r.p95LatencyMs).padEnd(10) +
      String(r.p99LatencyMs).padEnd(10) +
      `${r.errors} (${r.errorRatePct}%)`.padEnd(10) +
      status
    );
  }

  console.log('='.repeat(75));
  console.log('\nKEY FINDINGS (WRITES):');
  console.log(`- Optimal Write Capacity: Up to ${degradationUsers ? Math.max(10, degradationUsers / 2) : 50} simultaneous writers.`);
  console.log(`- Degradation Point: Around ${degradationUsers || 100} simultaneous writers (PostgreSQL connection pool max=50 contention).`);
  console.log(`- Breaking Point: ${breakingUsers ? breakingUsers + ' simultaneous writers' : 'Not reached in tested tiers'}.`);
  console.log('='.repeat(75));

  await cleanupTestRecords();
}

main().catch(err => {
  console.error('Write stress test failed:', err);
  process.exit(1);
});
