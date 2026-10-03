import { expect, it } from "vitest";
import { td17DeliveryState } from "./processing-state";

it("marks a TD17 as sent only after FIC reports an actual transmission or delivery outcome", () => {
  for (const status of ["sent", "processing", "accepted", "not_delivered", "no_response"]) expect(td17DeliveryState(status)).toBe("sent");
  for (const status of [undefined, "unknown", "not_sent", "pending", "attempt", "error", "discarded", "rejected"]) expect(td17DeliveryState(status)).toBe("not_sent");
});
