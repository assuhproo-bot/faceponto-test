import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { api, ApiError, type AbsenceCategory, type CompanyPaymentSettings, type Department, type DepartmentPaymentSettings, type Employee, type EmployeePaymentSettings, type EmployeeRegistrationRequest, type FacialProfileStatus, type Location, type PaymentRateKey, type ResolvedPaymentRates, withQuery } from './api.js';

const rateFields: Array<[PaymentRateKey, string, string]> = [
  ['regular_hour_cents', 'Hora normal', 'Valor por hora trabalhada'],
  ['overtime_hour_cents', 'Hora extra', 'Valor por hora extra'],
  ['serao_cents', 'Serão', 'Valor fixo por ocorrência'],
  ['night_shift_cents', 'Madrugada', 'Valor fixo por ocorrência'],
  ['meal_cents', 'Almoço', 'Valor fixo por ocorrência'],
  ['dinner_cents', 'Janta', 'Valor fixo por ocorrência'],
  ['daily_allowance_cents', 'Diária', 'Valor fixo por ocorrência'],
  ['saturday_cents', 'Sábado', 'Valor fixo por ocorrência'],
];

type RateValues = Record<PaymentRateKey, number | null>;

function blankRates(): RateValues {
  return { regular_hour_cents: null, overtime_hour_cents: null, serao_cents: null, meal_cents: null, dinner_cents: null, daily_allowance_cents: null, night_shift_cents: null, saturday_cents: null };
}
function toRates(source: Partial<RateValues> | null | undefined): RateValues { return { ...blankRates(), ...(source ?? {}) }; }
function currency(cents: number) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100); }
function displayedMoney(cents: number | null) { return cents == null ? '' : (cents / 100).toFixed(2).replace('.', ','); }
function parsedMoney(value: string): number | null {
  const text = value.trim();
  if (!text) return null;
  const parsed = Number(text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : null;
}

function MoneyInput({ value, nullable, note, onChange }: { value: number | null; nullable: boolean; note: string; onChange: (value: number | null) => void }) {
  const [raw, setRaw] = useState(displayedMoney(value)); const [invalid, setInvalid] = useState(false); const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) { setRaw(displayedMoney(value)); setInvalid(false); } }, [value, focused]);
  function commit() {
    const cents = parsedMoney(raw);
    if (cents === null && raw.trim()) { setInvalid(true); return; }
    onChange(cents ?? (nullable ? null : 0)); setInvalid(false);
  }
  function change(next: string) {
    setRaw(next);
    const cents = parsedMoney(next);
    if (cents !== null || !next.trim()) { onChange(cents ?? (nullable ? null : 0)); setInvalid(false); }
    else setInvalid(true);
  }
  return <div className="money-input"><input inputMode="decimal" pattern={'(?:\\d+(?:[,.]\\d{0,2})?)?'} aria-invalid={invalid || undefined} value={raw} placeholder={nullable ? 'Usar regra acima' : '0,00'} onFocus={() => setFocused(true)} onChange={(event) => change(event.target.value)} onBlur={() => { commit(); setFocused(false); }} /><small className={invalid ? 'time-negative' : ''}>{invalid ? 'Use um valor como 15 ou 15,00.' : note}</small></div>;
}

function RateGrid({ values, nullable, resolved, onChange }: { values: RateValues; nullable: boolean; resolved?: ResolvedPaymentRates | null; onChange: (key: PaymentRateKey, value: number | null) => void }) {
  return <div className="rate-grid">{rateFields.map(([key, label, description]) => {
    const rate = resolved?.[key];
    const inherited = rate && rate.source !== 'none'
      ? `Usando ${rate.source === 'department' ? 'cargo' : rate.source === 'company' ? 'empresa' : 'funcionário'}: ${currency(rate.cents)}`
      : 'Sem valor definido';
    return <label key={key}><span>{label}</span><MoneyInput value={values[key]} nullable={nullable} note={nullable && values[key] == null ? inherited : description} onChange={(value) => onChange(key, value)} /></label>;
  })}</div>;
}

