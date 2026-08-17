const token = process.env.SEPAY_API_TOKEN;
const baseUrl = process.env.SEPAY_BASE_URL || 'https://userapi-sandbox.sepay.vn/v2';

async function crossCheckAll() {
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
  console.log('Total Sandbox transactions in SePay API:', rawList.length);

  for (const t of rawList) {
    console.log({
      id: t.id,
      amount_in: t.amount_in || t.transfer_amount,
      content: t.transaction_content || t.content,
      ref: t.reference_number || t.referenceCode,
      date: t.transaction_date || t.transactionDate,
    });
  }
}

crossCheckAll().catch(console.error);
