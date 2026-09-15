alter table public.attendance_calculations drop constraint attendance_calculations_check;
alter table public.attendance_calculations add constraint attendance_calculations_check check(
  (state='provisional' and net_balance_minutes is null)
  or state='superseded'
  or (state='final' and worked_minutes is not null and net_balance_minutes is not null)
);
