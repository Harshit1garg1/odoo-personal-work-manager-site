import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorkService } from '../server/service.js';
import { DemoService } from '../server/demo.js';

test('service refuses key identity changes and keeps user connections separate', async () => {
  const connections = new Map(), audit = [];
  const store = { get: s => connections.get(s), put: (s, c) => connections.set(s, c), remove: s => connections.delete(s), audit: (...args) => audit.push(args) };
  let userId = 7;
  const calls = [];
  const client = { call: async (connection, operation, args) => { calls.push({ connection, operation, args }); return operation === 'context' ? { protocol: 1, user: { id: userId } } : { records: [] }; } };
  const service = new WorkService(store, client);
  await assert.rejects(service.invoke('alice', 'list'), /Connect/);
  await service.connect('alice', { apiKey: 'alice' });
  await service.connect('bob', { apiKey: 'bob' });
  await service.invoke('bob', 'list', { company_id: 3 });
  assert.equal(calls.at(-1).connection.apiKey, 'bob');
  assert.equal(calls.at(-2).args.company_id, 3);
  userId = 8;
  await assert.rejects(service.invoke('alice', 'list'), /another user/);
  service.disconnect('alice'); assert.equal(connections.has('alice'), false); assert.equal(connections.has('bob'), true);
});
test('demo creates only after confirmation, returns one receipt on repeated execution', async () => {
  const service = new DemoService();
  const before = service.records.todo.length;
  const plan = await service.invoke('demo', 'prepare', { concept: 'todo', action: 'create', values: { name: 'Follow up' } });
  assert.equal(service.records.todo.length, before);
  await assert.rejects(service.invoke('demo', 'execute', { operation_id: plan.operation_id, confirmed: false }), /Confirm/);
  const args = { operation_id: plan.operation_id, confirmed: true };
  const result = await service.invoke('demo', 'execute', args);
  assert.deepEqual(await service.invoke('demo', 'execute', args), result);
  assert.deepEqual(await service.invoke('demo', 'result', args), result);
  assert.equal(service.records.todo.length, before + 1);
});
test('demo detects intervening changes, separates cancellation and leaves unknown completion unknown', async () => {
  const service = new DemoService();
  const plan = await service.invoke('demo', 'prepare', { concept: 'task', action: 'complete', record_id: 21 });
  service.records.task[0].name = 'Another user changed this';
  await assert.rejects(service.invoke('demo', 'execute', { operation_id: plan.operation_id, confirmed: true }), /changed/);
  service.records.task.push({ id: 99, name: 'Cancelled task', completion: 'cancelled' });
  const list = await service.invoke('demo', 'list', { concept: 'task', limit: 1 });
  assert.equal(list.summary.done, 1); assert.equal(list.summary.cancelled, 1); assert.equal(list.next_offset, 1);
  assert.equal((await service.invoke('demo', 'list', { concept: 'project' })).summary.done, null);
});