function CompanyRatePanel({ companyId, token }: { companyId: string; token: string }) {
  const [saved, setSaved] = useState<CompanyPaymentSettings | null>(null); const [values, setValues] = useState<RateValues>(blankRates); const [message, setMessage] = useState(''); const [pending, setPending] = useState(false); const [loading, setLoading] = useState(true);
  useEffect(() => { let alive = true; setSaved(null); setValues(blankRates()); setMessage(''); setLoading(true); void api<{ data: CompanyPaymentSettings | null }>(withQuery('/v1/company-payment-settings', { company_id: companyId }), token).then((result) => { if (alive) { setSaved(result.data); setValues(toRates(result.data)); } }).catch((cause) => { if (alive) setMessage(cause instanceof ApiError ? cause.message : 'Não foi possível carregar os valores gerais.'); }).finally(() => { if (alive) setLoading(false); }); return () => { alive = false; }; }, [companyId, token]);
  async function submit(event: FormEvent) { event.preventDefault(); if (loading) return; setPending(true); setMessage(''); try { const result = await api<CompanyPaymentSettings>('/v1/company-payment-settings', token, { method: 'POST', body: JSON.stringify({ company_id: companyId, expected_version: saved?.version ?? null, ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value ?? 0])) }) }); setSaved(result); setValues(toRates(result)); setMessage('Valores gerais salvos.'); } catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Não foi possível salvar os valores gerais.'); } finally { setPending(false); } }
  return <section className="panel payment-panel"><div className="section-heading"><div><p className="eyebrow">NÍVEL 1</p><h2>Valores gerais da empresa</h2><p>Usados quando o cargo e o funcionário não têm valor próprio.</p></div></div><form onSubmit={submit}><RateGrid values={values} nullable={false} onChange={(key, value) => setValues((current) => ({ ...current, [key]: value }))} /><button disabled={pending || loading}>{pending ? 'Salvando…' : loading ? 'Carregando…' : 'Salvar valores gerais'}</button></form>{message && <p className="form-message" aria-live="polite">{message}</p>}</section>;
}

