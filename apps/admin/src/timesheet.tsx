import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { api, apiUrl, ApiError, type AbsenceCategory, type DayJustification, type Employee, type EmployeePaymentDay, type FinancialAttendanceRow, type FinancialAttendanceTotals, type Location, type Punch, type WorkDay, withQuery } from './api.js';
import { formatClockTyping, isValidClockInput } from './time-input.js';

type TimesheetFiltersValue = { employeeId: string; locationId: string; from: string; to: string };
type Slot = 'entry' | 'break_start' | 'break_end' | 'exit';
type AdditionKey = 'meal_units' | 'dinner_units' | 'daily_allowance_units' | 'night_shift_units' | 'saturday_units' | 'serao_units';

const slots: Array<[Slot, string]> = [
  ['entry', 'Entrada'], ['break_start', 'Saída 1'], ['break_end', 'Entrada 2'], ['exit', 'Saída 2'],
];
const additions: Array<[AdditionKey, string]> = [
  ['meal_units', 'Almoço'], ['dinner_units', 'Janta'], ['daily_allowance_units', 'Diária'],
  ['night_shift_units', 'Madrugada'], ['saturday_units', 'Sábado'], ['serao_units', 'Serão'],
];

function minutes(value: number | null | undefined) {
  if (value == null) return '—';
  const sign = value < 0 ? '−' : value > 0 ? '+' : '';
  const absolute = Math.abs(value);
  return `${sign}${Math.floor(absolute / 60)}h${String(absolute % 60).padStart(2, '0')}`;
}
function plainMinutes(value: number | null | undefined) { return minutes(value).replace(/^[+−]/, ''); }
function currency(cents: number) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100); }
function dayLabel(value: string) { return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Fortaleza', weekday: 'short', day: '2-digit', month: '2-digit' }).format(new Date(`${value}T12:00:00-03:00`)); }
function fortalezaDate(value: string) { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Fortaleza', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value)); const part = (type: string) => parts.find((item) => item.type === type)?.value ?? ''; return `${part('year')}-${part('month')}-${part('day')}`; }
function fortalezaTime(value: string) { return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Fortaleza', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)); }
function datesInRange(from: string, to: string) {
  if (!from || !to || to < from) return [] as string[];
  const cursor = new Date(`${from}T12:00:00-03:00`); const end = new Date(`${to}T12:00:00-03:00`); const result: string[] = [];
  while (cursor <= end) { result.push(cursor.toISOString().slice(0, 10)); cursor.setUTCDate(cursor.getUTCDate() + 1); }
  return result;
}
function currentCalculation(day: WorkDay | undefined) {
  const calculations = day?.attendance_calculations ?? [];
  const eligible = calculations.filter((item) => item.state !== 'superseded');
  return [...(eligible.length ? eligible : calculations)].sort((left, right) => right.revision - left.revision)[0];
}

function dateForPeriod(period: 'today' | 'week' | 'month') {
  const today = fortalezaDate(new Date().toISOString());
  // Midday in Fortaleza stays on the same calendar day in UTC, so UTC arithmetic
  // below cannot move a late-evening shortcut into tomorrow.
  const start = new Date(`${today}T12:00:00-03:00`);
  const weekday = start.getUTCDay() || 7;
  if (period === 'week') start.setUTCDate(start.getUTCDate() - (weekday - 1));
  if (period === 'month') start.setUTCDate(1);
  return { from: start.toISOString().slice(0, 10), to: today };
}

export function TimesheetFilters({ employees, locations, employeeId, locationId, from, to, onApply }: {
  employees: Employee[]; locations: Location[]; employeeId: string; locationId: string; from: string; to: string;
  onApply: (value: TimesheetFiltersValue) => void;
}) {
  const [draft, setDraft] = useState<TimesheetFiltersValue>({ employeeId, locationId, from, to });
  const [filterMessage, setFilterMessage] = useState('');
  useEffect(() => setDraft({ employeeId, locationId, from, to }), [employeeId, locationId, from, to]);
  function shortcut(period: 'today' | 'week' | 'month') { setFilterMessage(''); setDraft((current) => ({ ...current, ...dateForPeriod(period) })); }
  function apply() {
    if (!draft.employeeId || !draft.from || !draft.to) { setFilterMessage('Escolha o funcionário e informe o início e o fim do período.'); return; }
    const start = new Date(`${draft.from}T12:00:00-03:00`).getTime(); const end = new Date(`${draft.to}T12:00:00-03:00`).getTime();
    if (end < start) { setFilterMessage('A data final precisa ser igual ou posterior à data inicial.'); return; }
    if ((end - start) / 86_400_000 + 1 > 93) { setFilterMessage('Escolha um período de até 93 dias para manter a apuração completa e rápida.'); return; }
    setFilterMessage(''); onApply(draft);
  }
  return <section className="timesheet-filters panel" aria-label="Filtros da apuração">
    <div><p className="eyebrow">APURAÇÃO E RELATÓRIO</p><h2>Escolha quem e qual período deseja conferir</h2><p>Os valores, o espelho e os arquivos baixados usam exatamente esta pesquisa.</p></div>
    <div className="timesheet-filter-fields">
      <label>Funcionário<select value={draft.employeeId} onChange={(event) => setDraft((current) => ({ ...current, employeeId: event.target.value }))}><option value="">Selecione</option>{employees.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.registration}{item.active ? '' : ' · desativado'}</option>)}</select></label>
      <label>Local para inclusão manual<select value={draft.locationId} onChange={(event) => setDraft((current) => ({ ...current, locationId: event.target.value }))}><option value="">Usar local principal</option>{locations.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>De<input type="date" value={draft.from} onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))} /></label>
      <label>Até<input type="date" value={draft.to} onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))} /></label>
      <div className="timesheet-filter-actions"><button type="button" className="secondary" onClick={() => shortcut('today')}>Hoje</button><button type="button" className="secondary" onClick={() => shortcut('week')}>Esta semana</button><button type="button" className="secondary" onClick={() => shortcut('month')}>Este mês</button><button type="button" className="secondary" onClick={() => { setFilterMessage(''); setDraft((current) => ({ ...current, from: '', to: '' })); }}>Limpar datas</button><button type="button" onClick={apply}>Buscar apuração</button></div>
    </div>
    <small>A jornada do funcionário reúne batidas de todos os locais autorizados. O local acima só é usado se você incluir uma batida esquecida.</small>{filterMessage && <p className="form-message" aria-live="polite">{filterMessage}</p>}
  </section>;
}

