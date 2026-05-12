import { BehaviorSubject } from 'rxjs';
import { signal, WritableSignal } from '@angular/core';
import { StorageService } from './storage.service';

// Storage key convention:
//   "<feature>.<setting>:<restaurantId>" for per-restaurant scoping (operator portal)
//   "<feature>.<setting>"                for global / unscoped state
// Keys are passed through StorageService, which adds the "[dinify]" prefix and
// wraps values as { value: T } in JSON. Callers see the raw T.

interface PersistedStateOptions<T> {
  storage: StorageService;
  getKey: () => string;
  validate?: (value: unknown) => value is T;
}

function readSeed<T>(defaultValue: T, options: PersistedStateOptions<T>): T {
  const key = options.getKey();
  let stored: T | null = null;
  try {
    stored = options.storage.getItem<T>(key);
  } catch (e) {
    console.warn('[persisted-state] failed to read', key, e);
    return defaultValue;
  }
  if (stored === null) return defaultValue;
  if (options.validate && !options.validate(stored)) return defaultValue;
  return stored;
}

/**
 * A BehaviorSubject that transparently persists its current value through a
 * StorageService. The seed is read from storage on construction (falling back
 * to defaultValue if absent, unreadable, or rejected by the optional
 * validator). Every call to next() writes the new value back to storage.
 *
 * getKey is evaluated lazily on every read and write so consumers can scope
 * the persisted entry to runtime context (e.g. the current restaurant id),
 * not just the value known at construction time.
 *
 * Write failures are caught and logged via console.warn — persistence is
 * best-effort and must never break the UI.
 *
 * @example
 *   private readonly _sortMode$ = new PersistedBehaviorSubject<SortMode>(
 *     'manual',
 *     {
 *       storage: this.storage,
 *       getKey: () => `menu.sortMode:${this.auth.currentRestaurantRole?.restaurant_id ?? 'global'}`,
 *       validate: (v): v is SortMode =>
 *         typeof v === 'string' && ['manual', 'a-z'].includes(v),
 *     },
 *   );
 */
export class PersistedBehaviorSubject<T> extends BehaviorSubject<T> {
  private readonly options: PersistedStateOptions<T>;

  constructor(defaultValue: T, options: PersistedStateOptions<T>) {
    super(readSeed(defaultValue, options));
    this.options = options;
  }

  override next(value: T): void {
    super.next(value);
    const key = this.options.getKey();
    try {
      this.options.storage.setItem(key, value);
    } catch (e) {
      console.warn('[PersistedBehaviorSubject] failed to persist', key, e);
    }
  }
}

/**
 * A plain wrapper around a single value that transparently persists writes
 * through a StorageService. Sibling primitive to PersistedBehaviorSubject
 * and persistedSignal — use this when the consumer is a component-level
 * plain property rather than a reactive subject or signal.
 *
 * Read the current value via .value. Writes via the .value setter persist
 * synchronously. Seed and write failure handling mirror the other two
 * primitives in this file (see readSeed; setItem wrapped in try/catch with
 * console.warn on failure).
 *
 * Typical consumer pattern: pair with a getter/setter on the component
 * class so template bindings using direct assignment (e.g.
 * (click)="activeTab = 'waitlist'") keep working unchanged.
 */
export class PersistedValue<T> {
  private _value: T;
  private readonly options: PersistedStateOptions<T>;

  constructor(defaultValue: T, options: PersistedStateOptions<T>) {
    this._value = readSeed(defaultValue, options);
    this.options = options;
  }

  get value(): T {
    return this._value;
  }

  set value(newValue: T) {
    this._value = newValue;
    const key = this.options.getKey();
    try {
      this.options.storage.setItem(key, newValue);
    } catch (e) {
      console.warn('[PersistedValue] failed to persist', key, e);
    }
  }
}

/**
 * A WritableSignal whose .set() and .update() writes are transparently
 * persisted through a StorageService. The seed is read from storage on
 * creation (falling back to defaultValue if absent, unreadable, or rejected
 * by the optional validator).
 *
 * Implemented by monkey-patching .set and .update on the returned signal
 * rather than via effect(), so writes happen synchronously, no spurious
 * initial write fires, and the call site doesn't need an Angular injection
 * context.
 *
 * Write failures are caught and logged via console.warn — persistence is
 * best-effort and must never break the UI.
 *
 * @example
 *   const sortMode = persistedSignal<SortMode>('manual', {
 *     storage,
 *     getKey: () => `menu.sortMode:${restaurantId}`,
 *     validate: (v): v is SortMode =>
 *       typeof v === 'string' && ['manual', 'a-z'].includes(v),
 *   });
 *   sortMode.set('a-z'); // updates value and writes through to storage
 */
export function persistedSignal<T>(
  defaultValue: T,
  options: PersistedStateOptions<T>
): WritableSignal<T> {
  const s = signal<T>(readSeed(defaultValue, options));
  const origSet = s.set.bind(s);
  const origUpdate = s.update.bind(s);

  s.set = (value: T): void => {
    origSet(value);
    const key = options.getKey();
    try {
      options.storage.setItem(key, value);
    } catch (e) {
      console.warn('[persistedSignal] failed to persist', key, e);
    }
  };

  s.update = (updater: (value: T) => T): void => {
    origUpdate(updater);
    const key = options.getKey();
    try {
      options.storage.setItem(key, s());
    } catch (e) {
      console.warn('[persistedSignal] failed to persist', key, e);
    }
  };

  return s;
}