function DepartmentRatePanel({ companyId, departments, token }: { companyId: string; departments: Department[]; token: string }) {
  const active = useMemo(() => departments.filter((item) => item.active), [departments]); const [departmentId, setDepartmentId] = useState(''); const [saved, setSaved] = useState<DepartmentPaymentSettings | null>(null); const [values, setValues] = useState<RateValues>(blankRates); const [message, setMessage] = useState(''); const [pending, setPending] = useState(false); const [loading, setLoading] = useState(true);
  useEffect(() => { if (!active.some((item) => item.id === departmentId)) setDepartmentId(active[0]?.id ?? ''); }, [active, departmentId]);
  useEffect(() => { setSaved(null); setValues(blankRates()); setMessage(''); if (!departmentId) { setLoading(false); return; } let alive = true; setLoading(true); void api<{ data: DepartmentPaymentSettings | null }>(withQuery('/v1/department-payment-settings', { company_id: companyId, department_id: departmentId }), token).then((result) => { if (alive) { setSaved(result.data); setValues(toRates(result.data)); } }).catch((cause) => { if (alive) setMessage(cause instanceof ApiError ? cause.message : 'Não foi possível carregar os valores do cargo.'); }).finally(() => { if (alive) setLoading(false); }); return () => { alive = false; }; }, [companyId, departmentId, token]);
  async function submit(event: FormEvent) { event.preventDefault(); if (!departmentId || loading) return; setPending(true); setMessage(''); try { const result = await api<DepartmentPaymentSettings>('/v1/department-payment-settings', token, { method: 'POST', body: JSON.stringify({ company_id: companyId, department_id: departmentId, expected_version: saved?.version ?? null, ...values }) }); setSaved(result); setValues(toRates(result)); setMessage('Valores do cargo salvos. Deixe vazio para usar a empresa.'); } catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Não foi possível salvar os valores do cargo.'); } finally { setPending(false); } }
  return <section className="panel payment-panel"><div className="section-heading"><div><p className="eyebrow">NÍVEL 2</p><h2>Valores por cargo</h2><p>Uma regra para todo o grupo.</p></div><label>Cargo<select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}><option value="">Nenhum cargo ativo</option>{active.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div><form onSubmit={submit}><RateGrid values={values} nullable onChange={(key, value) => setValues((current) => ({ ...current, [key]: value }))} /><button disabled={pending || loading || !departmentId}>{pending ? 'Salvando…' : loading ? 'Carregando…' : 'Salvar valores do cargo'}</button></form>{message && <p className="form-message" aria-live="polite">{message}</p>}</section>;
}

function EmployeeRatePanel({ companyId, employees, token }: { companyId: string; employees: Employee[]; token: string }) {
  const [employeeId, setEmployeeId] = useState(''); const [saved, setSaved] = useState<EmployeePaymentSettings | null>(null); const [resolved, setResolved] = useState<ResolvedPaymentRates | null>(null); const [values, setValues] = useState<RateValues>(blankRates); const [message, setMessage] = useState(''); const [pending, setPending] = useState(false); const [loading, setLoading] = useState(true);
  useEffect(() => { if (!employees.some((item) => item.id === employeeId)) setEmployeeId(employees[0]?.id ?? ''); }, [employees, employeeId]);
  useEffect(() => { setSaved(null); setValues(blankRates()); setResolved(null); setMessage(''); if (!employeeId) { setLoading(false); return; } let alive = true; setLoading(true); void Promise.all([api<{ data: EmployeePaymentSettings | null }>(withQuery('/v1/payment-settings', { company_id: companyId, employee_id: employeeId }), token), api<{ data: ResolvedPaymentRates }>(withQuery('/v1/payment-rates', { company_id: companyId, employee_id: employeeId }), token)]).then(([individual, rates]) => { if (alive) { setSaved(individual.data); setValues(toRates(individual.data)); setResolved(rates.data); } }).catch((cause) => { if (alive) setMessage(cause instanceof ApiError ? cause.message : 'Não foi possível carregar os valores do funcionário.'); }).finally(() => { if (alive) setLoading(false); }); return () => { alive = false; }; }, [companyId, employeeId, token]);
  async function submit(event: FormEvent) { event.preventDefault(); if (!employeeId || loading) return; setPending(true); setMessage(''); try { const result = await api<EmployeePaymentSettings>('/v1/payment-settings', token, { method: 'POST', body: JSON.stringify({ company_id: companyId, employee_id: employeeId, expected_version: saved?.version ?? null, ...values }) }); setSaved(result); setValues(toRates(result)); const rates = await api<{ data: ResolvedPaymentRates }>(withQuery('/v1/payment-rates', { company_id: companyId, employee_id: employeeId }), token); setResolved(rates.data); setMessage('Valores exclusivos salvos. Apague um campo para herdar somente aquele item.'); } catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Não foi possível salvar os valores do funcionário.'); } finally { setPending(false); } }
  return <section className="panel payment-panel"><div className="section-heading"><div><p className="eyebrow">NÍVEL 3</p><h2>Valores exclusivos por funcionário</h2><p>Crie exceções sem modificar os demais.</p></div><label>Funcionário<select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}><option value="">Selecione</option>{employees.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.registration}</option>)}</select></label></div><form onSubmit={submit}><RateGrid values={values} nullable resolved={resolved} onChange={(key, value) => setValues((current) => ({ ...current, [key]: value }))} /><button disabled={pending || loading || !employeeId}>{pending ? 'Salvando…' : loading ? 'Carregando…' : 'Salvar valores exclusivos'}</button></form>{message && <p className="form-message" aria-live="polite">{message}</p>}</section>;
}

export function PaymentManagement({ companyId, employees, departments, token }: { companyId: string; employees: Employee[]; departments: Department[]; token: string }) {
  return <section className="tab-page"><div className="page-intro"><p className="eyebrow">PAGAMENTOS</p><h2>Valores gerais, por cargo e por funcionário</h2><p>A apuração procura cada item nesta ordem: funcionário, cargo e empresa.</p></div><CompanyRatePanel companyId={companyId} token={token} /><DepartmentRatePanel companyId={companyId} departments={departments} token={token} /><EmployeeRatePanel companyId={companyId} employees={employees} token={token} /></section>;
}

