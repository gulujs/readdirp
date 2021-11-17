import * as fs from 'fs';
import {
  readdir,
  stat,
  lstat,
  realpath
} from 'fs/promises';
import { Readable } from 'stream';
import * as Path from 'path';
import picomatch from 'picomatch';

/**
 * @typedef {Object} EntryInfo
 * @property {String} path
 * @property {String} fullPath
 * @property {fs.Stats=} stats
 * @property {fs.Dirent=} dirent
 * @property {String} basename
 */

const BANG = '!';
const RECURSIVE_ERROR_CODE = 'READDIRP_RECURSIVE_ERROR';
const NORMAL_FLOW_ERRORS = ['ENOENT', 'EPERM', 'EACCES', 'ELOOP', RECURSIVE_ERROR_CODE];
const FILE_TYPE = 'files';
const DIR_TYPE = 'directories';
const FILE_DIR_TYPE = 'files_directories';
const EVERYTHING_TYPE = 'all';
const ALL_TYPES = [FILE_TYPE, DIR_TYPE, FILE_DIR_TYPE, EVERYTHING_TYPE];

const isNormalFlowError = error => NORMAL_FLOW_ERRORS.includes(error.code);
const [maj, min] = process.versions.node.split('.').slice(0, 2).map(n => Number.parseInt(n));
const wantBigintFsStats = process.platform === 'win32' && (maj > 10 || (maj === 10 && min >= 5));

const normalizeFilter = (filter, filterEntryKey) => {
  if (typeof filter === 'function') {
    return filter;
  }

  if (typeof filter === 'string') {
    const glob = picomatch(filter.trim());
    return entry => glob(entry[filterEntryKey]);
  }

  if (!Array.isArray(filter)) {
    throw new Error('Filter only support `Function`, `Glob string` and `Array of glob strings`');
  }

  const positive = [];
  const negative = [];
  for (const item of filter) {
    const trimmed = item.trim();
    if (trimmed.charAt(0) === BANG) {
      negative.push(picomatch(trimmed.substring(1)));
    } else {
      positive.push(picomatch(trimmed));
    }
  }

  if (negative.length > 0) {
    if (positive.length > 0) {
      return entry => positive.some(f => f(entry[filterEntryKey])) && !negative.some(f => f(entry[filterEntryKey]));
    }
    return entry => !negative.some(f => f(entry[filterEntryKey]));
  }
  return entry => positive.some(f => f(entry[filterEntryKey]));
};

export class ReaddirpStream extends Readable {
  static get defaultOptions() {
    return {
      root: '.',
      fileFilter: () => true,
      directoryFilter: () => true,
      filterEntryKey: 'basename',
      type: FILE_TYPE,
      lstat: false,
      depth: 0x80000000,
      alwaysStat: false,
      suppressNormalFlowError: true
    };
  }

  /**
   * @param {ReaddirpArguments} options
   */
  constructor(options = {}) {
    super({
      objectMode: true,
      autoDestroy: true,
      highWaterMark: options.highWaterMark || 4096
    });
    options = { ...ReaddirpStream.defaultOptions, ...options };

    this._fileFilter = normalizeFilter(options.fileFilter, options.filterEntryKey);
    this._directoryFilter = normalizeFilter(options.directoryFilter, options.filterEntryKey);

    const statMethod = options.lstat ? lstat : stat;
    // Use bigint stats if it's windows and stat() supports options (node 10+).
    if (wantBigintFsStats) {
      this._stat = path => statMethod(path, { bigint: true });
    } else {
      this._stat = statMethod;
    }

    this._maxDepth = options.depth;
    this._wantsDir = [DIR_TYPE, FILE_DIR_TYPE, EVERYTHING_TYPE].includes(options.type);
    this._wantsFile = [FILE_TYPE, FILE_DIR_TYPE, EVERYTHING_TYPE].includes(options.type);
    this._wantsEverything = options.type === EVERYTHING_TYPE;
    this._root = Path.resolve(options.root);
    this._isDirent = ('Dirent' in fs) && !options.alwaysStat;
    this._statsProp = this._isDirent ? 'dirent' : 'stats';
    this._rdOptions = { encoding: 'utf8', withFileTypes: this._isDirent };
    this._suppressNormalFlowError = options.suppressNormalFlowError !== false;

    // Launch stream with one parent, the root dir.
    this.parents = [this._exploreDir(this._root, '', 1)];
    this.reading = false;
    this.parent = null;
  }

  then(onfulfilled, onrejected) {
    return new Promise((resolve, reject) => {
      const files = [];
      this.on('data', entry => files.push(entry))
        .on('end', () => resolve(files))
        .on('error', error => reject(error));
    }).then(onfulfilled, onrejected);
  }

