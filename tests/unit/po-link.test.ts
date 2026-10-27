import { test } from "node:test";
import assert from "node:assert/strict";
import { itemMatches } from "../../src/lib/visits/po-link";

test("an order line matches only when it covers every key word of the item", () => {
  assert.equal(itemMatches("Zirconium crown", ["Zirconium Crown - tooth 46"]), true);
  assert.equal(itemMatches("Zirconium crown", ["Zirconia crowns (pack)"]), true);       // same word stem
  assert.equal(itemMatches("Zirconium crown", ["Crown"]), false);                        // a plain crown must not close it
  assert.equal(itemMatches("Zirconium crown", ["Zirconium block", "Crown"]), false);     // words spread over different lines do not count
  assert.equal(itemMatches("Implant", ["Implant fixture 4.2mm"]), true);
  assert.equal(itemMatches("", ["Anything"]), false);
});
