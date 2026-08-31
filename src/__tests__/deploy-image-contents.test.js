/**
 * Everything the start command needs must actually be in the Docker image.
 *
 * This is here because it happened. PR #42 changed the start command to
 * `node --import ./instrument.mjs src/server.js` in both package.json and
 * railway.toml, and never added instrument.mjs to the Dockerfile. The container
 * exited immediately with ERR_MODULE_NOT_FOUND, the healthcheck failed, and
 * Railway kept serving the previous version — so production silently stopped
 * receiving deploys for fourteen hours while CI stayed green the whole time.
 *
 * Nothing in the test suite could have caught it: every test runs against the
 * working tree, where the file plainly exists. The only place the two views
 * diverge is the image, so that is what this compares.
 */
import fs from 'node:fs';

const dockerfile = fs.readFileSync('Dockerfile', 'utf8');
const railway    = fs.readFileSync('railway.toml', 'utf8');
const pkg        = JSON.parse(fs.readFileSync('package.json', 'utf8'));

/** Paths COPY'd into the final image stage, as written in the Dockerfile. */
function copiedPaths() {
  const runnerStage = dockerfile.slice(dockerfile.indexOf('AS runner'));
  return runnerStage
    .split('\n')
    .filter(line => line.startsWith('COPY '))
    .map(line => line.replace(/^COPY\s+(--from=\S+\s+)?/, '').trim().split(/\s+/)[0]);
}

/** True when `file` is copied, either directly or inside a copied directory. */
function isInImage(file) {
  const normalised = file.replace(/^\.\//, '');
  return copiedPaths().some((src) => {
    const from = src.replace(/^\.\//, '').replace(/\/$/, '');
    return from === normalised || normalised.startsWith(`${from}/`);
  });
}

/**
 * Local files a start command depends on: the entry script, and anything
 * preloaded with --import or --require.
 */
function localFilesIn(command) {
  const tokens = command.split(/\s+/);
  const files = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === '--import' || tokens[i] === '--require' || tokens[i] === '-r') {
      if (tokens[i + 1]) files.push(tokens[i + 1]);
    } else if (/^\.?\.?\/?[\w./-]+\.(mjs|cjs|js)$/.test(tokens[i]) && !tokens[i].startsWith('-')) {
      files.push(tokens[i]);
    }
  }
  return files;
}

const railwayStart = railway.match(/^startCommand\s*=\s*"(.+)"$/m)?.[1] ?? null;

describe('the Docker image contains what the app is started with', () => {
  it('has a start command in railway.toml to check', () => {
    expect(railwayStart).toBeTruthy();
  });

  it.each(localFilesIn(railwayStart ?? ''))('railway.toml start needs %s, and the image has it', (file) => {
    expect(isInImage(file)).toBe(true);
  });

  it.each(localFilesIn(pkg.scripts?.start ?? ''))('npm start needs %s, and the image has it', (file) => {
    expect(isInImage(file)).toBe(true);
  });

  it('finds every referenced file on disk too, so the check is about the image', () => {
    for (const file of localFilesIn(railwayStart ?? '')) {
      expect(fs.existsSync(file.replace(/^\.\//, ''))).toBe(true);
    }
  });

  it('keeps package.json start and railway.toml startCommand in step', () => {
    // They are separate settings and only railway.toml is used in production,
    // so a change to one and not the other is invisible until deploy.
    const railwayFiles = localFilesIn(railwayStart ?? '').sort();
    const npmFiles     = localFilesIn(pkg.scripts?.start ?? '').sort();
    expect(npmFiles).toEqual(railwayFiles);
  });
});

describe('the healthcheck', () => {
  it('points at /ready, not /health', () => {
    // /health returns ok unconditionally; a deploy that could not reach
    // Postgres or Redis would be declared healthy and replace a working one.
    expect(railway).toMatch(/healthcheckPath\s*=\s*"\/ready"/);
  });
});