  async _read(batch) {
    if (this.reading) {
      return;
    }
    this.reading = true;

    try {
      while (!this.destroyed && batch > 0) {
        const {
          fullPath,
          path,
          depth,
          files = []
        } = this.parent || {};

        if (files.length === 0) {
          const parent = this.parents.pop();
          if (!parent) {
            this.push(null);
            return;
          }

          this.parent = await parent;

          if (this.destroyed) {
            return;
          }

          continue;
        }

        const slice = files.splice(0, batch).map(dirent => this._formatEntry(dirent, fullPath, path));
        for (const entry of await Promise.all(slice)) {
          if (this.destroyed) {
            return;
          }

          const entryType = await this._getEntryType(entry);
          if (entryType === 'directory' && this._directoryFilter(entry)) {
            if (depth <= this._maxDepth) {
              this.parents.push(this._exploreDir(entry.fullPath, entry.path, depth + 1));
            }

            if (this._wantsDir) {
              this.push(entry);
              batch--;
            }
            continue;
          }

          if ((entryType === 'file' || this._includeAsFile(entry)) && this._fileFilter(entry)) {
            if (this._wantsFile) {
              this.push(entry);
              batch--;
            }
          }
        }
      }
    } catch (error) {
      this.destroy(error);
    } finally {
      this.reading = false;
    }
  }

  async _exploreDir(fullPath, path, depth) {
    let files;
    try {
      files = await readdir(fullPath, this._rdOptions);
    } catch (err) {
      this._onError(err);
    }
    return {
      files,
      depth,
      fullPath,
      path
    };
  }

  async _formatEntry(dirent, absolutePath, relativePath) {
    let entry;
    try {
      const basename = this._isDirent ? dirent.name : dirent;
      const fullPath = Path.join(absolutePath, basename);
      entry = {
        path: Path.join(relativePath, basename),
        fullPath,
        basename
      };
      entry[this._statsProp] = this._isDirent ? dirent : await this._stat(fullPath);
    } catch (err) {
      this._onError(err);
    }
    return entry;
  }

  _onError(err) {
    if (this._suppressNormalFlowError && isNormalFlowError(err) && !this.destroyed) {
      this.emit('warn', err);
    } else {
      this.destroy(err);
    }
  }

  async _getEntryType(entry) {
    // entry may be undefined, because a warning or an error were emitted
    // and the statsProp is undefined
    const stats = entry && entry[this._statsProp];
    if (!stats) {
      return null;
    }

    if (stats.isFile()) {
      return 'file';
    }
    if (stats.isDirectory()) {
      return 'directory';
    }

    if (stats.isSymbolicLink()) {
      const { fullPath } = entry;
      try {
        const entryRealPath = await realpath(fullPath);
        const entryRealPathStats = await lstat(entryRealPath);
        if (entryRealPathStats.isFile()) {
          return 'file';
        }
        if (entryRealPathStats.isDirectory()) {
          if (!fullPath.startsWith(entryRealPath) || fullPath.substr(entryRealPath.length, 1) !== Path.sep) {
            return 'directory';
          }

          const recursiveError = new Error(`Circular symlink detected: "${fullPath}" points to "${entryRealPath}"`);
          recursiveError.code = RECURSIVE_ERROR_CODE;
          this._onError(recursiveError);
        }
      } catch (err) {
        this._onError(err);
      }
    }

    return null;
  }

  _includeAsFile(entry) {
    const stats = entry && entry[this._statsProp];

    return stats && this._wantsEverything && !stats.isDirectory();
  }
}

/**
 * @typedef {Object} ReaddirpArguments
 * @property {Function=} fileFilter
 * @property {Function=} directoryFilter
 * @property {String=} filterEntryKey
 * @property {String=} type
 * @property {Number=} depth
 * @property {String=} root
 * @property {Boolean=} lstat
 * @property {Boolean=} bigint
 * @property {Boolean=} suppressNormalFlowError
 */

/**
 * Main function which ends up calling readdirRec and reads all files and directories in given root recursively.
 * @param {String} root Root directory
 * @param {ReaddirpArguments=} options Options to specify root (start directory), filters and recursion depth
 */
export function readdirp(root, options = {}) {
  if (!root) {
    throw new Error('readdirp: root argument is required. Usage: readdirp(root, options)');
  } else if (typeof root !== 'string') {
    throw new TypeError('readdirp: root argument must be a string. Usage: readdirp(root, options)');
  } else if (options.type && !ALL_TYPES.includes(options.type)) {
    throw new Error(`readdirp: Invalid type passed. Use one of ${ALL_TYPES.join(', ')}`);
  }

  options.root = root;
  return new ReaddirpStream(options);
}
