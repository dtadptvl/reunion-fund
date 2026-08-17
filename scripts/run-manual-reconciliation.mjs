import { DatabaseSync } from 'node:sqlite';

const token = process.env.SEPAY_API_TOKEN;
const baseUrl = process.env.SEPAY_BASE_URL || 'https://userapi-sandbox.sepay.vn/v2';

async function testReconciliation() {
  console.log('Testing manual reconciliation against SePay Sandbox API...');

  // 1. Fetch from SePay API
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

  console.log('Transactions returned from SePay API:', rawList.length);

  // 2. Check existing in DB
  const db = new DatabaseSync('/data/data/com.termux/files/home/check_db/reunion-fund.db');
  let alreadyPresentCount = 0;
  let newlyImportedCount = 0;

  for (const item of rawList) {
    const refCode = item.referenceCode || item.reference_number || null;
    const content = item.content || item.transaction_content || '';
    const date = item.transactionDate || item.transaction_date || '';
    const amount = item.transferAmount ?? item.transfer_amount ?? item.amount_in ?? 0;
    const id = isNaN(Number(item.id)) ? 0 : Number(item.id);

    const existing = db.prepare(`
      SELECT id FROM bank_transactions
      WHERE (sepay_id = ? AND sepay_id != 0)
         OR (reference_code IS NOT NULL AND reference_code = ?)
         OR (content = ? AND transaction_date = ? AND transfer_amount = ?)
    `).get(id, refCode, content, date, amount);

    if (existing) {
      alreadyPresentCount++;
    } else {
      newlyImportedCount++;
    }
  }

  console.log('Manual Reconciliation Result:');
  console.log('- Total checked:', rawList.length);
  console.log('- Already present locally:', alreadyPresentCount);
  console.log('- Newly imported:', newlyImportedCount);
  console.log('- Duplicate detected:', newlyImportedCount > 0 ? 'YES' : 'NO');
}

testReconciliation().catch(console.error);
