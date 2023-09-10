import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll
} from 'vitest';
import * as fs from 'fs';
import {
  mkdir,
  symlink,
  readdir,
  readFile,
  writeFile
} from 'fs/promises';
import * as Path from 'path';
import { Readable } from 'stream';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import rimraf from 'rimraf';
import { readdirp, ReaddirpStream } from './index.js';

const pRimraf = promisify(rimraf);
const __dirname = Path.dirname(fileURLToPath(import.meta.url));

const supportsDirent = 'Dirent' in fs;
const isWindows = process.platform === 'win32';
const root = Path.join(__dirname, 'test-fixtures');

let testCount = 0;
let currPath;

const read = async options => readdirp(currPath, options);

const touch = async (files = [], dirs = []) => {
  for (const name of files) {
    await writeFile(Path.join(currPath, name), `${Date.now()}`);
  }
  for (const dir of dirs) {
    await mkdir(Path.join(currPath, dir));
  }
};

const formatEntry = (file, dir = root) => {
  return {
    basename: Path.basename(file),
    path: Path.normalize(file),
    fullPath: Path.join(dir, file)
  };
};

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const waitForEnd = stream => new Promise(resolve => stream.on('end', resolve));

beforeEach(async () => {
  testCount++;
  currPath = Path.join(root, testCount.toString());
  await pRimraf(currPath);
  await mkdir(currPath);
});
afterEach(async () => {
  await pRimraf(currPath);
});

beforeAll(async () => {
  await pRimraf(root);
  await mkdir(root);
});
afterAll(async () => {
  await pRimraf(root);
});

describe('basic', () => {
  it('reads directory', async () => {
    const files = ['a.txt', 'b.txt', 'c.txt'];
    await touch(files);
    const res = await read();
    expect(res).toHaveLength(files.length);
    res.forEach((entry, index) => {
      expect(entry).toMatchObject(formatEntry(files[index], currPath));
    });
  });
});

describe('symlinks', () => {
  // not using arrow function, because this.skip
  beforeAll(function () {
    // GitHub Actions / default Windows installation disable symlink support unless admin
    // eslint-disable-next-line no-invalid-this
    if (isWindows) this.skip();
  });

  it('handles symlinks', async () => {
    const newPath = Path.join(currPath, 'test-symlinked.js');
    await symlink(Path.join(__dirname, 'readdirp.test.js'), newPath);
    const res = await read();
    const first = res[0];
    expect(first).toMatchObject(formatEntry('test-symlinked.js', currPath));
    const contents = await readFile(first.fullPath);
    expect(contents).toMatch(/handles symlinks/); // name of this test
  });

  it('handles symlinked directories', async () => {
    const originalPath = Path.join(__dirname, 'examples');
    const originalFiles = await readdir(originalPath);
    const newPath = Path.join(currPath, 'examples');
    await symlink(originalPath, newPath);
    const res = await read();
    const symlinkedFiles = res.map(entry => entry.basename);
    expect(symlinkedFiles).toEqual(originalFiles);
  });

  it('should use lstat instead of stat', async () => {
    const files = ['a.txt', 'b.txt', 'c.txt'];
    const symlinkName = 'test-symlinked.js';
    const newPath = Path.join(currPath, symlinkName);
    await symlink(Path.join(__dirname, 'readdirp.test.js'), newPath);
    await touch(files);
    const expect1 = [...files, symlinkName];
    const res = await read({ lstat: true, alwaysStat: true });
    expect(res).toHaveLength(expect1.length);
    res.forEach((entry, index) => {
      expect(entry).toMatchObject(formatEntry(expect1[index], currPath, false));
      expect(entry).toHaveProperty('stats');
      if (entry.basename === symlinkName) {
        expect(entry.stats.isSymbolicLink()).toBe(true);
      }
    });
  });

  it('detect circular symlink', async () => {
    const dirs = ['a', 'a/b'];
    await touch([], dirs);
    const targetPath = Path.join(currPath, 'a');
    const newPath = Path.join(currPath, 'a/b/c');
    await symlink(targetPath, newPath, 'dir');

    let isWarningCalled = false;
    const stream = readdirp(currPath, { type: 'directories' })
      // eslint-disable-next-line no-empty-function
      .on('data', () => {})
      .on('warn', (warning) => {
        expect(warning).toBeInstanceOf(Error);
        expect(warning.code).toBe('READDIRP_RECURSIVE_ERROR');
        isWarningCalled = true;
      });
    await Promise.race([
      waitForEnd(stream),
      delay(2000)
    ]);
    expect(isWarningCalled).toBe(true);
  });
});

