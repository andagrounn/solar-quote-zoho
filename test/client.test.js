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
