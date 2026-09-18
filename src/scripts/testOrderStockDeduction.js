import { supabase } from '../config/supabase.js';

async function testStockDeduction() {
  console.log('=== TEST: EXACT QUANTITY STOCK DEDUCTION & ORDER PROCESSING ===\n');

  // 1. Fetch initial stock of prod-001 (Hoco WQ34plus)
  const { data: initialProduct } = await supabase
    .from('products')
    .select('id, name, price, stock')
    .eq('id', 'prod-001')
    .single();

  console.log(`[Before Order] Product "${initialProduct.name}": Current Stock = ${initialProduct.stock}`);

  const orderQuantity = 2;

  // 2. Send POST /api/orders request
  const testOrderPayload = {
    customer: {
      fullName: 'Kawser Ahmed Test',
      phone: '01711223344',
      email: 'test@gazet-bd.com',
      division: 'Dhaka',
      district: 'Dhaka',
      area: 'Dhanmondi',
      address: 'House 12, Road 4, Dhanmondi',
      postalCode: '1209',
      orderNotes: 'Please call before delivery',
      paymentMethod: 'cod',
    },
    items: [
      {
        id: 'prod-001',
        name: 'Hoco WQ34plus',
        price: 790,
        quantity: orderQuantity,
        image: 'https://pub-844c0557c33f43fb8bc62d1b17aa1e96.r2.dev/products/prod-001/image-1.jpg',
      },
    ],
    deliveryCharge: 70,
    total: 790 * orderQuantity + 70,
    paymentMethod: 'cod',
  };

  const response = await fetch('http://localhost:5000/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(testOrderPayload),
  });

  const result = await response.json();
  console.log('\n[API Response Status]:', response.status);
  console.log('[API Response Data]:\n', JSON.stringify(result, null, 2));

  // 3. Verify stock in Supabase directly
  const { data: updatedProduct } = await supabase
    .from('products')
    .select('id, name, price, stock')
    .eq('id', 'prod-001')
    .single();

  console.log(`\n[After Order] Product "${updatedProduct.name}": New Stock = ${updatedProduct.stock}`);
  console.log(`[Validation]: Stock decreased by exact quantity (-${orderQuantity})? ${updatedProduct.stock === initialProduct.stock - orderQuantity ? '✅ PASSED' : '❌ FAILED'}`);
}

testStockDeduction();