describe('type', () => {
  const files = ['a.txt', 'b.txt', 'c.txt'];
  const dirs = ['d', 'e', 'f', 'g'];

  it('files', async () => {
    await touch(files, dirs);
    const res = await read({ type: 'files' });
    expect(res).toHaveLength(files.length);
    res.forEach((entry, index) => {
      expect(entry).toMatchObject(formatEntry(files[index], currPath));
    });
  });

  it('directories', async () => {
    await touch(files, dirs);
    const res = await read({ type: 'directories' });
    expect(res).toHaveLength(dirs.length);
    res.forEach((entry, index) => {
      expect(entry).toMatchObject(formatEntry(dirs[index], currPath));
    });
  });

  it('all', async () => {
    await touch(files, dirs);
    const res = await read({ type: 'all' });
    const all = files.concat(dirs);
    expect(res).toHaveLength(all.length);
    res.forEach((entry, index) => {
      expect(entry).toMatchObject(formatEntry(all[index], currPath));
    });
  });

  it('invalid', async () => {
    try {
      await read({ type: 'bogus' });
    } catch (error) {
      expect(error.message).toMatch(/Invalid type/);
    }
  });
});

describe('depth', () => {
  const depth0 = ['a.js', 'b.js', 'c.js'];
  const subdirs = ['subdir', 'deep'];
  const depth1 = ['subdir/d.js', 'deep/e.js'];
  const deepSubdirs = ['subdir/s1', 'subdir/s2', 'deep/d1', 'deep/d2'];
  const depth2 = ['subdir/s1/f.js', 'deep/d1/h.js'];

  beforeEach(async () => {
    await touch(depth0, subdirs);
    await touch(depth1, deepSubdirs);
    await touch(depth2);
  });

  it('0', async () => {
    const res = await read({ depth: 0 });
    expect(res).toHaveLength(depth0.length);
    res.forEach((entry, index) => {
      expect(entry).toMatchObject(formatEntry(depth0[index], currPath));
    });
  });

  it('1', async () => {
    const res = await read({ depth: 1 });
    const expect1 = [...depth0, ...depth1];
    expect(res).toHaveLength(expect1.length);
    res
      .sort((a, b) => (a.basename > b.basename ? 1 : -1))
      .forEach((entry, index) => {
        expect(entry).toMatchObject(formatEntry(expect1[index], currPath));
      });
  });

  it('2', async () => {
    const res = await read({ depth: 2 });
    const expect1 = [...depth0, ...depth1, ...depth2];
    expect(res).toHaveLength(expect1.length);
    res
      .sort((a, b) => (a.basename > b.basename ? 1 : -1))
      .forEach((entry, index) => {
        expect(entry).toMatchObject(formatEntry(expect1[index], currPath));
      });
  });

  it('default', async () => {
    const res = await read();
    const expect1 = [...depth0, ...depth1, ...depth2];
    expect(res).toHaveLength(expect1.length);
    res
      .sort((a, b) => (a.basename > b.basename ? 1 : -1))
      .forEach((entry, index) => {
        expect(entry).toMatchObject(formatEntry(expect1[index], currPath));
      });
  });
});

