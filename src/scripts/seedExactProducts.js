import { supabase } from '../config/supabase.js';
import { initialProducts } from '../data/seedProducts.js';

async function syncCatalog() {
  console.log('Syncing catalog with the 3 exact products...');

  // 1. First, upsert the 3 target products with all details & Cloudflare R2 images
  for (const product of initialProducts) {
    const { data, error } = await supabase
      .from('products')
      .upsert(product, { onConflict: 'id' })
      .select();

    if (error) {
      console.error(`Error upserting ${product.id} (${product.name}):`, error.message);
    } else {
      console.log(`Upserted ${product.id} (${product.name}) - Stock: ${product.stock}, Price: ৳${product.price}`);
    }
  }

  // 2. Mark any other old test/legacy products in Supabase as 'archived' with stock 0
  const { data: allProducts, error: listErr } = await supabase.from('products').select('id, name');
  if (listErr) {
    console.error('Error fetching all products:', listErr);
    return;
  }

  const activeIds = new Set(initialProducts.map((p) => p.id));
  const otherProducts = allProducts.filter((p) => !activeIds.has(p.id));

  console.log(`Archiving ${otherProducts.length} old products in Supabase...`);
  for (const p of otherProducts) {
    const { error: archErr } = await supabase
      .from('products')
      .update({
        category: 'archived',
        stock: 0,
        featured: false,
        best_selling: false,
      })
      .eq('id', p.id);

    if (archErr) {
      console.warn(`Could not archive ${p.id}:`, archErr.message);
    } else {
      console.log(`Archived ${p.id} (${p.name})`);
    }
  }

  // 3. Verify active products in DB
  const { data: activeInDb } = await supabase
    .from('products')
    .select('id, name, price, stock, category, images')
    .neq('category', 'archived');

  console.log(`\nActive products in DB (${activeInDb?.length || 0}):`);
  activeInDb?.forEach((p) => {
    console.log(`- [${p.id}] ${p.name} | Category: ${p.category} | Price: ৳${p.price} | Stock: ${p.stock}`);
    console.log(`  Images (${p.images?.length}):`, p.images);
  });
}

syncCatalog();
