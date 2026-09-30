import { strict as assert } from "node:assert";
import { globSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
const esbuild = await import(
  pathToFileURL(
    globSync(
      "node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js",
    )[0],
  )
);
mkdirSync(".sites-runtime", { recursive: true });
await esbuild.build({
  entryPoints: ["lib/printing.ts"],
  outfile: ".sites-runtime/printing-test.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
});
const { printTotals, orderPayment, printVisible, parseQuantity, printSchemas } = await import(
  pathToFileURL(process.cwd() + "/.sites-runtime/printing-test.mjs")
);
const order = {
  id: "order",
  kind: "print_order",
  amountCents: 150000,
  history: [{ text: "private" }],
};
const cash = {
  kind: "print_transaction",
  orderId: "order",
  counterpartyType: "customer",
  transactionDate: "2026-09-17",
};
const rows = [
  order,
  { ...cash, direction: "in", amountCents: 60000 },
  { ...cash, direction: "out", amountCents: 10000 }, // refund
  {
    ...cash,
    direction: "out",
    counterpartyType: "supplier",
    amountCents: 25000,
  },
  { ...cash, direction: "in", amountCents: 9999999, archived: true },
  {
    ...cash,
    direction: "in",
    amountCents: 20000,
    transactionDate: "2026-08-10",
  },
];
assert.deepEqual(printTotals(rows, "2026-09"), {
  income: 60000,
  expenses: 35000,
  balance: 25000,
});
assert.deepEqual(printTotals(rows), {
  income: 80000,
  expenses: 35000,
  balance: 45000,
});
assert.deepEqual(orderPayment(rows, order), { paid: 70000, remaining: 80000 });
assert.deepEqual(
  orderPayment(
    [...rows, { ...cash, direction: "in", amountCents: 90000 }],
    order,
  ),
  { paid: 160000, remaining: 0 },
);
const withTasks = [
  ...rows,
  { id: "mine", kind: "task", assigneeId: "operator", orderId: "order" },
  { id: "other", kind: "task", assigneeId: "other" },
  { id: "open", kind: "task" },
  { id: "legacy", kind: "task", assignee: "Departed person" },
  { id: "client", kind: "client" },
];
const view = printVisible({ role: "print_operator" }, withTasks, "operator");
assert.deepEqual(view.map((r) => r.id).sort(), ["mine", "open", "order"]);
assert.equal("amountCents" in view.find((r) => r.id === "order"), false);
assert.equal("history" in view.find((r) => r.id === "order"), false);
assert.deepEqual(printVisible({ role: "client" }, withTasks, "operator"), []);
// Quantities: pieces are whole; metres and m² of material take decimals, typed with a comma or a dot.
assert.equal(parseQuantity("1,4"), 1.4);
assert.equal(parseQuantity(" 1.9 "), 1.9);
assert.equal(parseQuantity("12"), 12);
assert.equal(parseQuantity("2,555"), 2.56);
assert.ok(Number.isNaN(parseQuantity("1,4m")) && Number.isNaN(parseQuantity("")) && Number.isNaN(parseQuantity("-2")));
const orderData = (quantity, quantityUnit) => ({ name: "Bâche", counterparty: "Kojo", amountCents: 50000, quantity, ...(quantityUnit ? { quantityUnit } : {}), due: "2026-10-10", orderStatus: "new" });
const metres = printSchemas.print_order.safeParse(orderData(1.4, "m"));
assert.ok(metres.success && metres.data.quantity === 1.4 && metres.data.quantityUnit === "m");
assert.ok(printSchemas.print_order.safeParse(orderData(2.35, "m2")).success);
const pieces = printSchemas.print_order.safeParse(orderData(500));
assert.ok(pieces.success && pieces.data.quantityUnit === "unit", "an older order without a unit counts pieces");
assert.equal(printSchemas.print_order.safeParse(orderData(1.4, "unit")).error?.issues[0].message, "Un nombre d’unités est entier : choisissez « m » ou « m² » pour une quantité avec virgule.");
assert.ok(!printSchemas.print_order.safeParse(orderData(0, "m")).success && !printSchemas.print_order.safeParse(orderData(1, "kg")).success);
console.log(
  "18 printing checks passed: cash periods, voids, refunds, supplier expenses, overpayments, private operator payloads, and quantities in pieces, metres or m².",
);