describe('filtering', () => {
  beforeEach(async () => {
    await touch(['a.js', 'b.txt', 'c.js', 'd.js', 'e.rb']);
  });

  it('glob', async () => {
    const expect1 = ['a.js', 'c.js', 'd.js'];
    const res = await read({ fileFilter: '*.js' });
    expect(res).toHaveLength(expect1.length);
    res.forEach((entry, index) => {
      expect(entry).toMatchObject(formatEntry(expect1[index], currPath));
    });

    const res2 = await read({ fileFilter: ['*.js'] });
    expect(res2).toHaveLength(expect1.length);
    res2.forEach((entry, index) => {
      expect(entry).toMatchObject(formatEntry(expect1[index], currPath));
    });

    const expect2 = ['b.txt'];
    const res3 = await read({ fileFilter: ['*.txt'] });
    expect(res3).toHaveLength(expect2.length);
    res3.forEach((entry, index) => {
      expect(entry).toMatchObject(formatEntry(expect2[index], currPath));
    });
  });

  it('leading and trailing spaces', async () => {
    const expect1 = ['a.js', 'c.js', 'd.js', 'e.rb'];
    const res = await read({ fileFilter: [' *.js', '*.rb '] });
    expect(res).toHaveLength(expect1.length);
    res.forEach((entry, index) => {
      expect(entry).toMatchObject(formatEntry(expect1[index], currPath));
    });
  });

  it('multiple glob', async () => {
    const expect1 = ['a.js', 'b.txt', 'c.js', 'd.js'];
    const res = await read({ fileFilter: ['*.js', '*.txt'] });
    expect(res).toHaveLength(expect1.length);
    res.forEach((entry, index) => {
      expect(entry).toMatchObject(formatEntry(expect1[index], currPath));
    });
  });

  it('negated glob', async () => {
    const expect1 = ['a.js', 'b.txt', 'c.js', 'e.rb'];
    const res = await read({ fileFilter: ['!d.js'] });
    expect(res).toHaveLength(expect1.length);
    res.forEach((entry, index) => {
      expect(entry).toMatchObject(formatEntry(expect1[index], currPath));
    });
  });

  it('glob & negated glob', async () => {
    const expect1 = ['a.js', 'c.js'];
    const res = await read({ fileFilter: ['*.js', '!d.js'] });
    expect(res).toHaveLength(expect1.length);
    res.forEach((entry, index) => {
      expect(entry).toMatchObject(formatEntry(expect1[index], currPath));
    });
  });

  it('two negated glob', async () => {
    const expect1 = ['b.txt'];
    const res = await read({ fileFilter: ['!*.js', '!*.rb'] });
    expect(res).toHaveLength(expect1.length);
    res.forEach((entry, index) => {
      expect(entry).toMatchObject(formatEntry(expect1[index], currPath));
    });
  });

  it('function', async () => {
    const expect1 = ['a.js', 'c.js', 'd.js'];
    const res = await read({ fileFilter: entry => Path.extname(entry.fullPath) === '.js' });
    expect(res).toHaveLength(expect1.length);
    res.forEach((entry, index) => {
      expect(entry).toMatchObject(formatEntry(expect1[index], currPath));
    });

    if (supportsDirent) {
      const expect2 = ['a.js', 'b.txt', 'c.js', 'd.js', 'e.rb'];
      const res2 = await read({ fileFilter: entry => entry.dirent.isFile() });
      expect(res2).toHaveLength(expect2.length);
      res2.forEach((entry, index) => {
        expect(entry).toMatchObject(formatEntry(expect2[index], currPath));
      });
    }
  });

  it('function with stats', async () => {
    const expect1 = ['a.js', 'c.js', 'd.js'];
    const res = await read({ alwaysStat: true, fileFilter: entry => Path.extname(entry.fullPath) === '.js' });
    expect(res).toHaveLength(expect1.length);
    res.forEach((entry, index) => {
      expect(entry).toMatchObject(formatEntry(expect1[index], currPath));
      expect(entry).toHaveProperty('stats');
    });

    const expect2 = ['a.js', 'b.txt', 'c.js', 'd.js', 'e.rb'];
    const res2 = await read({ alwaysStat: true, fileFilter: entry => entry.stats.size > 0 });
    expect(res2).toHaveLength(expect2.length);
    res2.forEach((entry, index) => {
      expect(entry).toMatchObject(formatEntry(expect2[index], currPath));
      expect(entry).toHaveProperty('stats');
    });
  });
});

