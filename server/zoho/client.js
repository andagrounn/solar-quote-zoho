// server/zoho/client.js
const VALID_REGIONS = ['com', 'eu', 'in', 'com.au'];

async function parseBody(res) {
  // 2xx callers rely on parsed JSON; error path must not throw on non-JSON bodies.
  try {
    return await res.json();
  } catch (_) {
    try {
      return await res.text();
    } catch (_) {
      return null;
    }
  }
}

function createZohoClient(config) {
  if (!VALID_REGIONS.includes(config.region)) {
    throw new Error(`Invalid ZOHO_REGION: ${config.region}`);
  }

  const fetchImpl = config.fetchImpl || fetch;
  const accountsBase = `https://accounts.zoho.${config.region}`;
  const apiBase = `https://www.zohoapis.${config.region}/books/v3`;

  let cachedToken = null;
  let tokenExpiresAt = 0;
  let inflightToken = null;

  async function fetchAccessToken() {
    const now = Date.now();
    const params = new URLSearchParams({
      refresh_token: config.refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'refresh_token',
    });
    // Secrets go in the form-encoded POST body, never the URL query string.
    const res = await fetchImpl(`${accountsBase}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const body = await parseBody(res);
    if (!res.ok || !body || !body.access_token) {
      const err = new Error('Zoho authentication failed');
      err.status = 502;
      err.details = body;
      throw err;
    }
    cachedToken = body.access_token;
    // refresh 5 minutes before expiry
    tokenExpiresAt = now + (body.expires_in - 300) * 1000;
    return cachedToken;
  }

  async function getAccessToken() {
    if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;
    // Concurrent callers before a token is cached share a single in-flight refresh.
    if (inflightToken) return inflightToken;
    inflightToken = fetchAccessToken().finally(() => {
      inflightToken = null;
    });
    return inflightToken;
  }

  async function request(method, path, jsonBody) {
    const token = await getAccessToken();
    const sep = path.includes('?') ? '&' : '?';
    const url = `${apiBase}${path}${sep}organization_id=${config.orgId}`;
    const opts = {
      method,
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
    };
    if (jsonBody !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(jsonBody);
    }
    const res = await fetchImpl(url, opts);
    const body = await parseBody(res);
    if (!res.ok) {
      const err = new Error('Zoho request failed');
      err.status = res.status;
      err.details = body;
      throw err;
    }
    return body;
  }

  return { request, getAccessToken };
}

module.exports = { createZohoClient };
