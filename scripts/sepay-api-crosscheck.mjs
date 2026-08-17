const token = process.env.SEPAY_API_TOKEN;
const baseUrl = process.env.SEPAY_BASE_URL || 'https://userapi-sandbox.sepay.vn/v2';

if (!token || token === 'placeholder_api_token') {
  console.log('Sandbox API error: Missing token');
  process.exit(1);
}

async function crossCheck() {
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
  const rawList = Array.isArray(data.transactions) ? data.transactions : Array.isArray(data.data) ? data.data : (Array.isArray(data) ? data : []);

  console.log('Total Sandbox transactions returned:', rawList.length);
  const matching = rawList.find(t => t.id === 25849 || (t.transaction_content || t.content || '').includes('SGZV8'));

  if (matching) {
    console.log('Found matching transaction in SePay Sandbox API:');
    console.log('SePay ID:', matching.id);
    console.log('Amount in:', matching.amount_in || matching.transfer_amount || matching.amount);
    console.log('Amount out:', matching.amount_out || 0);
    console.log('Content:', matching.transaction_content || matching.content);
    console.log('Transaction Date:', matching.transaction_date);
    console.log('Gateway / Bank:', matching.bank_brand_name || matching.gateway || matching.account_number);
  } else {
    console.log('Transaction not found in list. Available IDs:', rawList.map(t => t.id));
  }
}

crossCheck().catch(console.error);