describe('various', () => {
  it('emits readable stream', () => {
    const stream = readdirp(currPath);
    expect(stream).toBeInstanceOf(Readable);
    expect(stream).toBeInstanceOf(ReaddirpStream);
  });

  it('fails without root option passed', async () => {
    try {
      readdirp();
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
    }
  });

  it('disallows old API', () => {
    try {
      readdirp({ root: '.' });
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
    }
  });

  it('exposes promise API', async () => {
    const created = ['a.txt', 'c.txt'];
    await touch(created);
    const result = await readdirp(currPath);
    expect(result).toHaveLength(created.length);
    result.forEach((entry, index) => {
      expect(entry).toMatchObject(formatEntry(created[index], currPath));
    });
  });

  it('should emit warning for missing file', async () => {
    // readdirp() is initialized on some big root directory
    // readdirp() receives path a/b/c to its queue
    // readdirp is reading something else
    // a/b gets deleted, so stat()-ting a/b/c would now emit enoent
    // We should emit warnings for this case.
    // this.timeout(4000);
    fs.mkdirSync(Path.join(currPath, 'a'));
    fs.mkdirSync(Path.join(currPath, 'b'));
    fs.mkdirSync(Path.join(currPath, 'c'));
    let isWarningCalled = false;
    const stream = readdirp(currPath, { type: 'all', highWaterMark: 1 });
    stream
      .on('warn', (warning) => {
        expect(warning).toBeInstanceOf(Error);
        expect(warning.code).toBe('ENOENT');
        isWarningCalled = true;
      });
    await delay(1000);
    await pRimraf(Path.join(currPath, 'a'));
    stream.resume();
    await Promise.race([
      waitForEnd(stream),
      delay(2000)
    ]);
    expect(isWarningCalled).toBe(true);
  }, 4000);

  it('should emit warning for file with strict permission', async () => {
    // Windows doesn't throw permission error if you access permitted directory
    if (isWindows) {
      return;
    }
    const permitedDir = Path.join(currPath, 'permited');
    fs.mkdirSync(permitedDir, 0o0);
    let isWarningCalled = false;
    const stream = readdirp(currPath, { type: 'all' })
      // eslint-disable-next-line no-empty-function
      .on('data', () => {})
      .on('warn', (warning) => {
        expect(warning).toBeInstanceOf(Error);
        expect(warning.code).toBe('EACCES');
        isWarningCalled = true;
      });
    await Promise.race([
      waitForEnd(stream),
      delay(2000)
    ]);
    expect(isWarningCalled).toBe(true);
  });

  it('should throw error immediately for file with strict permission', async () => {
    if (isWindows) {
      return;
    }
    const permitedDir = Path.join(currPath, 'permited');
    fs.mkdirSync(permitedDir, 0o0);
    try {
      await readdirp(currPath, { type: 'all', suppressNormalFlowError: false });
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect(e.code).toBe('EACCES');
    }
  });

  it('should not emit warning after "end" event', async () => {
    // Windows doesn't throw permission error if you access permitted directory
    if (isWindows) {
      return;
    }
    const subdir = Path.join(currPath, 'subdir');
    const permitedDir = Path.join(subdir, 'permited');
    fs.mkdirSync(subdir);
    fs.mkdirSync(permitedDir, 0o0);
    let isWarningCalled = false;
    let isEnded = false;
    const stream = readdirp(currPath, { type: 'all' })
      // eslint-disable-next-line no-empty-function
      .on('data', () => {})
      .on('warn', (warning) => {
        expect(warning).toBeInstanceOf(Error);
        expect(warning.code).toBe('EACCES');
        expect(isEnded).toBe(false);
        isWarningCalled = true;
      })
      .on('end', () => {
        expect(isWarningCalled).toBe(true);
        isEnded = true;
      });
    await Promise.race([
      waitForEnd(stream),
      delay(2000)
    ]);
    expect(isWarningCalled).toBe(true);
    expect(isEnded).toBe(true);
  });
});
