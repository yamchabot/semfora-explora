import '@testing-library/jest-dom';

// jsdom doesn't implement ResizeObserver — provide a no-op stub
global.ResizeObserver = class ResizeObserver {
  constructor(cb) { this._cb = cb; }
  observe()    {}
  unobserve()  {}
  disconnect() {}
};
