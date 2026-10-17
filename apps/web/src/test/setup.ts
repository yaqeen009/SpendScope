import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// React Testing Library unmounts trees after each test when globals are enabled;
// this keeps the DOM clean even if a test opts out of the automatic hook.
afterEach(() => {
  cleanup();
});

// jsdom does not implement matchMedia, which the theme provider and several
// components consult. Provide a minimal, controllable stub.
// The guard keeps this file safe for the Node-environment tests (`server.test.mjs`),
// where `window` does not exist at all.
if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(() => false),
      }) as unknown as MediaQueryList,
  });
}

// Recharts measures its container; jsdom reports zero size. A ResizeObserver
// stub lets the charts mount without throwing.
if (!('ResizeObserver' in globalThis)) {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
}

// Radix and the charts read these on mount.
if (typeof window !== 'undefined' && !window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
}
