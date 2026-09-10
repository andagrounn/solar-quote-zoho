// test/auth.test.js
const { checkPasscode, requireSession } = require('../server/auth');

describe('checkPasscode', () => {
  test('true for exact match, false otherwise', () => {
    expect(checkPasscode('hunter2', 'hunter2')).toBe(true);
    expect(checkPasscode('wrong', 'hunter2')).toBe(false);
    expect(checkPasscode('', 'hunter2')).toBe(false);
  });
});

describe('requireSession', () => {
  function run(signedCookies) {
    const req = { signedCookies };
    let statusCode = 200;
    let jsonBody = null;
    const res = {
      status(c) { statusCode = c; return this; },
      json(b) { jsonBody = b; return this; },
    };
    let nextCalled = false;
    requireSession(req, res, () => { nextCalled = true; });
    return { statusCode, jsonBody, nextCalled };
  }

  test('calls next when session cookie is ok', () => {
    expect(run({ session: 'ok' }).nextCalled).toBe(true);
  });

  test('401 when session cookie missing', () => {
    const r = run({});
    expect(r.statusCode).toBe(401);
    expect(r.nextCalled).toBe(false);
  });
});
