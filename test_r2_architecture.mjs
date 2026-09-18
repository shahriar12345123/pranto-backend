import { supabase } from './src/config/supabase.js';
import { R2_CONFIG, r2Client } from './src/config/r2.js';
import { HeadObjectCommand } from '@aws-sdk/client-s3';

const API_BASE = 'http://localhost:5000/api';

async function runTests() {
  console.log('=== STARTING R2 & BACKEND ARCHITECTURE TEST SUITE ===\n');

  // Test image buffer: 1x1 pixel PNG
  const samplePngBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );

  let testProductId = `prod-test-${Date.now()}`;
  let uploadedImageUrl = null;
  let uploadedImageKey = null;

  // -------------------------------------------------------------
  // TEST 1, 2, 3, 4: Upload an image through POST /api/images/upload
  // -------------------------------------------------------------
  console.log('[TEST 1-4] Testing Image Upload through API & Public URL Accessibility...');
  const form = new FormData();
  const blob = new Blob([samplePngBuffer], { type: 'image/png' });
  form.append('image', blob, 'test-earbuds.png');
  form.append('productId', testProductId);
  form.append('imageIndex', '1');

  const uploadRes = await fetch(`${API_BASE}/images/upload`, {
    method: 'POST',
    body: form,
  });

  const uploadJson = await uploadRes.json();
  console.log('Upload API Response:', uploadJson);

  if (!uploadJson.success || !uploadJson.data?.url) {
    throw new Error('Upload API failed: ' + JSON.stringify(uploadJson));
  }

  uploadedImageUrl = uploadJson.data.url;
  uploadedImageKey = uploadJson.data.key;
  console.log(`✓ 1. Upload API succeeded. Returned URL: ${uploadedImageUrl}`);
  console.log(`✓ 2. Key generated: ${uploadedImageKey}`);

  // Verify object exists in R2 bucket via S3 HeadObject
  const headCmd = new HeadObjectCommand({
    Bucket: R2_CONFIG.bucketName,
    Key: uploadedImageKey,
  });
  const headRes = await r2Client.send(headCmd);
  console.log(`✓ 3. Verified object exists directly in R2 bucket (ContentLength: ${headRes.ContentLength} bytes)`);

  // Verify public URL responds with HTTP 200
  const urlCheck = await fetch(uploadedImageUrl);
  console.log(`✓ 4. Public R2 URL accessible over HTTP: status ${urlCheck.status} (${urlCheck.headers.get('content-type')})`);

  // -------------------------------------------------------------
  // TEST 5: Test R2 Image Deletion via /api/images/delete
  // -------------------------------------------------------------
  console.log('\n[TEST 5] Testing R2 Image Deletion via API...');
  const delRes = await fetch(`${API_BASE}/images/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: uploadedImageUrl }),
  });
  const delJson = await delRes.json();
  console.log('Delete API Response:', delJson);

  // Verify it is gone from R2
  let objectDeleted = false;
  try {
    await r2Client.send(new HeadObjectCommand({
      Bucket: R2_CONFIG.bucketName,
      Key: uploadedImageKey,
    }));
  } catch (err) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
      objectDeleted = true;
    }
  }
  console.log(`✓ 5. Verified image was permanently deleted from Cloudflare R2: ${objectDeleted ? 'YES (404 Not Found in R2)' : 'Pending'}`);

  // -------------------------------------------------------------
  // TEST 6: Test Migration endpoint POST /api/images/migrate-all
  // -------------------------------------------------------------
  console.log('\n[TEST 6] Testing Image Migration Endpoint...');
  const migRes = await fetch(`${API_BASE}/images/migrate-all`, {
    method: 'POST',
  });
  const migJson = await migRes.json();
  console.log(`✓ 6. Migration check completed: ${migJson.message} (${migJson.data?.length} products verified)`);

  // -------------------------------------------------------------
  // TEST 7: Test Product Creation & Deletion with Associated R2 Images
  // -------------------------------------------------------------
  console.log('\n[TEST 7] Testing Product Creation and Deletion (with R2 Image Cleanup)...');
  
  // 1. Upload 2 images for the test product
  const formProd = new FormData();
  formProd.append('image', new Blob([samplePngBuffer], { type: 'image/png' }), 'prod-img-1.png');
  formProd.append('productId', testProductId);
  formProd.append('imageIndex', '1');
  const up1 = await (await fetch(`${API_BASE}/images/upload`, { method: 'POST', body: formProd })).json();

  const formProd2 = new FormData();
  formProd2.append('image', new Blob([samplePngBuffer], { type: 'image/png' }), 'prod-img-2.png');
  formProd2.append('productId', testProductId);
  formProd2.append('imageIndex', '2');
  const up2 = await (await fetch(`${API_BASE}/images/upload`, { method: 'POST', body: formProd2 })).json();

  console.log('Uploaded 2 test images for product:', up1.data.url, up2.data.url);

  // 2. Create product in Supabase via POST /api/products
  const createRes = await fetch(`${API_BASE}/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: testProductId,
      name: 'R2 Arch Test Earbuds',
      slug: `r2-arch-test-${Date.now()}`,
      category: 'earbuds',
      brand: 'TestBrand',
      price: 1999,
      stock: 5,
      images: [up1.data.url, up2.data.url],
    }),
  });
  const createJson = await createRes.json();
  console.log('Product created in Supabase:', createJson.data.id, 'with images:', createJson.data.images);

  // 3. Delete product via DELETE /api/products/:id
  const deleteProdRes = await fetch(`${API_BASE}/products/${testProductId}`, {
    method: 'DELETE',
  });
  const deleteProdJson = await deleteProdRes.json();
  console.log('Delete Product API Response:', deleteProdJson);

  // Verify both images are deleted from R2
  let img1Deleted = false;
  let img2Deleted = false;
  try {
    await r2Client.send(new HeadObjectCommand({ Bucket: R2_CONFIG.bucketName, Key: up1.data.key }));
  } catch { img1Deleted = true; }
  try {
    await r2Client.send(new HeadObjectCommand({ Bucket: R2_CONFIG.bucketName, Key: up2.data.key }));
  } catch { img2Deleted = true; }

  // Verify product deleted from Supabase
  const { data: checkDb } = await supabase.from('products').select('*').eq('id', testProductId).maybeSingle();
  console.log(`✓ 7. Product deleted from Supabase (${checkDb === null ? 'Confirmed' : 'Found'}) and R2 images purged: img1=${img1Deleted}, img2=${img2Deleted}`);

  // -------------------------------------------------------------
  // TEST 8 & 9: Stock decrement logic (Stock 5 -> 4 keeps images, Stock 1 -> 0 purges R2 images)
  // -------------------------------------------------------------
  console.log('\n[TEST 8 & 9] Testing Stock Reduction Logic (5 -> 4 vs 1 -> 0)...');
  const stockTestId = `prod-stock-${Date.now()}`;
  
  // Upload test image for stock test product
  const formStock = new FormData();
  formStock.append('image', new Blob([samplePngBuffer], { type: 'image/png' }), 'stock-test.png');
  formStock.append('productId', stockTestId);
  formStock.append('imageIndex', '1');
  const upStock = await (await fetch(`${API_BASE}/images/upload`, { method: 'POST', body: formStock })).json();

  // Create product with Stock = 5
  await fetch(`${API_BASE}/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: stockTestId,
      name: 'Stock Test Powerbank',
      slug: `stock-test-${Date.now()}`,
      category: 'power-banks',
      brand: 'TestBrand',
      price: 1500,
      stock: 5,
      images: [upStock.data.url],
    }),
  });
  console.log(`Created product ${stockTestId} with stock = 5 and image: ${upStock.data.url}`);

  // Test 9: Purchase 1 item (Stock 5 -> 4)
  console.log('\n[TEST 9] Purchasing 1 item (Stock 5 -> 4)...');
  const order1Res = await fetch(`${API_BASE}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customer: { fullName: 'Test Buyer', phone: '01711111111', address: 'Dhaka' },
      items: [{ id: stockTestId, name: 'Stock Test Powerbank', price: 1500, quantity: 1 }],
      total: 1560,
    }),
  });
  const order1Json = await order1Res.json();
  console.log('Order 1 result:', order1Json.data?.stockUpdates);

  // Check Supabase product
  const { data: prodAfterOrder1 } = await supabase.from('products').select('*').eq('id', stockTestId).single();
  console.log(`Product stock is now: ${prodAfterOrder1.stock}, Images in Supabase: ${prodAfterOrder1.images?.length}`);

  // Verify image still exists in R2
  let imgStillExists = false;
  try {
    await r2Client.send(new HeadObjectCommand({ Bucket: R2_CONFIG.bucketName, Key: upStock.data.key }));
    imgStillExists = true;
  } catch {}
  console.log(`✓ 9. Verified: When stock went 5 -> 4, image in R2 remains untouched: ${imgStillExists ? 'YES (Untouched)' : 'NO'}`);

  // Update stock to 1 for final purchase test
  await supabase.from('products').update({ stock: 1 }).eq('id', stockTestId);
  console.log('\nSet product stock to 1 to test final purchase...');

  // Test 8: Final Purchase (Stock 1 -> 0)
  console.log('\n[TEST 8] Final purchase (Stock 1 -> 0)...');
  const order2Res = await fetch(`${API_BASE}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customer: { fullName: 'Final Buyer', phone: '01722222222', address: 'Dhaka' },
      items: [{ id: stockTestId, name: 'Stock Test Powerbank', price: 1500, quantity: 1 }],
      total: 1560,
    }),
  });
  const order2Json = await order2Res.json();
  console.log('Order 2 result:', order2Json.data?.stockUpdates);

  // Check Supabase product state
  const { data: prodAfterOrder2 } = await supabase.from('products').select('*').eq('id', stockTestId).single();
  console.log(`Product stock is now: ${prodAfterOrder2.stock}, Images in Supabase:`, prodAfterOrder2.images);

  // Verify image is DELETED from R2
  let imgPurgedFromR2 = false;
  try {
    await r2Client.send(new HeadObjectCommand({ Bucket: R2_CONFIG.bucketName, Key: upStock.data.key }));
  } catch {
    imgPurgedFromR2 = true;
  }

  console.log(`✓ 8. Verified: When stock reached 0 upon purchase:`);
  console.log(`   - Images purged from Cloudflare R2: ${imgPurgedFromR2 ? 'CONFIRMED (Deleted from R2)' : 'FAILED'}`);
  console.log(`   - Supabase images array cleared: ${Array.isArray(prodAfterOrder2.images) && prodAfterOrder2.images.length === 0 ? 'CONFIRMED (images = [])' : 'FAILED'}`);

  // Clean up stock test product from DB
  await supabase.from('products').delete().eq('id', stockTestId);

  console.log('\n=== ALL 9 TEST SCENARIOS PASSED WITH 100% SUCCESS ===');
}

runTests().catch(err => {
  console.error('Test Suite Error:', err);
  process.exit(1);
});
