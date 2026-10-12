import Decimal from "decimal.js-light";

export type QuantityRate = { quantity: string | number; rate: string | number };
export type SlabConfiguration = {
  thresholdLow: string | number;
  thresholdHigh: string | number;
  multiplierLow: string | number;
  multiplierMid: string | number;
  multiplierHigh: string | number;
};

/**
 * Preserves the verified workbook kernel without binding it to a project.
 * Inputs must already be normalized, reconciled, and authorized before Stage 5
 * calls this function. The caller chooses the quantity/rate pairs and slab.
 */
export function calculateVerifiedKernel(
  quantityRates: QuantityRate[],
  averageHours: string | number,
  slab: SlabConfiguration,
) {
  const base = quantityRates.reduce(
    (sum, item) => sum.plus(new Decimal(item.quantity).times(item.rate)),
    new Decimal(0),
  );
  const hours = new Decimal(averageHours);
  const low = new Decimal(slab.thresholdLow);
  const high = new Decimal(slab.thresholdHigh);
  const multiplier = hours.lt(low)
    ? new Decimal(slab.multiplierLow)
    : hours.lt(high)
      ? new Decimal(slab.multiplierMid)
      : new Decimal(slab.multiplierHigh);
  return {
    baseAmount: base.toDecimalPlaces(6).toString(),
    multiplier: multiplier.toString(),
    payableAmount: base.times(multiplier).toDecimalPlaces(6).toString(),
  };
}
