const token = process.env.SEPAY_API_TOKEN;
const baseUrl = process.env.SEPAY_BASE_URL || 'https://userapi-sandbox.sepay.vn/v2';

async function dumpApiTx() {
  let url = `${baseUrl}/transactions/list`;
  let res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  if (res.status === 404) {
    url = `${baseUrl}/transactions`;
    res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });
  }

  const data = await res.json();
  const rawList = Array.isArray(data.transactions) ? data.transactions : Array.isArray(data.data) ? data.data : [];
  console.log('API TX full object:', JSON.stringify(rawList[0], null, 2));
}

dumpApiTx().catch(console.error);
