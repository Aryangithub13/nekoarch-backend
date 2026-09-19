import { EventEmitter } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { startTestDatabase } from '../../../test-support/postgres.js';

const mocks = vi.hoisted(() => ({
  query: vi.fn(), end: vi.fn(), on: vi.fn(), stop: vi.fn(), rm: vi.fn(),
}));

vi.mock('node:net', () => ({
  createServer: () => ({
    once: vi.fn(),
    listen: (_port: number, _host: string, ready: () => void) => ready(),
    address: () => ({ port: 54321 }),
    close: (done: () => void) => done(),
  }),
}));
vi.mock('node:fs/promises', () => ({
  mkdtemp: async () => '/tmp/designflow-harness-fixture',
  readFile: async () => '', readdir: async () => [], rm: mocks.rm,
}));
vi.mock('embedded-postgres', () => ({
  default: class {
    async initialise() {}
    async start() {}
    stop = mocks.stop;
  },
}));
vi.mock('pg', () => ({
  default: { Pool: class { query = mocks.query; end = mocks.end; on = mocks.on; } },
}));

function connect(client: EventEmitter) {
  const subscription = mocks.on.mock.calls.find(([event]) => event === 'connect');
  // Model a successfully connected pooled client, without a real listener.
  subscription?.[1](client);
}

describe('temporary PostgreSQL teardown', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.query.mockResolvedValue({ rows: [] });
    mocks.end.mockResolvedValue(undefined);
    mocks.stop.mockResolvedValue(undefined);
    mocks.rm.mockResolvedValue(undefined);
  });

  it('waits for every client to disconnect even when pool.end resolves first', async () => {
    const database = await startTestDatabase();
    const first = new EventEmitter();
    const second = new EventEmitter();
    connect(first);
    connect(second);
    const stopping = database.stop();
    let concurrentStopFinished = false;
    const concurrentStop = database.stop().then(() => { concurrentStopFinished = true; });
    await setImmediate();
    expect(mocks.end).toHaveBeenCalledTimes(1);
    expect(mocks.stop).not.toHaveBeenCalled();
    expect(concurrentStopFinished).toBe(false);
    first.emit('end');
    await setImmediate();
    expect(mocks.stop).not.toHaveBeenCalled();
    second.emit('end');
    await Promise.all([stopping, concurrentStop]);
    expect(mocks.stop).toHaveBeenCalledTimes(1);
    expect(mocks.rm).toHaveBeenCalledTimes(1);
  });

  it('also waits for client disconnects when database setup fails', async () => {
    const client = new EventEmitter();
    mocks.query.mockImplementationOnce(async () => {
      connect(client);
      throw new Error('setup failed');
    });
    const starting = startTestDatabase();
    const failure = expect(starting).rejects.toThrow('setup failed');
    await setImmediate();
    expect(mocks.end).toHaveBeenCalledTimes(1);
    expect(mocks.stop).not.toHaveBeenCalled();
    client.emit('end');
    await failure;
    expect(mocks.stop).toHaveBeenCalledTimes(1);
    expect(mocks.rm).toHaveBeenCalledTimes(1);
  });
});
