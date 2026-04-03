import { afterEach, vi } from "vitest";

const memory = new Map<string, string>();

const localStorageStub: Storage = {
  get length() {
    return memory.size;
  },
  clear() {
    memory.clear();
  },
  getItem(key: string) {
    return memory.has(key) ? memory.get(key)! : null;
  },
  key(index: number) {
    return Array.from(memory.keys())[index] ?? null;
  },
  removeItem(key: string) {
    memory.delete(key);
  },
  setItem(key: string, value: string) {
    memory.set(key, value);
  },
};

if (typeof globalThis.localStorage === "undefined") {
  vi.stubGlobal("localStorage", localStorageStub);
}

afterEach(() => {
  memory.clear();
});
