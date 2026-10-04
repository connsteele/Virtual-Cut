import { expect as playwrightExpect } from 'playwright/test';

// Playwright's expect, except that expect.poll retries every 100 ms. Its default backs off
// to one retry per second, so a condition that turns true at 1.05 s is only seen at 1.85 s.
// Assertions and timeouts are unchanged, and a call that passes its own intervals keeps them.
const intervals = [50, 100];
export const expect = new Proxy(playwrightExpect, {
  get(target, property, receiver) {
    if (property !== 'poll') return Reflect.get(target, property, receiver);
    return (actual, options) =>
      target.poll(
        actual,
        typeof options === 'string' ? { message: options, intervals } : { intervals, ...options },
      );
  },
});
