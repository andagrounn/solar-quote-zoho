// test/client.test.js
const { createZohoClient } = require('../server/zoho/client');

function makeFetchMock(responses) {
  const calls = [];
  const impl = async (url, opts) => {
    calls.push({ url, opts });
    const next = responses.shift();
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: async () => next.body,
      text: async () => JSON.stringify(next.body),
    };
  };
  impl.calls = calls;
  return impl;
}

const config = {
  region: 'com', clientId: 'cid', clientSecret: 'secret',
  refreshToken: 'rtok', orgId: 'ORG1',
};

test('fetches an access token then performs an authorized request', async () => {
  const fetchMock = makeFetchMock([
    { status: 200, body: { access_token: 'AT123', expires_in: 3600 } },
    { status: 200, body: { estimate: { estimate_id: 'E1' } } },
  ]);
  const client = createZohoClient({ ...config, fetchImpl: fetchMock });
  const res = await client.request('POST', '/estimates', { subject: 'x' });

  expect(res.estimate.estimate_id).toBe('E1');
  // first call = token endpoint
  expect(fetchMock.calls[0].url).toContain('accounts.zoho.com/oauth/v2/token');
  // second call = API with org id + auth header
  expect(fetchMock.calls[1].url).toContain('zohoapis.com/books/v3/estimates');
  expect(fetchMock.calls[1].url).toContain('organization_id=ORG1');
  expect(fetchMock.calls[1].opts.headers.Authorization).toBe('Zoho-oauthtoken AT123');
});

test('reuses a cached token across requests', async () => {
  const fetchMock = makeFetchMock([
    { status: 200, body: { access_token: 'AT123', expires_in: 3600 } },
    { status: 200, body: { ok: true } },
    { status: 200, body: { ok: true } },
  ]);
  const client = createZohoClient({ ...config, fetchImpl: fetchMock });
  await client.request('GET', '/a');
  await client.request('GET', '/b');
  // only ONE token call
  const tokenCalls = fetchMock.calls.filter((c) => c.url.includes('/oauth/v2/token'));
  expect(tokenCalls).toHaveLength(1);
});

test('throws with status and details on API error', async () => {
  const fetchMock = makeFetchMock([
    { status: 200, body: { access_token: 'AT', expires_in: 3600 } },
    { status: 400, body: { code: 4, message: 'Invalid value' } },
  ]);
  const client = createZohoClient({ ...config, fetchImpl: fetchMock });
  await expect(client.request('POST', '/estimates', {})).rejects.toMatchObject({
    status: 400,
    details: { code: 4, message: 'Invalid value' },
  });
});

// C1: OAuth secrets must never appear in the URL; they go in the POST body.
test('sends OAuth secrets in the form body, never the URL', async () => {
  const fetchMock = makeFetchMock([
    { status: 200, body: { access_token: 'AT123', expires_in: 3600 } },
  ]);
  const client = createZohoClient({ ...config, fetchImpl: fetchMock });
  await client.getAccessToken();

  const tokenCall = fetchMock.calls[0];
  expect(tokenCall.url).toBe('https://accounts.zoho.com/oauth/v2/token');
  expect(tokenCall.url).not.toContain('client_secret');
  expect(tokenCall.url).not.toContain('refresh_token');
  expect(tokenCall.opts.method).toBe('POST');
  expect(tokenCall.opts.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
  expect(tokenCall.opts.body).toContain('client_secret=secret');
  expect(tokenCall.opts.body).toContain('refresh_token=rtok');
  expect(tokenCall.opts.body).toContain('grant_type=refresh_token');
});

// I1: concurrent refreshes must collapse into a single token fetch.
test('collapses concurrent token refreshes into one fetch', async () => {
  let resolveToken;
  const tokenGate = new Promise((resolve) => { resolveToken = resolve; });
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    await tokenGate; // hold the token response until both callers are waiting
    return {
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'AT123', expires_in: 3600 }),
      text: async () => '{"access_token":"AT123","expires_in":3600}',
    };
  };

  const client = createZohoClient({ ...config, fetchImpl });
  const p1 = client.getAccessToken();
  const p2 = client.getAccessToken();
  resolveToken();
  const [t1, t2] = await Promise.all([p1, p2]);

  expect(t1).toBe('AT123');
  expect(t2).toBe('AT123');
  const tokenCalls = calls.filter((c) => c.url.includes('/oauth/v2/token'));
  expect(tokenCalls).toHaveLength(1);
});

// M1: invalid region should fail fast at construction.
test('throws on an invalid region', () => {
  expect(() => createZohoClient({ ...config, region: 'org' }))
    .toThrow('Invalid ZOHO_REGION: org');
});

// M2: non-JSON error bodies (e.g. proxy HTML) must not crash parsing.
test('falls back to text for a non-JSON error body', async () => {
  const htmlBody = '<html><body>502 Bad Gateway</body></html>';
  const fetchImpl = async (url) => {
    const isToken = url.includes('/oauth/v2/token');
    return {
      ok: isToken,
      status: isToken ? 200 : 502,
      json: async () => {
        if (isToken) return { access_token: 'AT', expires_in: 3600 };
        throw new SyntaxError('Unexpected token < in JSON');
      },
      text: async () => (isToken ? '{}' : htmlBody),
    };
  };
  const client = createZohoClient({ ...config, fetchImpl });
  await expect(client.request('GET', '/estimates')).rejects.toMatchObject({
    status: 502,
    details: htmlBody,
  });
});
