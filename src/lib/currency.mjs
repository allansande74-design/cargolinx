
export const CURRENCY_CONFIG = {
  base: 'USD',
  symbols: {
    USD: '$',
    KES: 'KSh',
    UGX: 'UGX',
    TZS: 'TZS',
    EUR: '€',
    GBP: '£'
  },
  // Fallback rates in case API is down (Central Bank approximations)
  fallbackRates: {
    KES: 130.50,
    UGX: 3750.00,
    TZS: 2580.00,
    EUR: 0.92,
    GBP: 0.79
  }
};

async function fetchRates() {
  try {
    // Using a reliable public API for daily central bank rates
    const response = await fetch(`https://open.er-api.com/v6/latest/${CURRENCY_CONFIG.base}`);
    const data = await response.json();
    if (data.result === 'success') {
      return data.rates;
    }
  } catch (e) {
    console.warn('Currency API fetch failed, using fallback rates', e);
  }
  return CURRENCY_CONFIG.fallbackRates;
}

export async function getExchangeRate(targetCurrency) {
  const rates = await fetchRates();
  return rates[targetCurrency] || CURRENCY_CONFIG.fallbackRates[targetCurrency] || 1.0;
}

export function formatCurrency(value, currency = 'USD') {
  const symbol = CURRENCY_CONFIG.symbols[currency] || currency;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency,
  }).format(value);
}

export async function convertUSD(amount, targetCurrency) {
  const rate = await getExchangeRate(targetCurrency);
  return amount * rate;
}
