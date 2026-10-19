import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { ignoreLostStdio } from '../stdio.js';

function writeError(code) {
  return Object.assign(new Error(`write ${code}`), { code });
}

describe('ignoreLostStdio', () => {
  it.each(['EIO', 'EPIPE'])('swallows %s, so a lost terminal is not an uncaught exception', (code) => {
    const stream = new EventEmitter();
    ignoreLostStdio([stream]);
    expect(() => stream.emit('error', writeError(code))).not.toThrow();
  });

  it('rethrows any other write error, as Node would with no listener', () => {
    const stream = new EventEmitter();
    ignoreLostStdio([stream]);
    expect(() => stream.emit('error', writeError('ENOSPC'))).toThrow('write ENOSPC');
  });

  it('guards stdout and stderr by default', () => {
    const before = [process.stdout, process.stderr].map((s) => s.listenerCount('error'));
    ignoreLostStdio();
    try {
      expect(process.stdout.listenerCount('error')).toBe(before[0] + 1);
      expect(process.stderr.listenerCount('error')).toBe(before[1] + 1);
      expect(() => process.stderr.emit('error', writeError('EIO'))).not.toThrow();
    } finally {
      for (const s of [process.stdout, process.stderr]) {
        s.removeListener('error', s.listeners('error').at(-1));
      }
    }
  });
});

// Both entrypoints are checked as text, like worker-entrypoint.test.js:
// importing them starts a server and connects to Redis.
describe.each(['src/server.js', 'src/worker.js'])('%s', (file) => {
  it('guards stdio', () => {
    const source = fs.readFileSync(file, 'utf8');
    expect(source).toMatch(/import\s*\{\s*ignoreLostStdio\s*\}\s*from\s*'\.\/api\/utils\/stdio\.js'/);
    expect(source).toMatch(/^ignoreLostStdio\(\);$/m);
  });
});
