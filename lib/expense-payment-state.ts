export type ExpensePaymentState = "not_paid" | "paid" | "reversed" | "mixed";
export function expensePaymentState(payments?: { status?: string }[]): ExpensePaymentState | undefined {
  if (!Array.isArray(payments) || !payments.length || payments.some((payment) => !["not_paid", "paid", "reversed"].includes(payment.status ?? ""))) return undefined;
  if (payments.some((payment) => payment.status === "not_paid")) return "not_paid";
  if (payments.every((payment) => payment.status === "paid")) return "paid";
  if (payments.every((payment) => payment.status === "reversed")) return "reversed";
  return "mixed";
}