function ReportDownloads({ companyId, employeeId, from, to, token }: { companyId: string; employeeId: string; from: string; to: string; token: string }) {
  const [message, setMessage] = useState(''); const [pending, setPending] = useState<'xlsx' | 'pdf' | null>(null);
  async function download(format: 'xlsx' | 'pdf') {
    setPending(format); setMessage('');
    try {
      const response = await fetch(apiUrl(withQuery('/v1/reports/attendance', { company_id: companyId, employee_id: employeeId, date_from: from || undefined, date_to: to || undefined, format })), { headers: { authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error('Não foi possível gerar o relatório.');
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement('a');
      link.href = url; link.download = `pontificeluga-apuracao.${format}`; link.click(); URL.revokeObjectURL(url);
      setMessage(`Arquivo ${format.toUpperCase()} baixado.`);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Não foi possível baixar o arquivo.'); }
    finally { setPending(null); }
  }
  return <section className="report-downloads"><div><strong>Baixar esta apuração</strong><span>O PDF e o XLSX mostram o mesmo funcionário, período e valores exibidos abaixo.</span>{message && <small className="form-message">{message}</small>}</div><div className="report-actions"><button className="secondary" disabled={pending !== null} onClick={() => void download('xlsx')}>{pending === 'xlsx' ? 'Preparando…' : 'Baixar XLSX'}</button><button disabled={pending !== null} onClick={() => void download('pdf')}>{pending === 'pdf' ? 'Preparando…' : 'Baixar PDF'}</button></div></section>;
}

function DailyAdditions({ companyId, employeeId, token, dates, from, to, onSaved }: { companyId: string; employeeId: string; token: string; dates: string[]; from: string; to: string; onSaved: () => void }) {
  const [items, setItems] = useState<EmployeePaymentDay[]>([]); const [message, setMessage] = useState(''); const [pendingDate, setPendingDate] = useState('');
  useEffect(() => {
    let active = true; setItems([]); setMessage(''); setPendingDate('');
    void api<{ data: EmployeePaymentDay[] }>(withQuery('/v1/payment-days', { company_id: companyId, employee_id: employeeId, date_from: from || undefined, date_to: to || undefined }), token)
      .then((result) => { if (active) setItems(result.data); })
      .catch((cause) => { if (active) setMessage(cause instanceof ApiError ? cause.message : 'Não foi possível carregar os adicionais.'); });
    return () => { active = false; };
  }, [companyId, employeeId, from, to, token]);
  const byDate = new Map(items.map((item) => [item.local_date, item]));
  async function toggle(date: string, key: AdditionKey, checked: boolean) {
    const current = byDate.get(date); setPendingDate(date); setMessage('');
    const defaults: Record<AdditionKey, number> = { meal_units: 0, dinner_units: 0, daily_allowance_units: 0, night_shift_units: 0, saturday_units: 0, serao_units: 0 };
    const values = { ...defaults, ...(current ?? {}), [key]: checked ? 1 : 0 };
    try {
      const saved = await api<EmployeePaymentDay>('/v1/payment-days', token, { method: 'POST', body: JSON.stringify({ company_id: companyId, employee_id: employeeId, local_date: date, expected_version: current?.version ?? null, ...values }) });
      setItems((previous) => [...previous.filter((item) => item.local_date !== date), saved]);
      onSaved();
    } catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Não foi possível salvar o adicional.'); }
    finally { setPendingDate(''); }
  }
  if (!dates.length) return null;
  return <section className="daily-allowances"><div><strong>Adicionais do dia</strong><span>Marque o que foi pago ou concedido. O valor é aplicado na hora e vem da regra geral, do cargo ou do funcionário.</span></div><div className="table-wrap"><table><thead><tr><th>Data</th>{additions.map(([, label]) => <th key={label}>{label}</th>)}</tr></thead><tbody>{dates.map((date) => { const item = byDate.get(date); return <tr key={date}><td>{dayLabel(date)}</td>{additions.map(([key, label]) => <td key={key}><label className="allowance-check"><input type="checkbox" disabled={pendingDate === date} checked={(item?.[key] ?? 0) > 0} onChange={(event) => void toggle(date, key, event.target.checked)} />{(item?.[key] ?? 0) > 0 ? label : 'Não'}</label></td>)}</tr>; })}</tbody></table></div>{message && <p className="form-message">{message}</p>}</section>;
}

function JustificationControl({ companyId, employeeId, date, categories, value, token, onSaved }: { companyId: string; employeeId: string; date: string; categories: AbsenceCategory[]; value: DayJustification | undefined; token: string; onSaved: () => void }) {
  const activeCategories = categories.filter((item) => item.active);
  const [categoryId, setCategoryId] = useState(''); const [note, setNote] = useState(''); const [pending, setPending] = useState(false); const [message, setMessage] = useState('');
  useEffect(() => { if (!activeCategories.some((item) => item.id === categoryId)) setCategoryId(activeCategories[0]?.id ?? ''); }, [activeCategories, categoryId]);
  async function save(event: FormEvent) {
    event.preventDefault(); if (!categoryId) return; setPending(true); setMessage('');
    try { await api('/v1/day-justifications', token, { method: 'POST', body: JSON.stringify({ company_id: companyId, employee_id: employeeId, local_date: date, absence_category_id: categoryId, note: note || undefined }) }); setNote(''); onSaved(); }
    catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Não foi possível justificar este dia.'); }
    finally { setPending(false); }
  }
  async function remove() {
    if (!value) return; setPending(true); setMessage('');
    try { await api(`/v1/day-justifications/${value.id}`, token, { method: 'DELETE', body: JSON.stringify({ company_id: companyId }) }); onSaved(); }
    catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Não foi possível remover a justificativa.'); }
    finally { setPending(false); }
  }
  if (value) return <div className="justification"><strong>{value.absence_categories?.name ?? 'Justificado'}</strong><small>{value.abones_hours ? 'Horas abonadas' : 'Não abona horas'}{value.note ? ` · ${value.note}` : ''}</small><button type="button" className="secondary small-button" disabled={pending} onClick={() => void remove()}>{pending ? 'Salvando…' : 'Remover'}</button>{message && <small className="row-message">{message}</small>}</div>;
  return <details className="justification"><summary>Justificar dia</summary><form onSubmit={save}><label>Categoria<select required value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Selecione</option>{activeCategories.map((item) => <option key={item.id} value={item.id}>{item.name}{item.abones_hours ? ' · abona horas' : ''}</option>)}</select></label><label>Observação<textarea maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} /></label><button disabled={pending || !categoryId}>{pending ? 'Salvando…' : 'Salvar justificativa'}</button>{message && <small className="row-message">{message}</small>}</form></details>;
}

type PunchEditorProps = { date: string; label: string; punch: Punch | undefined; missing?: boolean; disabled: boolean; onEdit: (punch: Punch, time: string, reason: string) => Promise<void>; onAdd: (time: string, reason: string) => Promise<void> };

function PunchEditor({ date, label, punch, missing, disabled, onEdit, onAdd }: PunchEditorProps) {
  const [editing, setEditing] = useState(false); const [time, setTime] = useState(''); const [reason, setReason] = useState(''); const [message, setMessage] = useState(''); const [pending, setPending] = useState(false);
  function start() { setTime(punch ? fortalezaTime(punch.timestamp) : ''); setReason(punch ? 'Correção pela apuração do período' : 'Batida esquecida informada na apuração do período'); setMessage(''); setEditing(true); }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!isValidClockInput(time)) { setMessage('Informe um horário válido, por exemplo 08:31.'); return; }
    if (!reason.trim()) { setMessage('Informe o motivo da alteração.'); return; }
    setPending(true); setMessage('');
    try { if (punch) await onEdit(punch, time, reason.trim()); else await onAdd(time, reason.trim()); setEditing(false); }
    catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Não foi possível salvar o horário.'); }
    finally { setPending(false); }
  }
  if (editing) return <div className="time-editor"><form onSubmit={save}><input aria-label={`${label} em ${date}`} inputMode="numeric" autoFocus value={time} placeholder="08:31" onChange={(event) => setTime(formatClockTyping(event.target.value))} /><input aria-label={`Motivo para ${label} em ${date}`} value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} /><div><button disabled={pending}>{pending ? 'Salvando…' : 'Salvar'}</button><button type="button" className="secondary" disabled={pending} onClick={() => setEditing(false)}>Cancelar</button></div>{message && <small className="row-message">{message}</small>}</form></div>;
  const isAccepted = !punch || punch.sync_status === 'accepted';
  return <div className="timesheet-cell" onDoubleClick={() => { if (isAccepted && !disabled) start(); }}><div><span className={!punch && missing ? 'missing-slot' : ''}>{punch ? fortalezaTime(punch.timestamp) : missing ? 'Falta' : '—'}</span><button type="button" className="secondary small-button timesheet-edit" disabled={disabled || !isAccepted} onClick={start}>{punch ? 'Editar' : 'Adicionar'}</button></div>{punch && !isAccepted && <small className="row-message">Aguardando confirmação</small>}</div>;
}

