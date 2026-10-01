'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
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
  assert.equal(client.isAvailable(), false);
  await client.request('ping');
  assert.equal(client.isAvailable(), true);
  assert.equal(client.supports('listener-scoped-stop'), false);
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

test('emits unsolicited backend event messages', () => {
  const client = new BackendClient({ executable: 'unused' });
  let payload;
  client.on('event:wheel', (value) => { payload = value; });
  client.onData('{"event":"wheel","payload":{"direction":"up"}}\n');
  assert.deepEqual(payload, { direction: 'up' });
});

test('tracks advertised capabilities and marks explicit remote rejections', async (t) => {
  const { client, child } = fakeBackend();
  t.after(() => client.stop());
  const ready = client.request('ping');
  child.stdout.write('{"id":1,"result":{"capabilities":["listener-scoped-stop"]}}\n');
  await ready;
  assert.equal(client.supports('listener-scoped-stop'), true);
  const request = client.request('start_x11_wheel');
  child.stdout.write('{"id":2,"error":"another listener is active"}\n');
  await assert.rejects(request, (error) => error.backendResponse === true);
  client.stop();
  assert.equal(client.supports('listener-scoped-stop'), false);
});

function fakeBackend() {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {};
  const client = new BackendClient({ executable: 'fixture', spawnProcess: () => child });
  return { client, child };
}

test('ignores invalid JSON values without losing a following response', async (t) => {
  const { client, child } = fakeBackend();
  t.after(() => client.stop());
  const response = client.request('ping');
  assert.doesNotThrow(() => child.stdout.write('null\n[]\n42\n{"id":1,"result":{"ok":true}}\n'));
  assert.deepEqual(await response, { ok: true });
});

test('rejects unserializable requests without leaving pending timers', async (t) => {
  const { client } = fakeBackend();
  t.after(() => client.stop());
  const params = {};
  params.cycle = params;
  await assert.rejects(client.request('invalid', params), /circular/i);
  assert.equal(client.pending.size, 0);
});

test('stream failure rejects all requests and disables the backend', async (t) => {
  const { client, child } = fakeBackend();
  t.after(() => client.stop());
  const one = client.request('one');
  const two = client.request('two');
  const results = Promise.all([assert.rejects(one, /broken pipe/), assert.rejects(two, /broken pipe/)]);
  assert.doesNotThrow(() => child.stdin.emit('error', new Error('broken pipe')));
  await results;
  assert.equal(client.isAvailable(), false);
  await assert.rejects(client.request('ping'), /unavailable/);
});

test('handles a delayed spawn error after the client is stopped', async () => {
  const { client, child } = fakeBackend();
  const pending = client.request('ping');
  client.stop();
  await assert.rejects(pending, /stopped/);
  assert.doesNotThrow(() => child.emit('error', new Error('spawn failed')));
});
