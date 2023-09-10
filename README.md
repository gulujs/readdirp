# @gulujs/readdirp

Recursive version of [fs.readdir](https://nodejs.org/api/fs.html#fs_fs_readdir_path_options_callback). Exposes a **stream API** and a **promise API**.

## Installation

```sh
npm install @gulujs/readdirp
```

## Usage

```js
import { readdirp } from '@gulujs/readdirp';

// Use streams to achieve small RAM & CPU footprint.
// 1) Streams example with for-await.
for await (const entry of readdirp('.')) {
  const { path } = entry;
  console.log(`${JSON.stringify({ path })}`);
}

// 2) Streams example, non for-await.
// Print out all JS files along with their size within the current folder & subfolders.
readdirp('.', { fileFilter: '*.js', alwaysStat: true })
  .on('data', (entry) => {
    const { path, stats: { size } } = entry;
    console.log(`${JSON.stringify({ path, size })}`);
  })
  // Optionally call stream.destroy() in `warn()` in order to abort and cause 'close' to be emitted
  .on('warn', error => console.error('non-fatal error', error))
  .on('error', error => console.error('fatal error', error))
  .on('end', () => console.log('done'));

// 3) Promise example. More RAM and CPU than streams / for-await.
const files = await readdirp('.');
console.log(files.map(file => file.path));
```

For more examples, check out `examples` directory.

## Options

### Default Options

```js
{
  root: '.',
  fileFilter: () => true,
  directoryFilter: () => true,
  filterEntryKey: 'basename',
  type: FILE_TYPE,
  lstat: false,
  depth: 0x80000000,
  alwaysStat: false,
  suppressNormalFlowError: true
}
```

### `root`

Path in which to start reading and recursing into subdirectories.

### `fileFilter`

Filter to include or exclude files. A `Function`, Glob string or Array of glob strings.

- **Function**: a function that takes an entry info as a parameter and returns true to include or false to exclude the entry
- **Glob string**: a string (e.g., `*.js`) which is matched using [picomatch](https://github.com/micromatch/picomatch),
    so go there for more information.
    Globstars (`**`) are not supported since specifying a recursive pattern for an already recursive function doesn't make sense.
    Negated globs (as explained in the minimatch documentation) are allowed, e.g., `!*.txt` matches everything but text files.
- **Array of glob strings**: either need to be all inclusive or all exclusive (negated) patterns otherwise an error is thrown.
    `['*.json', '*.js']` includes all JavaScript and Json files.
    `['!.git', '!node_modules']` includes all directories except the '.git' and 'node_modules'.
- Directories that do not pass a filter will not be recursed into.

### `directoryFilter`

Filter to include/exclude directories found and to recurse into.
Directories that do not pass a filter will not be recursed into.

### `filterEntryKey`

When `fileFilter` and `directoryFilter` is glob string,
use which entry value (`'basename'` or `'path'`) to test.
Default is `'basename'`.
- `'basename'` is the last portion of a `'path'`.
- `'path'` is a relative path based on `root`.

### `type`

Determines if data events on the stream should be emitted for `'files'` (default), `'directories'`, `'files_directories'`, or `'all'`.
Setting to `'all'` will also include entries for other types of file descriptors like character devices, unix sockets and named pipes.

### `lstat`

Include symlink entries in the stream along with files. When `true`, `fs.lstat` would be used instead of `fs.stat`

### `depth`

Depth at which to stop recursing even if more subdirectories are found

### `alwaysStat`

Always return `stats` property for every file.
Default is `false`, readdirp will return `Dirent` entries.
Setting it to `true` can double readdir execution time - use it only when you need file `size`, `mtime` etc.

### `suppressNormalFlowError`

Normal flow error includes 'ENOENT', 'EPERM', 'EACCES', 'ELOOP', 'READDIRP_RECURSIVE_ERROR', will emit as 'warn' event.
Default is `true`
Setting it to `false` will emit these error as 'error' event

## Acknowledgements

Forked from [paulmillr/readdirp](https://github.com/paulmillr/readdirp/tree/e28f928e21176da2c3295d5f68f2465aa08e012b).

## License

[MIT](LICENSE)
