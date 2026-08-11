// Vitest setup: register jest-dom matchers and give every test a clean
// localStorage so module-level singletons never leak state between files.
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach } from 'vitest';
import { cleanup } from '@testing-library/react';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});
