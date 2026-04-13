/**
 * Lightweight event callback system to replace jQuery's $.Callbacks().
 * Implements the same .add() / .remove() / .fire() interface.
 */
export class Callbacks {
  private list: Function[] = [];

  /** Register a callback function. */
  public add(fn: Function): this {
    if (typeof fn === 'function') {
      this.list.push(fn);
    }
    return this;
  }

  /** Remove a previously registered callback. */
  public remove(fn: Function): this {
    this.list = this.list.filter((entry) => entry !== fn);
    return this;
  }

  /** Invoke all registered callbacks with the given arguments. */
  public fire(...args: any[]): this {
    this.list.slice().forEach((fn) => fn(...args));
    return this;
  }

  /** Check if any callbacks are registered. */
  public has(fn: Function): boolean {
    return this.list.includes(fn);
  }

  /** Remove all callbacks. */
  public empty(): this {
    this.list = [];
    return this;
  }
}
