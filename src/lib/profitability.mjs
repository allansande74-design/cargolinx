
export function calculateProfitability(sourcingCost, landedCost, sellingPrice, overhead = 0.05) {
  const grossProfit = sellingPrice - landedCost;
  const netProfit = grossProfit - (landedCost * overhead);
  const margin = (netProfit / sellingPrice) * 100;
  
  return {
    grossProfit,
    netProfit,
    margin: margin.toFixed(2) + '%',
    status: margin >= 15 ? 'VIABLE' : 'MARGIN_LOW'
  };
}
