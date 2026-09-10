// server/zoho/client.js
function createZohoClient(config) {
  const fetchImpl = config.fetchImpl || fetch;
  const accountsBase = `https://accounts.zoho.${config.region}`;
  const apiBase = `https://www.zohoapis.${config.region}/books/v3`;

  let cachedToken = null;
  let tokenExpiresAt = 0;

  async function getAccessToken() {
    const now = Date.now();
    if (cachedToken && now < tokenExpiresAt) return cachedToken;

    const params = new URLSearchParams({
      refresh_token: config.refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'refresh_token',
    });
    const res = await fetchImpl(`${accountsBase}/oauth/v2/token?${params}`, {
      method: 'POST',
    });
    const body = await res.json();
    if (!res.ok || !body.access_token) {
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
    const body = await res.json();
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
