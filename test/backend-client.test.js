'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { BackendClient, backendExecutable } = require('../src/main/backend-client');

test('correlates concurrent backend requests and surfaces backend errors', async () => {
  const source = `
    require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
      const request = JSON.parse(line);
      const message = request.method === 'error'
        ? { id: request.id, error: 'fixture error' }
        : { id: request.id, result: { method: request.method, params: request.params } };
      process.stdout.write(JSON.stringify(message) + '\\n');
    });`;
  const client = new BackendClient({ executable: process.execPath, args: ['-e', source] });
  const [one, two] = await Promise.all([client.request('one', { value: 1 }), client.request('two', { value: 2 })]);
  assert.deepEqual(one, { method: 'one', params: { value: 1 } });
  assert.deepEqual(two, { method: 'two', params: { value: 2 } });
  await assert.rejects(client.request('error'), /fixture error/);
  client.stop();
});

test('resolves development and packaged backend paths', () => {
  assert.equal(backendExecutable({ packaged: false, projectRoot: '/project' }), '/project/backend/target/debug/slipy-backend');
  assert.equal(backendExecutable({ packaged: true, resourcesPath: '/resources' }), '/resources/backend/slipy-backend');
});

test('does not repeatedly spawn a backend that failed to start', async () => {
  let attempts = 0;
  const client = new BackendClient({
    executable: 'missing',
    spawnProcess: () => {
      attempts += 1;
      const { EventEmitter } = require('node:events');
      const child = new EventEmitter();
      child.stdout = new EventEmitter(); child.stdout.setEncoding = () => {};
      child.stderr = new EventEmitter(); child.stderr.setEncoding = () => {};
      child.stdin = { write: () => {} };
      process.nextTick(() => child.emit('error', new Error('not found')));
      return child;
    }
  });
  await assert.rejects(client.request('ping'), /not found/);
  await assert.rejects(client.request('ping'), /unavailable/);
  assert.equal(attempts, 1);
});

test('stop permanently disables the client and rejects pending requests', async () => {
  const source = `setInterval(() => {}, 1000); process.stdin.resume();`;
  const client = new BackendClient({ executable: process.execPath, args: ['-e', source], timeoutMs: 1000 });
  const pending = client.request('ping');
  client.stop();
  await assert.rejects(pending, /stopped/);
  await assert.rejects(client.request('ping'), /unavailable/);
});
