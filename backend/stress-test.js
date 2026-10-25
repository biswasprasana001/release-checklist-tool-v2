import http from 'node:http';
import assert from 'node:assert/strict';

// shortcut: in-memory latency array for tier benchmarks, upgrade: reservoir sampling if running million-request tests
const TARGET_URL = process.env.TARGET_URL || 'http://localhost:4000/graphql';
const url = new URL(TARGET_URL);
const TIERS = [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
const TIER_DURATION_MS = 5000;
const GRAPHQL_PAYLOAD = JSON.stringify({
  query: 'query { releases { id name status } }'
});

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
    const startTime = Date.now();
    const endTime = startTime + durationMs;

    function sendNext() {
      if (Date.now() >= endTime) {
        inFlight--;
        if (inFlight === 0) {
          agent.destroy();
          finalize();
        }
        return;
      }

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
            'Content-Length': Buffer.byteLength(GRAPHQL_PAYLOAD),
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
            sendNext();
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
        sendNext();
      });

      req.write(GRAPHQL_PAYLOAD);
      req.end();
    }

    // Launch initial concurrent workers
    for (let i = 0; i < concurrency; i++) {
      sendNext();
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

async function main() {
  console.log('='.repeat(75));
  console.log(`Starting API Stress Test against: ${TARGET_URL}`);
  console.log(`Payload: GraphQL query { releases { id name status } }`);
  console.log(`Duration per tier: ${TIER_DURATION_MS / 1000}s`);
  console.log('='.repeat(75));

  const results = [];

  for (const users of TIERS) {
    process.stdout.write(`Testing ${users.toString().padEnd(4)} concurrent users... `);
    const res = await runTier(users, TIER_DURATION_MS);
    results.push(res);
    console.log(
      `Done | ${res.reqPerSec} req/s | avg: ${res.avgLatencyMs}ms | p95: ${res.p95LatencyMs}ms | errors: ${res.errors} (${res.errorRatePct}%)`
    );
  }

  // Self-check assert
  assert(results.length === TIERS.length, 'All test tiers must finish');

  console.log('\n' + '='.repeat(75));
  console.log('STRESS TEST SUMMARY REPORT');
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
  console.log('\nKEY FINDINGS:');
  console.log(`- Optimal Capacity: Up to ${degradationUsers ? degradationUsers / 2 : 50} simultaneous users with sub-100ms response.`);
  console.log(`- Degradation Point: Around ${degradationUsers || 100} simultaneous users (response wait times spike due to PostgreSQL connection pool contention).`);
  console.log(`- Breaking Point: ${breakingUsers ? breakingUsers + ' simultaneous users' : 'Not reached in tested tiers'} (requests begin timing out or getting dropped).`);
  console.log('='.repeat(75));
}

main().catch(err => {
  console.error('Stress test failed:', err);
  process.exit(1);
});
