import test from 'node:test';
import assert from 'node:assert/strict';
import { computeStatus, resolvers, pool, invalidateCache } from './server.js';

test('Status computation rules', () => {
  assert.equal(computeStatus([]), 'Planned');
  assert.equal(computeStatus([0]), 'Ongoing');
  assert.equal(computeStatus([0, 1, 2, 3]), 'Ongoing');
  assert.equal(computeStatus([0, 1, 2, 3, 4, 5, 6]), 'Done');
});

test('GraphQL Resolvers - CRUD flow', async () => {
  // 1. Create
  const created = await resolvers.Mutation.createRelease(null, {
    name: 'v3.0.0-rc1',
    date: '2026-11-15',
    additionalInfo: 'Pre-release test'
  });
  assert.equal(created.name, 'v3.0.0-rc1');
  assert.equal(created.status, 'Planned');

  // 2. Query
  const single = await resolvers.Query.release(null, { id: created.id });
  assert.equal(single.name, 'v3.0.0-rc1');

  // 3. Update steps
  const updated = await resolvers.Mutation.updateRelease(null, {
    id: created.id,
    completedSteps: [0, 1]
  });
  assert.equal(updated.status, 'Ongoing');

  // 4. Complete all 7 steps
  const done = await resolvers.Mutation.updateRelease(null, {
    id: created.id,
    completedSteps: [0, 1, 2, 3, 4, 5, 6]
  });
  assert.equal(done.status, 'Done');

  // 5. Delete
  const deleted = await resolvers.Mutation.deleteRelease(null, { id: created.id });
  assert.equal(deleted, true);

  // 5b. Stress test cleanup mutation
  await resolvers.Mutation.createRelease(null, { name: '[STRESS_TEST] dummy', date: '2026-10-22' });
  const cleanedCount = await resolvers.Mutation.deleteStressTestData();
  assert(cleanedCount >= 1, 'deleteStressTestData must remove records starting with [STRESS_TEST]');

  // 6. Cache verification
  const list1 = await resolvers.Query.releases();
  const list2 = await resolvers.Query.releases();
  assert.equal(list1, list2); // in-memory cache returns same reference

  // 7. Single-flight deduplication under concurrency
  invalidateCache();
  const concurrentCalls = await Promise.all([
    resolvers.Query.releases(),
    resolvers.Query.releases(),
    resolvers.Query.releases()
  ]);
  assert.equal(concurrentCalls[0], concurrentCalls[1]);
  assert.equal(concurrentCalls[1], concurrentCalls[2]);

  await pool.end();
});
