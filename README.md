# @lunjs/readdirp

Recursive version of [fs.readdir](https://nodejs.org/api/fs.html#fs_fs_readdir_path_options_callback). Exposes a **stream API** and a **promise API**.

## Installation

```sh
npm install @lunjs/readdirp
```

## Usage

```javascript
const readdirp = require('readdirp');

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

## Acknowledgements

Forked from [paulmillr/readdirp](https://github.com/paulmillr/readdirp/tree/e28f928e21176da2c3295d5f68f2465aa08e012b).

## License

[MIT](LICENSE)
