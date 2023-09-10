// TypeScript Version: 3.2

/// <reference types="node" lib="esnext" />

import * as fs from 'fs';
import { Readable } from 'stream';

export interface EntryInfo {
  /**
   * path to the file/directory (relative to given root)
   */
  path: string;
  /**
   * full path to the file/directory found
   */
  fullPath: string;
  /**
   * name of the file/directory
   */
  basename: string;
  /**
   * built in [stat object](https://nodejs.org/api/fs.html#fs_class_fs_stats) - only with `alwaysStat: true`
   */
  stats?: fs.Stats;
  /**
   * built-in [dir entry object](https://nodejs.org/api/fs.html#fs_class_fs_dirent) - only with `alwaysStat: false`
   */
  dirent?: fs.Dirent;
}

export interface ReaddirpOptions {
  /**
   * Path in which to start reading and recursing into subdirectories.
   */
  root?: string;
  /**
   * Filter to include or exclude files. A `Function`, Glob string or Array of glob strings.
   *
   * - **Function**: a function that takes an entry info as a parameter and returns true to include or false to exclude the entry
   * - **Glob string**: a string (e.g., `*.js`) which is matched using [picomatch](https://github.com/micromatch/picomatch),
   *     so go there for more information.
   *     Globstars (`**`) are not supported since specifying a recursive pattern for an already recursive function doesn't make sense.
   *     Negated globs (as explained in the minimatch documentation) are allowed, e.g., `!*.txt` matches everything but text files.
   * - **Array of glob strings**: either need to be all inclusive or all exclusive (negated) patterns otherwise an error is thrown.
   *     `['*.json', '*.js']` includes all JavaScript and Json files.
   *     `['!.git', '!node_modules']` includes all directories except the '.git' and 'node_modules'.
   * - Directories that do not pass a filter will not be recursed into.
   */
  fileFilter?: string | string[] | ((entry: EntryInfo) => boolean);
  /**
   * Filter to include/exclude directories found and to recurse into.
   * Directories that do not pass a filter will not be recursed into.
   */
  directoryFilter?: string | string[] | ((entry: EntryInfo) => boolean);
  /**
   * When `fileFilter` and `directoryFilter` is glob string,
   * use which entry value (`'basename'` or `'path'`) to test.
   * Default is `'basename'`.
   * - `'basename'` is the last portion of a `'path'`.
   * - `'path'` is a relative path based on `root`.
   */
  filterEntryKey?: 'basename' | 'path';
  /**
   * Determines if data events on the stream should be emitted for `'files'` (default), `'directories'`, `'files_directories'`, or `'all'`.
   * Setting to `'all'` will also include entries for other types of file descriptors like character devices, unix sockets and named pipes.
   */
  type?: 'files' | 'directories' | 'files_directories' | 'all';
  /**
   * Include symlink entries in the stream along with files. When `true`, `fs.lstat` would be used instead of `fs.stat`
   */
  lstat?: boolean;
  /**
   * Depth at which to stop recursing even if more subdirectories are found
   */
  depth?: number;
  /**
   * Always return `stats` property for every file.
   * Default is `false`, readdirp will return `Dirent` entries.
   * Setting it to `true` can double readdir execution time - use it only when you need file `size`, `mtime` etc.
   */
  alwaysStat?: boolean;
  /**
   * Normal flow error includes 'ENOENT', 'EPERM', 'EACCES', 'ELOOP', 'READDIRP_RECURSIVE_ERROR', will emit as 'warn' event.
   * Default is `true`
   * Setting it to `false` will emit these error as 'error' event
   */
  suppressNormalFlowError?: boolean;
}

export class ReaddirpStream extends Readable implements AsyncIterable<EntryInfo>, PromiseLike<EntryInfo[]> {
  read(): EntryInfo;
  [Symbol.asyncIterator](): AsyncIterableIterator<EntryInfo>;
  then<T = EntryInfo[], U = never>(onfulfilled?: ((value: EntryInfo[]) => T | PromiseLike<T>) | null, onrejected?: ((reason: any) => U | PromiseLike<U>) | null): PromiseLike<T | U>;
}

/**
 *
 * @param root path in which to start reading and recursing into subdirectories.
 * @param options
 */
export function readdirp(root: string, options?: ReaddirpOptions): ReaddirpStream;
