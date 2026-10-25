import test from 'node:test';
import assert from 'node:assert/strict';
import { computeStatus, resolvers, pool } from './server.js';

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

  await pool.end();
});
