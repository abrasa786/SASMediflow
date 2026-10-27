-- 023: a doctor can say "this patient needs X (zirconium tooth, aligners…) before the next visit".
-- Saving the note makes two tasks: order it in time, and check it arrived the day before the appointment.
--   visit_notes.order_item / needed_by    what to order, and the appointment date it must be here by
--   visit_notes.order_task_id / check_task_id   the two tasks, so editing the note updates them instead of adding more
--   clinic_tasks.kind                     'order_material' or 'check_material' (the Stock page lists the open ones)
--   clinic_tasks.auto_closed_by_po        set when a purchase order for the item closed the task by itself
-- Safe to run again.

alter table clinic_tasks add column if not exists kind text;
-- a task that was closed by itself because a purchase order covers it (so cancelling that order can bring it back)
alter table clinic_tasks add column if not exists auto_closed_by_po uuid references purchase_orders(id) on delete set null;
create index if not exists clinic_tasks_kind_idx on clinic_tasks (clinic_id, kind) where kind is not null;

alter table visit_notes add column if not exists order_item text;
alter table visit_notes add column if not exists needed_by date;
alter table visit_notes add column if not exists order_task_id uuid references clinic_tasks(id) on delete set null;
alter table visit_notes add column if not exists check_task_id uuid references clinic_tasks(id) on delete set null;
