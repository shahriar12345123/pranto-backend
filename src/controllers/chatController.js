import { supabase } from '../config/supabase.js';
import { initialProducts } from '../data/seedProducts.js';

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || 'sk-eb4a39e28c754882b2d403fa4e819a2e';
const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';

/**
 * POST /api/chat
 * DeepSeek AI Chatbot Controller
 * Contextually answers customer questions regarding products, order tracking, and purchase advice.
 */
export const handleChat = async (req, res) => {
  try {
    const { messages = [], message = '' } = req.body;

    // Normalize messages format
    let chatHistory = Array.isArray(messages) && messages.length > 0
      ? messages
      : [{ role: 'user', content: String(message || '').trim() }];

    if (chatHistory.length === 0 || !chatHistory[chatHistory.length - 1]?.content) {
      return res.status(400).json({ success: false, message: 'Message content is required' });
    }

    const latestUserMsg = chatHistory[chatHistory.length - 1].content;

    // 1. Fetch live products from database to ensure AI knows newly added Admin products
    let liveProducts = [];
    try {
      const { data: dbProducts } = await supabase
        .from('products')
        .select('name, category, brand, price, stock, colors, short_description, featured');
      if (dbProducts && dbProducts.length > 0) {
        liveProducts = dbProducts;
      } else {
        liveProducts = initialProducts;
      }
    } catch {
      liveProducts = initialProducts;
    }

    const inventorySummary = liveProducts.map((p) => {
      const colorsStr = Array.isArray(p.colors) && p.colors.length > 0 ? ` (Colors: ${p.colors.join(', ')})` : '';
      return `- ${p.name} (${p.brand}) - Price: ৳${p.price} | Stock: ${p.stock > 0 ? `${p.stock} in stock` : 'Out of stock'}${colorsStr} | ${p.short_description || ''}`;
    }).join('\n');

    // 2. Check if user is searching for an order reference (ORD-YYYYMMDD-XXXX pattern)
    let orderSummary = 'No specific order requested.';
    const orderMatch = latestUserMsg.match(/ORD-\d{8}-\d{4}/i);
    if (orderMatch) {
      const orderId = orderMatch[0].toUpperCase();
      try {
        const { data: foundOrder } = await supabase
          .from('orders')
          .select('id, customer_name, total_amount, payment_method, payment_status, order_status, created_at, delivery_payment_service')
          .eq('id', orderId)
          .maybeSingle();

        if (foundOrder) {
          orderSummary = `Order ${foundOrder.id}: Status is "${foundOrder.order_status}", Payment Status: "${foundOrder.payment_status}", Total: ৳${foundOrder.total_amount}, Method: ${foundOrder.payment_method.toUpperCase()}${foundOrder.delivery_payment_service ? ` (${foundOrder.delivery_payment_service})` : ''}.`;
        } else {
          orderSummary = `Order ID ${orderId} was not found in our database records.`;
        }
      } catch (err) {
        orderSummary = `Could not fetch details for ${orderId}.`;
      }
    }

    // 3. Construct System Prompt
    const systemPrompt = `You are "Gazet AI Assistant", an intelligent, courteous sales & customer service assistant for Gazet (the top wireless earbuds store in Bangladesh).
Your goal is to guide customers, recommend earbuds based on their needs/budget, answer questions about store policies, contact details, social links, and provide live order updates.

OFFICIAL STORE CONTACT & SOCIAL DETAILS:
- Facebook Page: https://www.facebook.com/friendsgazetteshop (Official Gazet Facebook link)
- Support Email: friendsshop470@gmail.com
- Customer Service Phone / WhatsApp: 01611521209
- Store Physical Address: Postal Code : 2240 Bhaluka, Mymensingh
- Payment Accounts (Send Money for COD delivery charge prepayment):
  * bKash Personal Number: 01611521209
  * Nagad Personal Number: 01342250023
  * Rocket Personal Number: 016115212098

STORE POLICIES & INFO:
- Products: 100% Original & Authentic TWS Wireless Earbuds (Hoco, Apple, USAMS, Joyroom, Lenovo, etc.)
- Delivery Charge: ৳70 inside Dhaka | ৳130 outside Dhaka (Prepaid via bKash, Nagad, or Rocket)
- Payment Method: Cash on Delivery (COD) - Customers pay only the Delivery Charge upfront via Send Money (bKash/Nagad/Rocket), submit the Txn ID, and pay the product price in cash to the delivery rider upon arrival.
- Return & Warranty: 7-day easy replacement warranty for manufacturing defects.

LIVE PRODUCT CATALOGUE IN OUR STORE (Updated in real-time from Admin Panel):
${inventorySummary}

CURRENT ORDER LOOKUP STATUS (if user mentioned an order ID):
${orderSummary}

GUIDELINES:
- Be polite, enthusiastic, concise, and helpful.
- Respond in the language used by the customer (English or Bangla / Banglish).
- WHEN ASKED FOR CONTACT DETAILS, EMAIL, PHONE NUMBER, FACEBOOK LINK, OR SOCIAL MEDIA: Always provide our Facebook link (https://www.facebook.com/friendsgazetteshop), email (friendsshop470@gmail.com), phone/WhatsApp (01611521209), and address clearly!
- When asked for recommendations, suggest 2-3 matching earbuds from our catalogue with exact prices and available colors.
- Always reassure customers about fast shipping across Bangladesh and easy Cash on Delivery.`;

    // 4. Send request to DeepSeek Chat API
    const deepseekPayload = {
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        ...chatHistory.slice(-6), // Keep recent conversation context
      ],
      temperature: 0.7,
      max_tokens: 600,
    };

    const deepseekRes = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify(deepseekPayload),
    });

    if (!deepseekRes.ok) {
      const errText = await deepseekRes.text();
      console.error('DeepSeek API error:', deepseekRes.status, errText);
      return res.status(500).json({
        success: false,
        message: 'AI Assistant service temporarily unavailable. Please try again shortly.',
      });
    }

    const deepseekData = await deepseekRes.json();
    const reply = deepseekData.choices?.[0]?.message?.content || 'I am here to help you! How can I assist with your earbuds search today?';

    return res.status(200).json({
      success: true,
      reply,
    });
  } catch (err) {
    console.error('handleChat error:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to process chat request',
    });
  }
};
