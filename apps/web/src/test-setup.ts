import "fake-indexeddb/auto";

// Node ≥25 exposes a stub `localStorage` global (undefined unless
// --localstorage-file is passed) that shadows jsdom's storage in the
// test environment. Install a spec-local in-memory Storage so modules
// that persist UI preferences (tfm-locale, tfm-theme-mode) work.
if (typeof window !== "undefined" && !window.localStorage) {
  const data = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => (data.has(key) ? data.get(key)! : null),
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => {
      data.delete(key);
    },
    setItem: (key, value) => {
      data.set(key, String(value));
    },
  };
  Object.defineProperty(window, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  });
}

// jsdom does not implement matchMedia; components using useMediaQuery
// (responsive layout, theme resolution) need a stub. Specs override
// window.matchMedia per test when they exercise a specific breakpoint.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = ((query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}
