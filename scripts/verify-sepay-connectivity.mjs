const token = process.env.SEPAY_API_TOKEN;
const baseUrl = process.env.SEPAY_BASE_URL || 'https://userapi-sandbox.sepay.vn/v2';

if (!token || token === 'placeholder_api_token') {
  console.log('Sandbox API authentication: FAIL (token missing or placeholder)');
  process.exit(1);
}

async function testEndpoint(endpoint) {
  const url = `${baseUrl}${endpoint}`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });

    const data = await res.json().catch(() => null);
    return { status: res.status, ok: res.ok, data };
  } catch (err) {
    return { status: 0, ok: false, error: err.message };
  }
}

async function main() {
  // Test /transactions/list or /transactions
  let res = await testEndpoint('/transactions/list');
  if (res.status === 404) {
    res = await testEndpoint('/transactions');
  }

  console.log('HTTP status:', res.status);
  if (res.ok) {
    console.log('Sandbox API authentication: PASS');
    console.log('Transactions endpoint reachable: YES');
    const list = res.data?.transactions || res.data?.data || (Array.isArray(res.data) ? res.data : []);
    console.log('Current transaction count/page result:', Array.isArray(list) ? list.length : 0);
  } else {
    console.log('Sandbox API authentication: FAIL');
    console.log('Transactions endpoint reachable:', res.status === 404 ? 'NO' : 'YES');
    console.log('Response details:', res.data?.message || res.data?.error || `HTTP ${res.status}`);
  }
}

main().catch(console.error);