export function DepartmentManagement({ departments, companyId, token, onSaved }: { departments: Department[]; companyId: string; token: string; onSaved: () => void }) {
  const [newName, setNewName] = useState(''); const [editing, setEditing] = useState<Department | null>(null); const [editName, setEditName] = useState(''); const [message, setMessage] = useState(''); const [pending, setPending] = useState(false);
  async function create(event: FormEvent) {
    event.preventDefault(); setPending(true); setMessage('');
    try { await api('/v1/departments', token, { method: 'POST', body: JSON.stringify({ company_id: companyId, name: newName }) }); setNewName(''); setMessage('Cargo criado.'); onSaved(); }
    catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Não foi possível criar o cargo.'); }
    finally { setPending(false); }
  }
  async function update(item: Department, changes: { name?: string; active?: boolean }) {
    setPending(true); setMessage('');
    try { await api(`/v1/departments/${item.id}`, token, { method: 'PATCH', body: JSON.stringify({ company_id: companyId, expected_version: item.version, ...changes }) }); setEditing(null); setMessage('Cargo atualizado.'); onSaved(); }
    catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Não foi possível atualizar o cargo.'); }
    finally { setPending(false); }
  }
  return <section className="panel management-list"><div className="section-heading"><div><p className="eyebrow">CADASTROS DE APOIO</p><h2>Cargos</h2><p>Cargos agrupam funcionários e permitem aplicar valores por grupo.</p></div></div><div className="table-wrap"><table><thead><tr><th>Cargo</th><th>Situação</th><th>Ações</th></tr></thead><tbody>{departments.map((item) => <tr key={item.id}><td>{editing?.id === item.id ? <input autoFocus value={editName} onChange={(event) => setEditName(event.target.value)} /> : item.name}</td><td>{item.active ? 'Ativo' : 'Desativado'}</td><td>{editing?.id === item.id ? <><button type="button" className="small-button" disabled={pending || !editName.trim()} onClick={() => void update(item, { name: editName.trim() })}>Salvar</button><button type="button" className="secondary small-button" disabled={pending} onClick={() => setEditing(null)}>Cancelar</button></> : <><button type="button" className="secondary small-button" disabled={pending} onClick={() => { setEditing(item); setEditName(item.name); }}>Editar</button><button type="button" className="secondary small-button" disabled={pending} onClick={() => void update(item, { active: !item.active })}>{item.active ? 'Desativar' : 'Reativar'}</button></>}</td></tr>)}{!departments.length && <tr><td colSpan={3} className="empty">Nenhum cargo cadastrado.</td></tr>}</tbody></table></div><form className="inline-form" onSubmit={create}><label>Novo cargo<input required maxLength={120} value={newName} onChange={(event) => setNewName(event.target.value)} /></label><button disabled={pending}>{pending ? 'Salvando…' : 'Adicionar cargo'}</button></form>{message && <p className="form-message">{message}</p>}</section>;
}

