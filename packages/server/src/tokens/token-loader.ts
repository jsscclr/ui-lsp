import { readFile } from 'node:fs/promises';
import { watch, type FSWatcher } from 'node:fs';
import { TokenStore } from './token-store.js';

/**
 * Loads a DTCG tokens.json file into a TokenStore and optionally watches
 * for changes, reloading and calling `onReload` when the file is modified.
 */
export class TokenLoader {
  private _store = new TokenStore();
  private watcher: FSWatcher | null = null;
  private reloadDebounce: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private tokensPath: string,
    private onReload: () => void,
  ) {}

  async load(): Promise<void> {
    const content = await readFile(this.tokensPath, 'utf-8');
    this._store.load(content);
  }

  startWatching(): void {
    if (this.watcher) return;
    this.watcher = watch(this.tokensPath, () => {
      // Debounce rapid changes (editors sometimes write multiple events)
      if (this.reloadDebounce) clearTimeout(this.reloadDebounce);
      this.reloadDebounce = setTimeout(async () => {
        this.reloadDebounce = null;
        try {
          await this.load();
          this.onReload();
        } catch {
          // File may be mid-write; ignore and wait for next event
        }
      }, 200);
    });
  }

  stopWatching(): void {
    if (this.reloadDebounce) {
      clearTimeout(this.reloadDebounce);
      this.reloadDebounce = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  get store(): TokenStore {
    return this._store;
  }
}
