grant execute on function private.assert_employee_schedule_plan_editable(uuid,uuid,date),
  private.set_employee_schedule_plan(uuid,uuid,date,uuid,integer),private.clear_employee_schedule_plan(uuid,uuid,integer)
  to authenticated;
