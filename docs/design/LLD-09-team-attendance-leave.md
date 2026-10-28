# LLD 09: Team, availability, attendance and leave

## Screens
`/staff` (people, doctors, invite), `/users`, `/availability` (weekly hours), `/attendance`, `/leave`, `/profile`.

## Rules
| Area | Rule |
|---|---|
| Invite (`/api/staff/invite`, admin) | Doctor can be added without an email (bookable, no login); an existing admin's role is never changed by an invite |
| Staff list/PATCH (`/api/staff`) | Any member sees the team; admin edits roles and doctor profiles |
| Users | see LLD-01 (`users_remove`: not yourself, clinic keeps one admin, history kept, audit in `user_removals`) |
| Availability (`appt_set_schedule`) | Start before end, breaks inside the shift; admin edits anyone, a doctor edits only their own; feeds slot generation |
| Leave of doctors | `doctor_leaves` block booking days |
| Attendance (`/api/attendance`) | `att_check_in` / `att_check_out`: one open check-in at a time; `att_today`; `att_correct` by admin, audited |
| Staff leave (`/api/leave`) | Leave types and balances (`leave_balance`), `leave_request` overlap-checked, `leave_decide` approve or reject by admin; a person sees their own, admin sees all; defaults from `clinic_provision_defaults_leave` |

## Tests
SQL `users_test.sql`, `purchasing_attendance_leave_test.sql`; unit `doctor-parse.test.ts`.
