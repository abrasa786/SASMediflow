# LLD 08: Stock and purchasing

## Purpose
Know what is on the shelf, record what a sitting uses, order from suppliers and pay supplier bills.

## Screens
`/stock`, `/stock/[id]`, `/purchasing` (orders, suppliers, bills), `/purchasing/orders/[id]`, `/purchasing/bills/[id]`, `/purchasing/suppliers/[id]`, `/purchasing/print`.

## Tables
`stock_items` (name, quantity, unit, minimum), `stock_movements` (every change with reason), `suppliers`, `purchase_orders` and `purchase_order_items`, `supplier_bills`, `supplier_payments`, `clinic_tasks` (order and check reminders).

## Rules
- Low stock = quantity at or under the minimum; `flow` low-stock automations and the dashboard use it.
- `po_create` → `po_receive` adds stock and writes a movement; `po_cancel`; quantities never go negative.
- Equipment used in a sitting is saved on the sitting (`consumables`) and deducted when the sitting is completed (`tx_complete_sitting`); the sitting form warns about low stock.
- Supplier bills: `bill_pay` style part and full payment, admin only.

## API
| Route | Roles |
|---|---|
| `/api/purchasing/supplier` | admin, nurse, receptionist |
| `/api/purchasing/order` | admin, nurse, receptionist |
| `/api/purchasing/bill` | admin |
`/api/visits/note` creates the order and check tasks (below).

## Order reminders (migration 023, `src/lib/visits`)
A doctor writes on a visit note "this patient needs X before the next visit" (`order_item`, `needed_by`). The server creates two tasks (`order_material`, `check_material`): order it in time and check it arrived the day before. `orders.ts` computes the dates; `po-link.ts` closes the order task when a purchase order for that item is placed and the check task when it is received (`auto_closed_by_po`). `OrderReminders` lists the open ones on the Stock page.

## Tests
SQL `purchasing_attendance_leave_test.sql`; unit `po-link.test.ts`, `visit-orders.test.ts`.
