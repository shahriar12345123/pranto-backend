const API_BASE = 'http://localhost:5000/api';

async function runCheckoutTests() {
  console.log('===============================================================');
  console.log('       RUNNING CHECKOUT, DELIVERY & PAYMENT TESTS             ');
  console.log('===============================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`✅ [PASS] ${message}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${message}`);
      failed++;
    }
  }

  try {
    // -------------------------------------------------------------
    // Test 1: GET /api/orders/config
    // -------------------------------------------------------------
    console.log('--- Test 1: GET /api/orders/config ---');
    const configRes = await fetch(`${API_BASE}/orders/config`);
    const configJson = await configRes.json();
    assert(configRes.ok && configJson.success, 'Fetched checkout configuration successfully');
    assert(configJson.data.delivery.insideDhaka === 70, 'Delivery inside Dhaka is 70 BDT');
    assert(configJson.data.delivery.outsideDhaka === 130, 'Delivery outside Dhaka is 130 BDT');
    assert(configJson.data.paymentMethods.length === 4, 'Includes 4 payment methods (COD, bKash, Nagad, Rocket)');
    console.log('');

    // -------------------------------------------------------------
    // Test 2: COD Order (Inside Dhaka)
    // -------------------------------------------------------------
    console.log('--- Test 2: Cash on Delivery (COD) Inside Dhaka ---');
    const codRes = await fetch(`${API_BASE}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer: {
          fullName: 'Tanvir Hasan',
          phone: '01711223344',
          division: 'Dhaka',
          district: 'Dhaka',
          address: 'House 12, Road 5, Dhanmondi',
        },
        items: [{ id: 'prod-001', quantity: 1 }], // Hoco WQ34plus (৳790)
        paymentMethod: 'cod',
      }),
    });
    const codJson = await codRes.json();
    assert(codRes.status === 201, 'COD order created with HTTP 201');
    assert(codJson.data.paymentMethod === 'cod', 'payment_method is "cod"');
    assert(codJson.data.paymentStatus === 'unpaid', 'payment_status is "unpaid"');
    assert(codJson.data.transactionId === null, 'transaction_id is null for COD');
    assert(codJson.data.deliveryCharge === 70, 'delivery_charge is ৳70 for inside Dhaka');
    assert(codJson.data.subtotal === 790, 'subtotal is ৳790');
    assert(codJson.data.total === 860, 'total is ৳860 (790 + 70)');
    console.log('');

    // -------------------------------------------------------------
    // Test 3: bKash Order (Outside Dhaka)
    // -------------------------------------------------------------
    console.log('--- Test 3: bKash Manual Payment (Outside Dhaka - Chattogram) ---');
    const testBkashTxn = `BKASH_TEST_${Date.now()}`;
    const bkashRes = await fetch(`${API_BASE}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer: {
          fullName: 'Rahim Chowdhury',
          phone: '01812345678',
          division: 'Chattogram',
          district: 'Chattogram',
          address: 'GEC Circle, Nasirabad',
        },
        items: [{ id: 'prod-002', quantity: 1 }], // Apple 2nd gen (৳550)
        paymentMethod: 'bkash',
        transactionId: testBkashTxn,
      }),
    });
    const bkashJson = await bkashRes.json();
    assert(bkashRes.status === 201, 'bKash order created with HTTP 201');
    assert(bkashJson.data.paymentMethod === 'bkash', 'payment_method is "bkash"');
    assert(bkashJson.data.paymentStatus === 'pending_verification', 'payment_status is "pending_verification" (NOT paid)');
    assert(bkashJson.data.transactionId === testBkashTxn, 'transaction_id matches provided value');
    assert(bkashJson.data.deliveryCharge === 130, 'delivery_charge is ৳130 for outside Dhaka');
    assert(bkashJson.data.subtotal === 550, 'subtotal is ৳550');
    assert(bkashJson.data.total === 680, 'total is ৳680 (550 + 130)');
    console.log('');

    // -------------------------------------------------------------
    // Test 4: Nagad Order (Manual Payment)
    // -------------------------------------------------------------
    console.log('--- Test 4: Nagad Manual Payment ---');
    const testNagadTxn = `NGD_TEST_${Date.now()}`;
    const nagadRes = await fetch(`${API_BASE}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer: {
          fullName: 'Sabbir Ahmed',
          phone: '01999887766',
          division: 'Rajshahi',
          district: 'Bogura',
          address: 'Satmatha, Bogura Sadar',
        },
        items: [{ id: 'prod-003', quantity: 1 }], // UISI Neckband (৳899)
        paymentMethod: 'nagad',
        transactionId: testNagadTxn,
      }),
    });
    const nagadJson = await nagadRes.json();
    assert(nagadRes.status === 201, 'Nagad order created with HTTP 201');
    assert(nagadJson.data.paymentMethod === 'nagad', 'payment_method is "nagad"');
    assert(nagadJson.data.paymentStatus === 'pending_verification', 'payment_status is "pending_verification"');
    assert(nagadJson.data.transactionId === testNagadTxn, 'transaction_id preserved');
    console.log('');

    // -------------------------------------------------------------
    // Test 5: Rocket Order (Manual Payment)
    // -------------------------------------------------------------
    console.log('--- Test 5: Rocket Manual Payment ---');
    const testRocketTxn = `RKT_TEST_${Date.now()}`;
    const rocketRes = await fetch(`${API_BASE}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer: {
          fullName: 'Nadia Islam',
          phone: '01655443322',
          division: 'Sylhet',
          district: 'Sylhet',
          address: 'Zindabazar, Sylhet',
        },
        items: [{ id: 'prod-001', quantity: 1 }],
        paymentMethod: 'rocket',
        transactionId: testRocketTxn,
      }),
    });
    const rocketJson = await rocketRes.json();
    assert(rocketRes.status === 201, 'Rocket order created with HTTP 201');
    assert(rocketJson.data.paymentMethod === 'rocket', 'payment_method is "rocket"');
    assert(rocketJson.data.paymentStatus === 'pending_verification', 'payment_status is "pending_verification"');
    assert(rocketJson.data.transactionId === testRocketTxn, 'transaction_id preserved');
    console.log('');

    // -------------------------------------------------------------
    // Test 6: Missing / Empty Transaction ID for bKash
    // -------------------------------------------------------------
    console.log('--- Test 6: Missing Transaction ID Rejection for bKash ---');
    const noTxnRes = await fetch(`${API_BASE}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer: {
          fullName: 'Test User',
          phone: '01700000000',
          division: 'Dhaka',
          district: 'Dhaka',
          address: 'Dhaka',
        },
        items: [{ id: 'prod-001', quantity: 1 }],
        paymentMethod: 'bkash',
        transactionId: '   ', // empty / whitespace only
      }),
    });
    const noTxnJson = await noTxnRes.json();
    assert(noTxnRes.status === 400, 'Rejected with HTTP 400 when Transaction ID is missing for bKash');
    assert(noTxnJson.success === false, 'success is false');
    console.log('');

    // -------------------------------------------------------------
    // Test 7: Duplicate Transaction ID Protection
    // -------------------------------------------------------------
    console.log('--- Test 7: Duplicate Transaction ID Protection ---');
    const dupRes = await fetch(`${API_BASE}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer: {
          fullName: 'Imposter User',
          phone: '01711112222',
          division: 'Dhaka',
          district: 'Dhaka',
          address: 'Dhaka',
        },
        items: [{ id: 'prod-001', quantity: 1 }],
        paymentMethod: 'bkash',
        transactionId: testBkashTxn, // Reusing the same Transaction ID from Test 3
      }),
    });
    const dupJson = await dupRes.json();
    assert(dupRes.status === 400, 'Duplicate Transaction ID rejected with HTTP 400');
    assert(dupJson.message.includes('already been submitted'), 'Rejection message flags duplicate usage');
    console.log('');

    // -------------------------------------------------------------
    // Test 8: Security: Tampered Total & Delivery Charge
    // -------------------------------------------------------------
    console.log('--- Test 8: Client-Side Tampering Protection (Prices / Delivery / Totals) ---');
    const tamperRes = await fetch(`${API_BASE}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer: {
          fullName: 'Hacker Attempt',
          phone: '01711000000',
          division: 'Khulna', // outside Dhaka -> should be 130
          district: 'Khulna',
          address: 'Shibbari More',
        },
        items: [{ id: 'prod-001', quantity: 2, price: 10 }], // Claiming price is 10 instead of 790
        deliveryCharge: 0, // Claiming free delivery
        total: 20, // Claiming grand total is 20 instead of (790*2 + 130 = 1710)
        paymentMethod: 'cod',
        payment_status: 'paid', // Trying to forge paid status
      }),
    });
    const tamperJson = await tamperRes.json();
    assert(tamperRes.status === 201, 'Order created with authoritative recalculated values');
    assert(tamperJson.data.subtotal === 1580, 'Backend calculated authoritative subtotal: ৳1,580 (790 * 2)');
    assert(tamperJson.data.deliveryCharge === 130, 'Backend calculated authoritative delivery charge: ৳130 (outside Dhaka)');
    assert(tamperJson.data.total === 1710, 'Backend calculated authoritative total: ৳1,710 (1580 + 130)');
    assert(tamperJson.data.paymentStatus === 'unpaid', 'Client forged "paid" status overridden to "unpaid"');
    console.log('');

    // -------------------------------------------------------------
    // Test 9: Stock Protection (Excess Quantity)
    // -------------------------------------------------------------
    console.log('--- Test 9: Insufficient Stock Rejection ---');
    const stockRes = await fetch(`${API_BASE}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer: {
          fullName: 'Bulk Buyer',
          phone: '01755555555',
          division: 'Dhaka',
          district: 'Dhaka',
          address: 'Mirpur 10',
        },
        items: [{ id: 'prod-001', quantity: 999999 }], // Exceeds available stock
        paymentMethod: 'cod',
      }),
    });
    const stockJson = await stockRes.json();
    assert(stockRes.status === 400, 'Order rejected with HTTP 400 due to insufficient stock');
    assert(stockJson.message.includes('Insufficient stock'), 'Error message states insufficient stock');
    console.log('');

    // -------------------------------------------------------------
    // Summary
    // -------------------------------------------------------------
    console.log('===============================================================');
    console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
    console.log('===============================================================');

  } catch (err) {
    console.error('Test execution error:', err);
  }
}

runCheckoutTests();
