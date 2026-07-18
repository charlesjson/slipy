'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');

class BackendClient extends EventEmitter {
  constructor({ executable, args = [], timeoutMs = 3000, spawnProcess = spawn }) {
    super();
    this.executable = executable;
    this.args = args;
    this.timeoutMs = timeoutMs;
    this.spawnProcess = spawnProcess;
    this.process = null;
    this.disabled = false;
    this.ready = false;
    this.buffer = '';
    this.nextId = 1;
    this.pending = new Map();
  }

  start() {
    if (this.process) return;
    if (this.disabled) throw new Error('Rust backend is unavailable');
    const child = this.spawnProcess(this.executable, this.args, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.process = child;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => this.onData(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => this.emit('log', chunk.trimEnd()));
    child.once('error', (error) => this.fail(child, error));
    child.once('exit', (code, signal) => this.fail(child, new Error(`Rust backend exited (${signal || code})`)));
  }

  request(method, params = {}, { timeoutMs = this.timeoutMs } = {}) {
    try { this.start(); } catch (error) { return Promise.reject(error); }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Rust backend request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      this.process.stdin.write(`${JSON.stringify({ id, method, params })}\n`, (error) => {
        if (error) this.reject(id, error);
      });
    });
  }

  onData(chunk) {
    this.buffer += chunk;
    let newline;
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { this.emit('log', `Invalid backend response: ${line}`); continue; }
      if (typeof message.event === 'string') {
        this.emit(`event:${message.event}`, message.payload);
        continue;
      }
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        const error = new Error(typeof message.error === 'string' ? message.error : message.error.message);
        if (message.error.code) error.code = message.error.code;
        pending.reject(error);
      } else {
        if (pending.method === 'ping') this.ready = true;
        pending.resolve(message.result);
      }
    }
  }

  reject(id, error) {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    pending.reject(error);
  }

  fail(child, error) {
    if (this.process !== child) return;
    this.process = null;
    this.disabled = true;
    this.ready = false;
    child.removeAllListeners();
    for (const id of [...this.pending.keys()]) this.reject(id, error);
    this.emit('unavailable', error);
  }

  stop() {
    const child = this.process;
    this.process = null;
    this.disabled = true;
    this.ready = false;
    if (child) {
      child.removeAllListeners();
      child.kill();
    }
    for (const id of [...this.pending.keys()]) this.reject(id, new Error('Rust backend stopped'));
  }

  isAvailable() { return Boolean(this.process) && this.ready && !this.disabled; }
}

function backendExecutable({ packaged, resourcesPath = process.resourcesPath, projectRoot = path.join(__dirname, '../..') }) {
  return packaged
    ? path.join(resourcesPath, 'backend', 'slipy-backend')
    : path.join(projectRoot, 'backend', 'target', 'debug', 'slipy-backend');
}

module.exports = { BackendClient, backendExecutable };
