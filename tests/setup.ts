type StorageLike = Storage;

function createStorage(): StorageLike {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(String(key)) ?? null,
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    removeItem: (key: string) => { data.delete(String(key)); },
    setItem: (key: string, value: string) => { data.set(String(key), String(value)); },
  } as StorageLike;
}

Object.defineProperty(globalThis, 'sessionStorage', {
  configurable: true,
  value: createStorage(),
});

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: createStorage(),
});