function TimeCell(props: PunchEditorProps) {
  return <td className="timesheet-cell"><PunchEditor {...props} /></td>;
}

export function Timesheet({ employee, punches, days, locations, companyId, token, selectedLocationId, from, to, onSaved }: { employee: Employee | undefined; punches: Punch[]; days: WorkDay[]; locations: Location[]; companyId: string; token: string; selectedLocationId: string; from: string; to: string; onSaved: () => void }) {
  const [rows, setRows] = useState<FinancialAttendanceRow[]>([]); const [totals, setTotals] = useState<FinancialAttendanceTotals | null>(null);
  const [categories, setCategories] = useState<AbsenceCategory[]>([]); const [justifications, setJustifications] = useState<DayJustification[]>([]);
  const [message, setMessage] = useState(''); const [loading, setLoading] = useState(false); const [saving, setSaving] = useState(false); const [refresh, setRefresh] = useState(0); const [loadedQuery, setLoadedQuery] = useState(''); const [pendingRefreshAttempts, setPendingRefreshAttempts] = useState(0);
  const selectionKey = employee ? [companyId, employee.id, from, to].join('|') : '';
  const refreshFinancials = () => { setPendingRefreshAttempts(0); setRefresh((value) => value + 1); };
  const refreshPunchesAndFinancials = () => { refreshFinancials(); onSaved(); };
  // A calculation refresh belongs to the current selection.  Keep a successful
  // save confirmation visible until the person changes employee or period.
  useEffect(() => { setMessage(''); }, [selectionKey]);
  useEffect(() => {
    if (!employee) { setRows([]); setTotals(null); setCategories([]); setJustifications([]); setLoadedQuery(''); return; }
    const requestedSelection = [companyId, employee.id, from, to].join('|');
    let active = true; setLoading(true);
    const query = { company_id: companyId, employee_id: employee.id, date_from: from || undefined, date_to: to || undefined };
    void Promise.all([
      api<{ data: FinancialAttendanceRow[]; totals: FinancialAttendanceTotals }>(withQuery('/v1/financial-attendance', query), token),
      api<{ data: AbsenceCategory[] }>(withQuery('/v1/absence-categories', { company_id: companyId }), token),
      api<{ data: DayJustification[] }>(withQuery('/v1/day-justifications', query), token),
    ]).then(([financial, categoriesResult, justificationsResult]) => {
      if (!active) return; setRows(financial.data); setTotals(financial.totals); setCategories(categoriesResult.data); setJustifications(justificationsResult.data); setLoadedQuery(requestedSelection);
    }).catch((cause) => { if (active) setMessage(cause instanceof ApiError ? cause.message : 'Não foi possível carregar a apuração.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [companyId, employee?.id, from, to, token, refresh]);

  const dataReady = Boolean(selectionKey) && loadedQuery === selectionKey;
  const financialPending = dataReady && rows.some((row) => row.financialPending);
  useEffect(() => {
    if (!financialPending) { setPendingRefreshAttempts(0); return; }
    if (pendingRefreshAttempts >= 4) return;
    const timer = window.setTimeout(() => {
      setPendingRefreshAttempts((value) => value + 1);
      setRefresh((value) => value + 1);
    }, 2_500);
    return () => window.clearTimeout(timer);
  }, [financialPending, pendingRefreshAttempts]);
  const dailyRows = useMemo(() => {
    if (!dataReady || !employee) return [];
    const financialByDate = new Map(rows.map((row) => [row.date, row]));
    const dayByDate = new Map(days.filter((day) => day.employee_id === employee.id).map((day) => [day.local_date, day]));
    const punchesByDate = new Map<string, Punch[]>();
    for (const punch of punches.filter((item) => item.employee_id === employee.id)) { const date = fortalezaDate(punch.timestamp); punchesByDate.set(date, [...(punchesByDate.get(date) ?? []), punch]); }
    const classifications = new Map(days.filter((day) => day.employee_id === employee.id).flatMap((day) => currentCalculation(day)?.classifications ?? []).map((item) => [item.event_id, item.type]));
    // Every searched day remains visible even before it has a calculation or
    // a punch. This keeps the explicit "Adicionar" actions available after
    // a new search, including a day that was completely missed.
    const dates = new Set([...datesInRange(from, to), ...financialByDate.keys(), ...punchesByDate.keys()]);
    return [...dates].sort().map((date) => {
      const dayPunches = [...(punchesByDate.get(date) ?? [])].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
      const mapped: Partial<Record<Slot, Punch>> = {}; const extras: Punch[] = [];
      for (const punch of dayPunches) {
        // Corrections have their own audit id while a previous calculation can
        // still reference the original punch.  Either identifier belongs to the
        // same visible slot until the recalculation publishes its new revision.
        const originalPunchId = punch.original_time_punch_id ?? punch.original_manual_punch_id;
        const type = classifications.get(punch.id) ?? (originalPunchId ? classifications.get(originalPunchId) : undefined);
        if (type && slots.some(([slot]) => slot === type) && !mapped[type as Slot]) mapped[type as Slot] = punch;
        else extras.push(punch);
      }
      const day = dayByDate.get(date);
      const calculation = currentCalculation(day);
      const segmentCount = day?.schedule_versions?.schedule_segments?.length ?? 0;
      const expectedSlots = calculation?.state === 'final'
        ? new Set(slots.slice(0, Math.min(slots.length, segmentCount * 2)).map(([slot]) => slot)) : new Set<Slot>();
      return { date, financial: financialByDate.get(date), slots: mapped, extras, expectedSlots };
    });
  }, [dataReady, days, employee, from, punches, rows, to]);
  const justificationByDate = new Map((dataReady ? justifications : []).map((item) => [item.local_date, item]));
  const activeLocationId = selectedLocationId || employee?.home_location_id || locations.find((item) => item.active)?.id;
  async function editPunch(punch: Punch, date: string, time: string, reason: string) {
    if (punch.sync_status !== 'accepted') throw new ApiError(409, 'Aguarde a confirmação da batida antes de corrigi-la.');
    setSaving(true); setMessage('');
    const path = punch.source === 'manual'
      ? `/v1/manual-punches/${punch.original_manual_punch_id ?? punch.id}/adjustments`
      : `/v1/punches/${punch.original_time_punch_id ?? punch.id}/adjustments`;
    try { await api(path, token, { method: 'POST', body: JSON.stringify({ company_id: companyId, corrected_timestamp: `${date}T${time}:00-03:00`, reason }) }); setMessage('Horário corrigido. A apuração será atualizada.'); refreshPunchesAndFinancials(); }
    finally { setSaving(false); }
  }
  async function addPunch(date: string, time: string, reason: string) {
    if (!activeLocationId) throw new ApiError(422, 'Escolha um local antes de incluir uma batida.');
    setSaving(true); setMessage('');
    try { await api('/v1/manual-punches', token, { method: 'POST', body: JSON.stringify({ company_id: companyId, employee_id: employee?.id, location_id: activeLocationId, corrected_timestamp: `${date}T${time}:00-03:00`, reason }) }); setMessage('Batida incluída. A apuração será atualizada.'); refreshPunchesAndFinancials(); }
    finally { setSaving(false); }
  }
  if (!employee) return null;
  const combinedDateRows = dailyRows.length ? dailyRows : rows.map((financial) => ({
    date: financial.date, financial, slots: {} as Partial<Record<Slot, Punch>>, extras: [] as Punch[], expectedSlots: new Set<Slot>(),
  }));
  return <section className="panel timesheet"><div className="timesheet-heading"><div><p className="eyebrow">ESPELHO, HORAS E VALORES</p><h2>{employee.name}</h2><p>Matrícula: {employee.registration} · {from || 'Todo o período'} até {to || 'hoje'}</p></div><small>Os horários seguem a escala. Batidas fora dos horários previstos continuam editáveis, sem uma etapa extra de revisão.</small></div>
    {loading && <p className="notice">Atualizando apuração…</p>}
    {financialPending && pendingRefreshAttempts >= 4 && <p className="notice">O cálculo ainda está sendo processado. <button type="button" className="secondary small-button" onClick={refreshFinancials}>Verificar novamente</button></p>}
    {financialPending && <p className="notice" aria-live="polite">Há alterações em recálculo. Os valores desta data aparecem quando a nova jornada estiver pronta.</p>}
    <div className="timesheet-summary"><article><span>Horas trabalhadas</span><strong>{minutes(totals?.workedMinutes)}</strong></article><article className="neutral"><span>Horas abonadas</span><strong>{minutes(totals?.justifiedMinutes)}</strong></article><article className="positive"><span>Horas extras</span><strong>{minutes(totals?.overtimeMinutes)}</strong></article><article className="negative"><span>Horas faltantes</span><strong>{minutes(totals?.missingMinutes)}</strong></article><article className={((totals?.totalCents ?? 0) < 0) ? 'negative' : 'positive'}><span>Saldo financeiro</span><strong>{currency(totals?.totalCents ?? 0)}</strong></article></div>
    <DailyAdditions companyId={companyId} employeeId={employee.id} token={token} dates={combinedDateRows.map((row) => row.date)} from={from} to={to} onSaved={refreshFinancials} />
    <ReportDownloads companyId={companyId} employeeId={employee.id} from={from} to={to} token={token} />
    <div className="table-wrap"><table className="timesheet-table"><thead><tr><th>Data</th>{slots.map(([, label]) => <th key={label}>{label}</th>)}<th>Batidas extras</th><th>Trabalhado</th><th>Abonado</th><th>Extra</th><th>Falta</th><th>Saldo</th><th>Financeiro</th><th>Justificativa</th></tr></thead><tbody>{combinedDateRows.map((row) => { const financial = row.financial; const hasPaidJustification = (financial?.justifiedMinutes ?? 0) > 0; const hasAbsence = (financial?.missingMinutes ?? 0) > 0; return <tr key={row.date}><td>{dayLabel(row.date)}</td>{slots.map(([slot, label]) => <TimeCell key={slot} date={row.date} label={label} punch={row.slots[slot]} missing={!row.slots[slot] && row.expectedSlots.has(slot)} disabled={saving} onEdit={(punch, time, reason) => editPunch(punch, row.date, time, reason)} onAdd={(time, reason) => addPunch(row.date, time, reason)} />)}<td>{row.extras.length ? <div className="other-punches">{row.extras.map((punch) => <PunchEditor key={punch.id} date={row.date} label="Batida extra" punch={punch} disabled={saving} onEdit={(item, time, reason) => editPunch(item, row.date, time, reason)} onAdd={(time, reason) => addPunch(row.date, time, reason)} />)}</div> : '—'}</td><td>{minutes(financial?.workedMinutes)}</td><td className="time-neutral">{hasPaidJustification ? `Abonado · ${plainMinutes(financial?.justifiedMinutes)}` : '—'}</td><td className={financial?.overtimeMinutes ? 'time-positive' : ''}>{financial?.overtimeMinutes ? minutes(financial.overtimeMinutes) : '—'}</td><td className={hasAbsence ? 'time-negative' : ''}>{hasAbsence ? `Falta · ${plainMinutes(financial?.missingMinutes)}` : '—'}</td><td className={(financial?.balanceMinutes ?? 0) < 0 ? 'time-negative' : (financial?.balanceMinutes ?? 0) > 0 ? 'time-positive' : ''}>{minutes(financial?.balanceMinutes)}</td><td className={(financial?.financial.totalCents ?? 0) < 0 ? 'time-negative' : 'time-positive'}>{financial ? <><strong>{financial.financialPending ? 'Em processamento' : currency(financial.financial.totalCents)}</strong><small className="financial-lines">{financial.financial.lines.filter((line) => line.cents !== 0).map((line) => `${line.label}: ${currency(line.cents)}`).join(' · ') || 'Sem valores configurados'}</small></> : '—'}</td><td><JustificationControl companyId={companyId} employeeId={employee.id} date={row.date} categories={categories} value={justificationByDate.get(row.date)} token={token} onSaved={refreshFinancials} /></td></tr>; })}{!combinedDateRows.length && <tr><td colSpan={13} className="empty">Nenhum dia encontrado neste período.</td></tr>}</tbody></table></div>
    <div className="timesheet-totals"><strong>Horas trabalhadas: {minutes(totals?.workedMinutes)}</strong><strong className="time-neutral">Abonadas: {minutes(totals?.justifiedMinutes)}</strong><strong className="time-positive">Horas extras: {minutes(totals?.overtimeMinutes)}</strong><strong className="time-negative">Faltas: {minutes(totals?.missingMinutes)}</strong><strong className={(totals?.balanceMinutes ?? 0) < 0 ? 'time-negative' : 'time-positive'}>Saldo de horas: {minutes(totals?.balanceMinutes)}</strong><strong className={(totals?.totalCents ?? 0) < 0 ? 'time-negative' : 'time-positive'}>Total financeiro: {currency(totals?.totalCents ?? 0)}</strong></div>
    {message && <p className="form-message">{message}</p>}
  </section>;
}