export function AbsenceCategoryManagement({ companyId, token }: { companyId: string; token: string }) {
  const [categories, setCategories] = useState<AbsenceCategory[]>([]); const [newName, setNewName] = useState(''); const [newAbones, setNewAbones] = useState(true); const [editing, setEditing] = useState<AbsenceCategory | null>(null); const [editName, setEditName] = useState(''); const [editAbones, setEditAbones] = useState(true); const [message, setMessage] = useState(''); const [pending, setPending] = useState(false);
  async function load() { const result = await api<{ data: AbsenceCategory[] }>(withQuery('/v1/absence-categories', { company_id: companyId }), token); setCategories(result.data); }
  useEffect(() => { void load().catch((cause) => setMessage(cause instanceof ApiError ? cause.message : 'Não foi possível carregar as categorias.')); }, [companyId, token]);
  async function create(event: FormEvent) {
    event.preventDefault(); setPending(true); setMessage('');
    try { await api('/v1/absence-categories', token, { method: 'POST', body: JSON.stringify({ company_id: companyId, name: newName, abones_hours: newAbones }) }); setNewName(''); setNewAbones(true); await load(); setMessage('Categoria criada.'); }
    catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Não foi possível criar a categoria.'); }
    finally { setPending(false); }
  }
  async function update(item: AbsenceCategory, changes: { name?: string; abones_hours?: boolean; active?: boolean }) {
    setPending(true); setMessage('');
    try { await api(`/v1/absence-categories/${item.id}`, token, { method: 'PATCH', body: JSON.stringify({ company_id: companyId, expected_version: item.version, ...changes }) }); setEditing(null); await load(); setMessage('Categoria atualizada. A alteração vale para novas justificativas.'); }
    catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Não foi possível atualizar a categoria.'); }
    finally { setPending(false); }
  }
  async function remove(item: AbsenceCategory) {
    setPending(true); setMessage('');
    try { await api(`/v1/absence-categories/${item.id}`, token, { method: 'DELETE', body: JSON.stringify({ company_id: companyId, expected_version: item.version }) }); await load(); setMessage('Categoria removida.'); }
    catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Esta categoria está em uso. Desative-a para preservar o histórico.'); }
    finally { setPending(false); }
  }
  return <section className="panel management-list"><div className="section-heading"><div><p className="eyebrow">CONFIGURAÇÕES</p><h2>Categorias de justificativa</h2><p>Defina se a categoria abona horas. As usadas ficam no histórico e podem ser desativadas.</p></div></div><div className="table-wrap"><table><thead><tr><th>Categoria</th><th>Horas</th><th>Situação</th><th>Ações</th></tr></thead><tbody>{categories.map((item) => <tr key={item.id}><td>{editing?.id === item.id ? <input autoFocus value={editName} onChange={(event) => setEditName(event.target.value)} /> : item.name}</td><td>{editing?.id === item.id ? <label className="checkbox-label"><input type="checkbox" checked={editAbones} onChange={(event) => setEditAbones(event.target.checked)} />Abona horas</label> : item.abones_hours ? 'Abona horas' : 'Não abona'}</td><td>{item.active ? 'Ativa' : 'Desativada'}</td><td>{editing?.id === item.id ? <><button type="button" className="small-button" disabled={pending || !editName.trim()} onClick={() => void update(item, { name: editName.trim(), abones_hours: editAbones })}>Salvar</button><button type="button" className="secondary small-button" disabled={pending} onClick={() => setEditing(null)}>Cancelar</button></> : <><button type="button" className="secondary small-button" disabled={pending} onClick={() => { setEditing(item); setEditName(item.name); setEditAbones(item.abones_hours); }}>Editar</button><button type="button" className="secondary small-button" disabled={pending} onClick={() => void update(item, { active: !item.active })}>{item.active ? 'Desativar' : 'Reativar'}</button><button type="button" className="secondary small-button" disabled={pending} onClick={() => void remove(item)}>Remover</button></>}</td></tr>)}{!categories.length && <tr><td colSpan={4} className="empty">Nenhuma categoria cadastrada.</td></tr>}</tbody></table></div><form className="category-form" onSubmit={create}><label>Nova categoria<input required maxLength={120} value={newName} onChange={(event) => setNewName(event.target.value)} /></label><label className="checkbox-label"><input type="checkbox" checked={newAbones} onChange={(event) => setNewAbones(event.target.checked)} />Abona horas previstas</label><button disabled={pending}>{pending ? 'Salvando…' : 'Adicionar categoria'}</button></form>{message && <p className="form-message">{message}</p>}</section>;
}

