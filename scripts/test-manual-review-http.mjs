import http from 'http';

const username = process.env.ADMIN_USERNAME;
const password = process.env.ADMIN_PASSWORD;

if (!username || !password) {
  console.error('Missing required environment variables: ADMIN_USERNAME and ADMIN_PASSWORD must be set.');
  process.exit(1);
}

function request(options, data) {
  return new Promise((resolve, reject) => {
    const postData = data ? Buffer.from(JSON.stringify(data)) : null;
    const req = http.request({
      hostname: '127.0.0.1',
      port: 3001,
      path: options.path,
      method: options.method || 'GET',
      headers: {
        'Accept': 'application/json',
        ...(postData ? { 'Content-Type': 'application/json', 'Content-Length': postData.length } : {}),
        ...(options.headers || {})
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function runTest() {
  console.log('--- 1. Login ---');
  const loginRes = await request({ path: '/api/v1/admin/login', method: 'POST' }, { username, password });
  console.log('Login status:', loginRes.status, loginRes.body);

  const cookieHeader = loginRes.headers['set-cookie'] ? loginRes.headers['set-cookie'][0].split(';')[0] : '';
  console.log('Session Cookie:', cookieHeader);

  console.log('--- 2. Get Exceptions / Review Queue ---');
  const exRes = await request({ path: '/api/v1/admin/exceptions', headers: { Cookie: cookieHeader } });
  console.log('Exceptions Status:', exRes.status);
  const exData = JSON.parse(exRes.body);
  console.log('Expenses Needing Review Count:', exData.expensesNeedingReviewCount);
  console.log('Expenses Needing Review:', JSON.stringify(exData.expensesNeedingReview, null, 2));

  console.log('--- 3. Perform Manual Review ---');
  // Target: ae9516d2-cffe-434a-807d-da278057b022 (QR839281923)
  const targetId = 'ae9516d2-cffe-434a-807d-da278057b022';
  const updateRes = await request(
    { path: `/api/v1/admin/expenses/${targetId}`, method: 'POST', headers: { Cookie: cookieHeader } },
    {
      vietnameseTitle: 'Nước uống họp lớp',
      category: 'FOOD',
      notes: 'Nước uống họp lớp (Thủ quỹ xác nhận)'
    }
  );
  console.log('Update Status:', updateRes.status, updateRes.body);

  console.log('--- 4. Verify Exceptions Queue After Save ---');
  const exAfterRes = await request({ path: '/api/v1/admin/exceptions', headers: { Cookie: cookieHeader } });
  const exAfterData = JSON.parse(exAfterRes.body);
  console.log('Expenses Needing Review Count After Save:', exAfterData.expensesNeedingReviewCount);
  console.log('Expenses Needing Review After Save:', JSON.stringify(exAfterData.expensesNeedingReview, null, 2));
}

runTest().catch(console.error);
