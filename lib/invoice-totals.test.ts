import { expect, it } from "vitest";
import { currencyTotals } from "./invoice-totals";
import { EMPTY_INVOICE } from "./suppliers/common";
it("keeps EUR and USD separate and excludes flagged duplicates", () => {
  expect(currencyTotals([
    { invoice: { ...EMPTY_INVOICE, currency: "EUR", total_amount: 12.75 }, status: "extracted" },
    { invoice: { ...EMPTY_INVOICE, currency: "USD", total_amount: 45 }, status: "extracted" },
    { invoice: { ...EMPTY_INVOICE, currency: "EUR", total_amount: 12.75 }, status: "duplicate" },
  ])).toBe("12,75 EUR · 45,00 USD");
});
it("handles missing amounts and an empty review", () => {
  expect(currencyTotals([])).toBe("0,00 EUR");
  expect(currencyTotals([{ invoice: { ...EMPTY_INVOICE, currency: "USD", total_amount: null }, status: "needs_review" }])).toBe("0,00 USD");
});