export function EmployeeManagement({ values, departments, facialProfiles, locations, companyId, token, draft, onDraftSaved, onSaved }: { values: Employee[]; departments: Department[]; facialProfiles: FacialProfileStatus[]; locations: Location[]; companyId: string; token: string; draft: EmployeeRegistrationRequest | null; onDraftSaved: () => void; onSaved: () => void }) {
  const [editing, setEditing] = useState<Employee | null>(null); const [registration, setRegistration] = useState(''); const [name, setName] = useState(''); const [jobTitle, setJobTitle] = useState(''); const [departmentId, setDepartmentId] = useState(''); const [locationId, setLocationId] = useState(''); const [active, setActive] = useState(true); const [message, setMessage] = useState(''); const [pending, setPending] = useState(false);
  const activeLocations = useMemo(() => locations.filter((item) => item.active), [locations]); const faceByEmployee = useMemo(() => new Map(facialProfiles.map((item) => [item.employee_id, item])), [facialProfiles]);
  const selectableDepartments = useMemo(() => departments.filter((item) => item.active || item.id === departmentId), [departments, departmentId]);
  const departmentName = (id: string | null) => departments.find((item) => item.id === id)?.name ?? 'Sem cargo';
  const locationName = (id: string) => locations.find((item) => item.id === id)?.name ?? '—';
  function reset() { setEditing(null); setRegistration(''); setName(''); setJobTitle(''); setDepartmentId(''); setLocationId(''); setActive(true); }
  useEffect(() => { if (locationId && !activeLocations.some((item) => item.id === locationId)) setLocationId(''); }, [activeLocations, locationId]);
  useEffect(() => {
    if (!draft || editing) return;
    setRegistration(draft.registration ?? ''); setName(draft.name); setJobTitle(''); setDepartmentId('');
    setMessage('Dados da solicitação preenchidos. Confira e conclua o cadastro.');
    document.getElementById('employee-management-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [draft, editing]);
  function edit(item: Employee) {
    setEditing(item); setRegistration(item.registration); setName(item.name); setJobTitle(item.job_title); setDepartmentId(item.department_id ?? ''); setLocationId(item.home_location_id); setActive(item.active); setMessage('');
    document.getElementById('employee-management-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setPending(true); setMessage('');
    try {
      if (editing) {
        await api(`/v1/employees/${editing.id}`, token, { method: 'PATCH', body: JSON.stringify({ company_id: companyId, expected_version: editing.version, registration, name, job_title: jobTitle, department_id: departmentId || null, home_location_id: locationId, active }) });
        setMessage('Funcionário atualizado sem alterar batidas, escala ou perfil facial.');
      } else {
        const saved = await api<Employee>('/v1/employees', token, { method: 'POST', body: JSON.stringify({ company_id: companyId, registration: registration || undefined, name, job_title: jobTitle, department_id: departmentId || null, home_location_id: locationId }) });
        setMessage(`Funcionário cadastrado com matrícula ${saved.registration}.`);
      }
      reset(); onDraftSaved(); onSaved();
    } catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Não foi possível salvar o funcionário.'); }
    finally { setPending(false); }
  }
  return <section className="employee-management"><section className="panel employees"><div className="section-heading"><div><p className="eyebrow">FUNCIONÁRIOS</p><h2>Cadastro e situação</h2><p>Todos continuam visíveis para edição ou reativação, sem perder o histórico.</p></div></div><div className="table-wrap"><table><thead><tr><th>Matrícula</th><th>Nome</th><th>Cargo</th><th>Local principal</th><th>Situação</th><th>Facial</th><th></th></tr></thead><tbody>{values.map((item) => <tr key={item.id}><td>{item.registration}</td><td>{item.name}{item.job_title && <small>{item.job_title}</small>}</td><td>{departmentName(item.department_id)}</td><td>{locationName(item.home_location_id)}</td><td>{item.active ? 'Ativo' : 'Desativado'}</td><td>{faceByEmployee.has(item.id) ? 'Preparado' : 'Pendente'}</td><td><button type="button" className="secondary small-button" onClick={() => edit(item)}>Editar</button></td></tr>)}{!values.length && <tr><td colSpan={7} className="empty">Nenhum funcionário cadastrado.</td></tr>}</tbody></table></div></section><section id="employee-management-form" className="panel employee-form"><div className="section-heading"><div><p className="eyebrow">{editing ? 'EDIÇÃO' : 'NOVO CADASTRO'}</p><h2>{editing ? `Editar ${editing.name}` : 'Cadastrar funcionário'}</h2><p>{editing ? 'Alterar dados não muda a facial, as batidas ou a escala.' : 'Deixe a matrícula vazia para ela ser criada automaticamente.'}</p></div>{editing && <button type="button" className="secondary" onClick={reset}>Novo cadastro</button>}</div><form onSubmit={submit}><label>Matrícula<input maxLength={40} required={Boolean(editing)} placeholder="Gerada automaticamente" value={registration} onChange={(event) => setRegistration(event.target.value)} /></label><label>Nome<input required maxLength={160} value={name} onChange={(event) => setName(event.target.value)} /></label><label>Cargo<select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}><option value="">Sem cargo</option>{selectableDepartments.map((item) => <option key={item.id} value={item.id}>{item.name}{item.active ? '' : ' · desativado'}</option>)}</select></label><label>Descrição complementar<input maxLength={160} placeholder="Ex.: conferente" value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} /></label><label>Local principal<select required value={locationId} onChange={(event) => setLocationId(event.target.value)}><option value="">Cadastre um local primeiro</option>{activeLocations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{editing && <label className="checkbox-label"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />Funcionário ativo</label>}<button disabled={pending || !locationId}>{pending ? 'Salvando…' : editing ? 'Salvar alterações' : 'Cadastrar funcionário'}</button>{message && <p className="form-message" aria-live="polite">{message}</p>}</form></section></section>;
}
