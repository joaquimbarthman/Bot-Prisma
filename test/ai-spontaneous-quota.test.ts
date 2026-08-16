import assert from "node:assert/strict";
import test from "node:test";
import { SpontaneousReservationLedger } from "../src/modules/ai/spontaneous-quota.js";

test("duas reservas concorrentes não ultrapassam o décimo evento", async () => {
  const ledger = new SpontaneousReservationLedger();
  const results = await Promise.all([
    ledger.reserve("123", 50, async () => 9),
    ledger.reserve("123", 50, async () => 9),
  ]);

  assert.equal(results.filter(Boolean).length, 1);
});

test("limite configurado nunca permite uma décima primeira interação", async () => {
  const ledger = new SpontaneousReservationLedger();
  assert.equal(await ledger.reserve("123", 50, async () => 10), false);
});
