/**
 * Central Checkout and Payment Configuration
 * Controls delivery fees and manual payment instructions across the platform.
 */

export const checkoutConfig = {
  // Delivery Fee Configuration (in BDT)
  delivery: {
    insideDhaka: Number(process.env.DELIVERY_INSIDE_DHAKA) || 70,
    outsideDhaka: Number(process.env.DELIVERY_OUTSIDE_DHAKA) || 130,
  },

  // Supported Payment Methods
  paymentMethods: {
    cod: {
      id: 'cod',
      name: 'Cash on Delivery (Advance Delivery Charge)',
      enabled: true,
      requiresTransactionId: true,
      initialPaymentStatus: 'pending_verification',
      description: 'Pay delivery charge in advance via Send Money (bKash/Nagad/Rocket) and submit Txn ID. Remaining product cost paid in cash upon delivery.',
    },
    bkash: {
      id: 'bkash',
      name: 'bKash (Send Money)',
      enabled: true,
      requiresTransactionId: true,
      initialPaymentStatus: 'pending_verification',
      accountType: 'Personal',
      accountNumber: process.env.BKASH_NUMBER || '01611521209',
      instructions: [
        'Open your bKash App and select "Send Money"',
        'Enter our Personal bKash number: {accountNumber}',
        'Enter the exact Grand Total amount: ৳{amount}',
        'Use your Phone Number or Order as reference',
        'Complete the payment and copy the Transaction ID (TrxID)',
        'Paste the TrxID below and click "Place Order"',
      ],
    },
    nagad: {
      id: 'nagad',
      name: 'Nagad (Send Money)',
      enabled: true,
      requiresTransactionId: true,
      initialPaymentStatus: 'pending_verification',
      accountType: 'Personal',
      accountNumber: process.env.NAGAD_NUMBER || '01342250023',
      instructions: [
        'Open your Nagad App and select "Send Money"',
        'Enter our Personal Nagad number: {accountNumber}',
        'Enter the exact Grand Total amount: ৳{amount}',
        'Use your Phone Number or Order as reference',
        'Complete the payment and copy the Transaction ID (TxnID)',
        'Paste the TxnID below and click "Place Order"',
      ],
    },
    rocket: {
      id: 'rocket',
      name: 'Rocket (Send Money)',
      enabled: true,
      requiresTransactionId: true,
      initialPaymentStatus: 'pending_verification',
      accountType: 'Personal',
      accountNumber: process.env.ROCKET_NUMBER || '016115212098',
      instructions: [
        'Open your Rocket App and select "Send Money"',
        'Enter our Personal Rocket number: {accountNumber}',
        'Enter the exact Grand Total amount: ৳{amount}',
        'Use your Phone Number or Order as reference',
        'Complete the payment and copy the Transaction ID (TxnID)',
        'Paste the TxnID below and click "Place Order"',
      ],
    },
  },

  /**
   * Determine the delivery charge based on district and division.
   * If district or division is Dhaka -> insideDhaka fee, otherwise outsideDhaka fee.
   */
  calculateDeliveryCharge: (district = '', division = '') => {
    const cleanDistrict = String(district || '').trim().toLowerCase();
    const cleanDivision = String(division || '').trim().toLowerCase();
    const isDhaka = cleanDistrict === 'dhaka' || cleanDivision === 'dhaka';
    return isDhaka ? checkoutConfig.delivery.insideDhaka : checkoutConfig.delivery.outsideDhaka;
  },

  /**
   * Check if the provided payment method ID is valid and enabled.
   */
  isValidPaymentMethod: (method) => {
    const clean = String(method || '').trim().toLowerCase();
    return Boolean(checkoutConfig.paymentMethods[clean]?.enabled);
  },

  /**
   * Get safe public checkout config to expose to frontend clients.
   */
  getPublicConfig: () => {
    return {
      delivery: {
        insideDhaka: checkoutConfig.delivery.insideDhaka,
        outsideDhaka: checkoutConfig.delivery.outsideDhaka,
      },
      paymentMethods: Object.values(checkoutConfig.paymentMethods)
        .filter((pm) => pm.enabled)
        .map((pm) => ({
          id: pm.id,
          name: pm.name,
          requiresTransactionId: pm.requiresTransactionId,
          accountType: pm.accountType || null,
          accountNumber: pm.accountNumber || null,
          instructions: pm.instructions || null,
          description: pm.description || null,
        })),
    };
  },
};

/**
 * Loads and synchronizes dynamic store settings from Supabase store_settings table into checkoutConfig memory
 */
export const initStoreSettingsFromDb = async (supabaseClient) => {
  if (!supabaseClient) return;
  try {
    const { data: settingsList = [] } = await supabaseClient.from('store_settings').select('*');
    for (const item of settingsList || []) {
      if (item.key === 'delivery' && item.value) {
        if (item.value.insideDhaka !== undefined) checkoutConfig.delivery.insideDhaka = Number(item.value.insideDhaka);
        if (item.value.outsideDhaka !== undefined) checkoutConfig.delivery.outsideDhaka = Number(item.value.outsideDhaka);
      }
      if (item.key === 'payment_accounts' && item.value) {
        if (item.value.bkash && checkoutConfig.paymentMethods.bkash) checkoutConfig.paymentMethods.bkash.accountNumber = item.value.bkash;
        if (item.value.nagad && checkoutConfig.paymentMethods.nagad) checkoutConfig.paymentMethods.nagad.accountNumber = item.value.nagad;
        if (item.value.rocket && checkoutConfig.paymentMethods.rocket) checkoutConfig.paymentMethods.rocket.accountNumber = item.value.rocket;
      }
    }
    console.log('[Store Settings] Successfully synchronized dynamic settings from database:', checkoutConfig.delivery);
  } catch (err) {
    console.warn('[Store Settings] Notice loading settings from database:', err.message);
  }
};

