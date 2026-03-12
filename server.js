/**
 * vFairs Dashboard Proxy Server
 * Credentials are read from environment variables — never hardcoded.
 */

const http  = require('http');
const https = require('https');

const APP_KEY    = process.env.VFAIRS_APP_KEY;
const APP_SECRET = process.env.VFAIRS_APP_SECRET;
const TOKEN_URL  = 'https://api.vfairs.com/rest/v5/oauth/token';
const BASE_URL   = 'https://api.vfairs.com/rest/v5/users/attendees?magic_login_link=1&payment_details=1&order_by_updated_record=1&is_active=ALL';
const PORT       = process.env.PORT || 3456;

if (!APP_KEY || !APP_SECRET) {
  console.error('ERROR: VFAIRS_APP_KEY and VFAIRS_APP_SECRET environment variables must be set.');
  process.exit(1);
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────
function httpsPost(url, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: {
        'Content-Type': 'application/json', 'Accept': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    req.write(payload); req.end();
  });
}

function httpsGet(url, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    https.get({
      hostname: u.hostname, path: u.pathname + u.search,
      headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' }
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

// ── Fetch all attendees (paginated) ──────────────────────────────────────────
async function fetchAllAttendees() {
  console.log('Getting OAuth token…');
  const tokenData = await httpsPost(TOKEN_URL, {
    app_key: APP_KEY, app_secret: APP_SECRET, grant_type: 'client_credentials'
  });

  const token = tokenData.access_token;
  if (!token) throw new Error('No access_token received: ' + JSON.stringify(tokenData));
  console.log('Token acquired. Fetching attendees…');

  const all = [];
  let page = 1;
  const limit = 50;

  while (page <= 500) {
    const url = BASE_URL + '&page=' + page + '&limit=' + limit;
    console.log('  Page', page);
    const data = await httpsGet(url, token);
    if (!data.users || data.users.length === 0) { console.log('No more records.'); break; }

    data.users.forEach(a => {
      const pay = a.payment || {};
      const pkg = (pay.packages && pay.packages[0]) || {};
      all.push({
        id:             a.id,
        username:       a.username,
        first_name:     a.first_name,
        last_name:      a.last_name,
        email:          a.email,
        registered_at:  a.registered_at,
        payment_status: a.has_paid ? 'Paid' : 'Not Paid',
        net_total:      pay.net_total      !== undefined ? pay.net_total      : null,
        total_vat:      pay.tax_applied    !== undefined ? pay.tax_applied    : null,
        gross_total:    pay.gross_total    !== undefined ? pay.gross_total    : null,
        package_name:   pkg.package_name   || null,
        package_amount: pkg.package_amount || null,
        status:         a.is_active ? 'Active' : 'Not Active'
      });
    });

    if (data.users.length < limit) break;
    page++;
  }

  console.log('Total fetched:', all.length);
  return all;
}

// ── HTTP server ───────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.url === '/attendees' && req.method === 'GET') {
    try {
      const attendees = await fetchAllAttendees();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, count: attendees.length, attendees }));
    } catch (err) {
      console.error('Error:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  if (req.url === '/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => {
  console.log('✅  Proxy server running on port', PORT);
});
