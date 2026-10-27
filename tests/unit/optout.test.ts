import { test } from "node:test";
import assert from "node:assert/strict";
import { isStopMessage, isStartMessage } from "../../src/lib/whatsapp/optout";

test("STOP and START replies are recognised, normal chat is not", () => {
  for (const t of ["STOP", "stop", " Stop. ", "unsubscribe", "opt out", "Stop all!"]) assert.equal(isStopMessage(t), true, t);
  for (const t of ["START", "start", "subscribe", "opt in"]) assert.equal(isStartMessage(t), true, t);
  for (const t of ["please stop the pain", "book appointment", "menu", "I want to start braces", ""]) {
    assert.equal(isStopMessage(t), false, t);
    assert.equal(isStartMessage(t), false, t);
  }
});
