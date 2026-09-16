import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { createClient, type Session } from '@supabase/supabase-js';
import { api, ApiError, type BankEntry, type Employee, type EmployeeLocation, type EmployeePaymentDay, type EmployeePaymentSettings, type EmployeeRegistrationRequest, type EmployeeSchedulePlan, type FacialProfileStatus, type Location, type Me, type Occurrence, type Punch, type PunchAdjustment, type Schedule, type ScheduleAssignment as ScheduleAssignmentRecord, type Terminal, type WorkDay, withQuery } from './api.js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
const supabase = supabaseUrl && publishableKey ? createClient(supabaseUrl, publishableKey) : null;
const pendingCompanyKey = 'faceponto.pending-company';

type DashboardData = {
  days: WorkDay[]; occurrences: Occurrence[]; bank: BankEntry[]; balance: number; punches: Punch[]; adjustments: PunchAdjustment[];
  employees: Employee[]; locations: Location[]; employeeLocations: EmployeeLocation[]; registrationRequests: EmployeeRegistrationRequest[];
  facialProfiles: FacialProfileStatus[]; schedules: Schedule[]; scheduleAssignments: ScheduleAssignmentRecord[]; dailyPlans: EmployeeSchedulePlan[]; terminals: Terminal[];
};

function minutes(value: number | null | undefined) {
  if (value == null) return '—';
  const sign = value < 0 ? '−' : value > 0 ? '+' : '';
  const absolute = Math.abs(value);
  return `${sign}${Math.floor(absolute / 60)}h${String(absolute % 60).padStart(2, '0')}`;
}
function dateTime(value: string) { return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)); }
function inputDate(value: Date) { return value.toISOString().slice(0, 10); }
function localDayStart(value: string) { return new Date(`${value}T00:00:00`).toISOString(); }
function localDayAfter(value: string) { const date = new Date(`${value}T00:00:00`); date.setDate(date.getDate() + 1); return date.toISOString(); }
function currentCalculation(day: WorkDay) { return day.attendance_calculations.find((item) => item.state !== 'superseded') ?? day.attendance_calculations[0]; }
function fortalezaDate(value: string) { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Fortaleza', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value)); const part = (type: string) => parts.find((item) => item.type === type)?.value ?? ''; return `${part('year')}-${part('month')}-${part('day')}`; }
function fortalezaTime(value: string) { return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Fortaleza', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)); }
function dayLabel(value: string) { return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Fortaleza', weekday: 'short', day: '2-digit', month: '2-digit' }).format(new Date(`${value}T12:00:00-03:00`)); }

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!supabase) { setReady(true); return; }
    void supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);
  if (!ready) return <main className="centered">Carregando sessão…</main>;
  if (!supabase) return <main className="centered error">Configure as variáveis públicas do Supabase para iniciar o painel.</main>;
  const publicRegistrationCompanyId = new URLSearchParams(window.location.search).get('cadastro');
  if (publicRegistrationCompanyId && !session) return <PublicRegistration companyId={publicRegistrationCompanyId} />;
  return session ? <Dashboard session={session} onLogout={() => void supabase.auth.signOut()} /> : <Access />;
}

function PublicRegistration({ companyId }: { companyId: string }) {
  const [company, setCompany] = useState(''); const [name, setName] = useState(''); const [registration, setRegistration] = useState(''); const [contact, setContact] = useState(''); const [note, setNote] = useState('');
  const [message, setMessage] = useState(''); const [pending, setPending] = useState(false);
  useEffect(() => { void fetch(`${(import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')}/v1/public-registration/companies/${companyId}`).then(async (response) => {
    if (!response.ok) throw new Error('Link de cadastro inválido ou indisponível.'); return response.json() as Promise<{ name: string }>;
  }).then((value) => setCompany(value.name)).catch((cause) => setMessage(cause instanceof Error ? cause.message : 'Não foi possível abrir o cadastro.')); }, [companyId]);
  async function submit(event: FormEvent) {
    event.preventDefault(); setPending(true); setMessage('');
    try {
      const response = await fetch(`${(import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')}/v1/public-registration/requests`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ company_id: companyId, name, registration: registration || undefined, contact: contact || undefined, note: note || undefined }) });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body && typeof body === 'object' && 'message' in body && typeof body.message === 'string' ? body.message : 'Não foi possível enviar a solicitação.');
      setMessage('Solicitação enviada. O responsável da empresa fará a análise e orientará o próximo passo.'); setName(''); setRegistration(''); setContact(''); setNote('');
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Não foi possível enviar a solicitação.'); }
    finally { setPending(false); }
  }
  return <main className="access"><section className="access-card public-registration"><p className="eyebrow">FACEPONTO</p><h1>Solicitar cadastro</h1><p>{company ? `Envie seus dados para ${company}. O responsável concluirá seu cadastro antes da primeira marcação.` : 'Carregando empresa…'}</p><form onSubmit={submit}><label>Nome completo<input required maxLength={160} value={name} onChange={(event) => setName(event.target.value)} /></label><label>Matrícula, se já possuir<input maxLength={40} value={registration} onChange={(event) => setRegistration(event.target.value)} /></label><label>Contato para retorno<input maxLength={160} placeholder="Telefone ou e-mail" value={contact} onChange={(event) => setContact(event.target.value)} /></label><label>Observação, se necessário<textarea maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} /></label>{message && <p className="form-message">{message}</p>}<button disabled={pending || !company}>{pending ? 'Enviando…' : 'Enviar solicitação'}</button></form></section></main>;
}

function Access() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [company, setCompany] = useState(''); const [displayName, setDisplayName] = useState('');
  const [message, setMessage] = useState(''); const [pending, setPending] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setMessage(''); setPending(true);
    try {
      if (mode === 'login') {
        const { error } = await supabase!.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { data, error } = await supabase!.auth.signUp({ email, password });
        if (error) throw error;
        if (!data.session) {
          localStorage.setItem(pendingCompanyKey, JSON.stringify({ name: company, display_name: displayName }));
          setMessage('Confira o e-mail para confirmar a conta. A empresa será criada automaticamente no primeiro acesso.');
          return;
        }
        await api('/v1/companies', data.session.access_token, {
          method: 'POST', body: JSON.stringify({ name: company, display_name: displayName, timezone: 'America/Fortaleza' }),
        });
      }
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Não foi possível entrar.'); }
    finally { setPending(false); }
  }
  return <main className="access"><section className="access-card">
    <p className="eyebrow">FACEPONTO</p><h1>Painel administrativo</h1>
    <p>Consulte jornadas, ocorrências e banco de horas. Correções preservam a marcação original.</p>
    <form onSubmit={submit}>
      <label>E-mail<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label>Senha<input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      {mode === 'signup' && <><label>Empresa<input required value={company} onChange={(event) => setCompany(event.target.value)} /></label>
        <label>Seu nome<input required value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label></>}
      {message && <p className="form-message">{message}</p>}
      <button disabled={pending}>{pending ? 'Aguarde…' : mode === 'login' ? 'Entrar' : 'Criar conta e empresa'}</button>
    </form>
    <button className="link-button" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setMessage(''); }}>
      {mode === 'login' ? 'Criar a primeira conta' : 'Já tenho uma conta'}
    </button>
  </section></main>;
}

function Dashboard({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [me, setMe] = useState<Me | null>(null); const [companyId, setCompanyId] = useState('');
  const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [data, setData] = useState<DashboardData | null>(null);
  const [employeeId, setEmployeeId] = useState(''); const [locationId, setLocationId] = useState('');
  const [error, setError] = useState(''); const [loading, setLoading] = useState(true); const [refresh, setRefresh] = useState(0);
  const [registrationDraft, setRegistrationDraft] = useState<EmployeeRegistrationRequest | null>(null);
  const [accountRefresh, setAccountRefresh] = useState(0); const [bootstrapAttempted, setBootstrapAttempted] = useState(false);
  useEffect(() => { void api<Me>('/v1/me', session.access_token).then((value) => {
    setMe(value); setCompanyId((previous) => previous || value.memberships[0]?.company_id || '');
  }).catch((cause) => setError(cause instanceof Error ? cause.message : 'Não foi possível carregar a conta.')); }, [session.access_token, accountRefresh]);
  useEffect(() => {
    if (!me || me.memberships.length || bootstrapAttempted) return;
    setBootstrapAttempted(true);
    const raw = localStorage.getItem(pendingCompanyKey);
    if (!raw) return;
    try {
      const pending = JSON.parse(raw) as { name?: string; display_name?: string };
      if (!pending.name || !pending.display_name) throw new Error('Dados de empresa incompletos.');
      void api('/v1/companies', session.access_token, {
        method: 'POST', body: JSON.stringify({ ...pending, timezone: 'America/Fortaleza' }),
      }).then(() => {
        localStorage.removeItem(pendingCompanyKey);
        setAccountRefresh((value) => value + 1);
      }).catch((cause) => setError(cause instanceof Error ? cause.message : 'Não foi possível criar a empresa.'));
    } catch (cause) {
      localStorage.removeItem(pendingCompanyKey);
      setError(cause instanceof Error ? cause.message : 'Não foi possível recuperar os dados da empresa.');
    }
  }, [bootstrapAttempted, me, session.access_token]);
  useEffect(() => {
    const timer = window.setInterval(() => setRefresh((value) => value + 1), 20_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!companyId) { setLoading(false); return; }
    let active = true; setLoading(true); setError('');
    const query = { company_id: companyId, date_from: from || undefined, date_to: to || undefined };
    void Promise.all([
      api<{ data: WorkDay[] }>(withQuery('/v1/attendance', { ...query, employee_id: employeeId || undefined }), session.access_token),
      api<{ data: Occurrence[] }>(withQuery('/v1/occurrences', { company_id: companyId, employee_id: employeeId || undefined }), session.access_token),
      api<{ data: BankEntry[]; balance_minutes: number }>(withQuery('/v1/bank-hours', { ...query, employee_id: employeeId || undefined }), session.access_token),
      api<{ data: Punch[] }>(withQuery('/v1/punches', { company_id: companyId, employee_id: employeeId || undefined, location_id: locationId || undefined, punch_from: from ? localDayStart(from) : undefined, punch_to: to ? localDayAfter(to) : undefined }), session.access_token),
      api<{ data: PunchAdjustment[] }>(withQuery('/v1/punch-adjustments', { company_id: companyId, employee_id: employeeId || undefined }), session.access_token),
      api<{ data: Employee[] }>(withQuery('/v1/employees', { company_id: companyId }), session.access_token),
      api<{ data: FacialProfileStatus[] }>(withQuery('/v1/facial-profiles', { company_id: companyId }), session.access_token),
      api<{ data: EmployeeLocation[] }>(withQuery('/v1/employee-locations', { company_id: companyId }), session.access_token),
      api<{ data: EmployeeRegistrationRequest[] }>(withQuery('/v1/employee-registration-requests', { company_id: companyId }), session.access_token),
      api<{ data: Location[] }>(withQuery('/v1/locations', { company_id: companyId }), session.access_token),
      api<{ data: Schedule[] }>(withQuery('/v1/schedules', { company_id: companyId }), session.access_token),
      api<{ data: ScheduleAssignmentRecord[] }>(withQuery('/v1/schedule-assignments', { company_id: companyId }), session.access_token),
      api<{ data: EmployeeSchedulePlan[] }>(withQuery('/v1/employee-schedule-plans', { company_id: companyId }), session.access_token),
      api<{ data: Terminal[] }>(withQuery('/v1/terminals', { company_id: companyId }), session.access_token),
    ]).then(([attendance, occurrences, bank, punches, adjustments, employees, facialProfiles, employeeLocations, registrationRequests, locations, schedules, scheduleAssignments, dailyPlans, terminals]) => {
      if (active) setData({ days: attendance.data, occurrences: occurrences.data, bank: bank.data, balance: bank.balance_minutes, punches: punches.data, adjustments: adjustments.data, employees: employees.data, facialProfiles: facialProfiles.data, employeeLocations: employeeLocations.data, registrationRequests: registrationRequests.data, locations: locations.data, schedules: schedules.data, scheduleAssignments: scheduleAssignments.data, dailyPlans: dailyPlans.data, terminals: terminals.data });
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os dados.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [session.access_token, companyId, employeeId, locationId, from, to, refresh]);
  const selectedCompany = useMemo(() => me?.memberships.find((item) => item.company_id === companyId)?.companies, [companyId, me]);
  const openOccurrences = data?.occurrences.filter((item) => item.status === 'open').length ?? 0;
  function setPeriod(period: 'today' | 'week' | 'month' | 'all') {
    if (period === 'all') { setFrom(''); setTo(''); return; }
    const now = new Date(); const start = new Date(now);
    if (period === 'week') start.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    if (period === 'month') start.setDate(1);
    setFrom(inputDate(start)); setTo(inputDate(now));
  }
  if (loading && !data) return <main className="centered">Carregando painel…</main>;
  return <main className="shell"><header><div><p className="eyebrow">FACEPONTO</p><h1>{selectedCompany?.name ?? 'Painel administrativo'}</h1></div>
    <div className="header-actions"><button className="secondary" onClick={() => setRefresh((value) => value + 1)}>Atualizar</button><button className="secondary" onClick={onLogout}>Sair</button></div></header>
    {error && <p className="notice error">{error}</p>}
    {!me?.memberships.length ? <p className="notice">Esta conta ainda não possui uma empresa. Crie uma conta nova para iniciar uma empresa local.</p> : <>
      <section className="filters" aria-label="Filtros"><label>Empresa<select value={companyId} onChange={(event) => { setCompanyId(event.target.value); setEmployeeId(''); setLocationId(''); }}>{me.memberships.map((item) => <option key={item.company_id} value={item.company_id}>{item.companies?.name ?? item.company_id}</option>)}</select></label>
        <label>Funcionário<select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}><option value="">Todos</option>{(data?.employees ?? []).filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Local<select value={locationId} onChange={(event) => setLocationId(event.target.value)}><option value="">Todos</option>{(data?.locations ?? []).filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>De<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>Até<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label><div className="report-actions"><button type="button" className="secondary" onClick={() => setPeriod('today')}>Hoje</button><button type="button" className="secondary" onClick={() => setPeriod('week')}>Esta semana</button><button type="button" className="secondary" onClick={() => setPeriod('month')}>Este mês</button><button type="button" className="secondary" onClick={() => setPeriod('all')}>Limpar período</button><button type="button" onClick={() => setRefresh((value) => value + 1)}>Buscar apuração</button></div><p className="filter-help">Escolha o funcionário e o período. O mesmo filtro será usado no espelho de ponto e nos arquivos PDF e XLSX.</p></section>
      <SetupGuide companyId={companyId} locations={data?.locations ?? []} employees={data?.employees ?? []} terminals={data?.terminals ?? []} schedules={data?.schedules ?? []} />
      <section className="metrics"><Metric label="Jornadas" value={String(data?.days.length ?? 0)} /><Metric label="Ocorrências abertas" value={String(openOccurrences)} /><Metric label="Saldo no período" value={minutes(data?.balance)} /></section>
      <RecentPunches values={data?.punches ?? []} days={data?.days ?? []} />
      {employeeId && <Timesheet employee={data?.employees.find((item) => item.id === employeeId)} punches={data?.punches ?? []} days={data?.days ?? []} locations={data?.locations ?? []} companyId={companyId} token={session.access_token} selectedLocationId={locationId} from={from} to={to} onSaved={() => setRefresh((value) => value + 1)} />}
      <section className="grid"><Journeys days={data?.days ?? []} /><Occurrences values={data?.occurrences ?? []} companyId={companyId} token={session.access_token} onSaved={() => setRefresh((value) => value + 1)} /><Bank values={data?.bank ?? []} /></section>
      <RegistrationRequests values={data?.registrationRequests ?? []} companyId={companyId} token={session.access_token} onUseForRegistration={setRegistrationDraft} onSaved={() => setRefresh((value) => value + 1)} />
      <section className="grid employees-grid"><Employees values={data?.employees ?? []} facialProfiles={data?.facialProfiles ?? []} companyId={companyId} token={session.access_token} onSaved={() => setRefresh((value) => value + 1)} /><EmployeeForm companyId={companyId} locations={data?.locations ?? []} token={session.access_token} draft={registrationDraft} onDraftSaved={() => setRegistrationDraft(null)} onSaved={() => setRefresh((value) => value + 1)} /></section>
      <FacialProfileProvisioning employees={data?.employees ?? []} facialProfiles={data?.facialProfiles ?? []} companyId={companyId} token={session.access_token} onSaved={() => setRefresh((value) => value + 1)} />
      <EmployeeLocations values={data?.employeeLocations ?? []} employees={data?.employees ?? []} locations={data?.locations ?? []} companyId={companyId} token={session.access_token} onSaved={() => setRefresh((value) => value + 1)} />
      <section className="grid employees-grid"><Locations values={data?.locations ?? []} companyId={companyId} token={session.access_token} onSaved={() => setRefresh((value) => value + 1)} /><Schedules values={data?.schedules ?? []} companyId={companyId} token={session.access_token} onSaved={() => setRefresh((value) => value + 1)} /></section>
      <Terminals values={data?.terminals ?? []} locations={data?.locations ?? []} companyId={companyId} token={session.access_token} onSaved={() => setRefresh((value) => value + 1)} />
      <ScheduleAssignment companyId={companyId} employees={data?.employees ?? []} schedules={data?.schedules ?? []} token={session.access_token} onSaved={() => setRefresh((value) => value + 1)} />
      <DailySchedulePlans values={data?.dailyPlans ?? []} employees={data?.employees ?? []} schedules={data?.schedules ?? []} companyId={companyId} token={session.access_token} onSaved={() => setRefresh((value) => value + 1)} />
      <ScheduleAssignments values={data?.scheduleAssignments ?? []} employees={data?.employees ?? []} companyId={companyId} token={session.access_token} onSaved={() => setRefresh((value) => value + 1)} />
      <section className="grid employees-grid"><ManualPunchForm companyId={companyId} employees={data?.employees ?? []} locations={data?.locations ?? []} token={session.access_token} onSaved={() => setRefresh((value) => value + 1)} /><AdjustmentForm companyId={companyId} punches={data?.punches ?? []} token={session.access_token} onSaved={() => setRefresh((value) => value + 1)} /></section>
      <Adjustments values={data?.adjustments ?? []} employees={data?.employees ?? []} />
    </>}
  </main>;
}

function Metric({ label, value }: { label: string; value: string }) { return <article className="metric"><span>{label}</span><strong>{value}</strong></article>; }
function SetupGuide({ companyId, locations, employees, terminals, schedules }: { companyId: string; locations: Location[]; employees: Employee[]; terminals: Terminal[]; schedules: Schedule[] }) {
  const linkedTerminal = terminals.some((item) => item.last_heartbeat_at);
  const [copied, setCopied] = useState(false);
  const registrationLink = `${window.location.origin}${window.location.pathname}?cadastro=${companyId}`;
  const steps = [
    { ready: locations.length > 0, title: 'Cadastre o local', text: 'Ex.: matriz, galpão ou filial.' },
    { ready: employees.length > 0, title: 'Cadastre o funcionário', text: 'Informe matrícula, nome, cargo e local principal.' },
    { ready: terminals.length > 0, title: 'Cadastre o terminal', text: 'Dê um nome ao tablet ou celular que fará as marcações.' },
    { ready: linkedTerminal, title: 'Conecte o terminal', text: 'Com o app aberto no aparelho, gere o código e faça o pareamento.' },
    { ready: schedules.length > 0, title: 'Crie a escala', text: 'Defina os períodos de trabalho para classificar entrada, intervalo e saída.' },
  ];
  return <section className="setup-guide"><div><p className="eyebrow">COMECE POR AQUI</p><h2>Cadastro e conexão em cinco passos</h2><p>O funcionário não precisa de login. O responsável faz o cadastro pelo painel; o aparelho pareado reconhece e registra o ponto.</p><button className="secondary registration-link" onClick={() => void navigator.clipboard.writeText(registrationLink).then(() => setCopied(true)).catch(() => setCopied(false))}>{copied ? 'Link copiado' : 'Copiar link de solicitação'}</button><small className="registration-help">Envie esse link ao funcionário para ele solicitar o cadastro. A aprovação continua com o responsável.</small></div><ol>{steps.map((step, index) => <li key={step.title} className={step.ready ? 'done' : ''}><span>{step.ready ? '✓' : index + 1}</span><div><strong>{step.title}</strong><small>{step.ready ? 'Concluído' : step.text}</small></div></li>)}</ol></section>;
}
function ReportDownloads({ companyId, employeeId, from, to, token }: { companyId: string; employeeId: string; from: string; to: string; token: string }) {
  const [message, setMessage] = useState(''); const [pending, setPending] = useState<'xlsx' | 'pdf' | null>(null);
  async function download(format: 'xlsx' | 'pdf') {
    setPending(format); setMessage('');
    try {
      const response = await fetch(withQuery('/v1/reports/attendance', { company_id: companyId, employee_id: employeeId || undefined, date_from: from || undefined, date_to: to || undefined, format }), { headers: { authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error('Não foi possível gerar o relatório.');
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `faceponto-jornadas.${format}`; anchor.click(); URL.revokeObjectURL(url);
      setMessage(`Relatório ${format.toUpperCase()} baixado.`);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Não foi possível gerar o relatório.'); }
    finally { setPending(null); }
  }
  return <section className="report-downloads"><div><strong>Baixar esta apuração</strong><span>{employeeId ? 'Os arquivos usam exatamente o funcionário e o período exibidos abaixo.' : 'Escolha um funcionário no filtro para liberar os arquivos desta apuração.'}</span></div><div className="report-actions"><button className="secondary" disabled={pending !== null || !employeeId} onClick={() => void download('xlsx')}>{pending === 'xlsx' ? 'Gerando…' : 'Baixar XLSX'}</button><button disabled={pending !== null || !employeeId} onClick={() => void download('pdf')}>{pending === 'pdf' ? 'Gerando…' : 'Baixar PDF'}</button></div>{message && <p className="form-message">{message}</p>}</section>;
}
function Journeys({ days }: { days: WorkDay[] }) { return <section className="panel"><h2>Jornadas</h2><div className="table-wrap"><table><thead><tr><th>Data</th><th>Estado</th><th>Trabalhado</th><th>Saldo</th></tr></thead><tbody>{days.map((day) => { const result = currentCalculation(day); return <tr key={day.id}><td>{day.local_date}</td><td><span className={`pill ${result?.state ?? ''}`}>{result?.state ?? 'sem cálculo'}</span></td><td>{minutes(result?.worked_minutes)}</td><td>{minutes(result?.net_balance_minutes)}</td></tr>; })}{!days.length && <Empty colSpan={4} />}</tbody></table></div></section>; }
function Occurrences({ values, companyId, token, onSaved }: { values: Occurrence[]; companyId: string; token: string; onSaved: () => void }) { return <section className="panel"><h2>Ocorrências</h2><div className="table-wrap"><table><thead><tr><th>Tipo</th><th>Gravidade</th><th>Status</th><th>Ação</th></tr></thead><tbody>{values.slice(0, 8).map((item) => <OccurrenceRow key={item.id} occurrence={item} companyId={companyId} token={token} onSaved={onSaved} />)}{!values.length && <Empty colSpan={4} />}</tbody></table></div></section>; }
function OccurrenceRow({ occurrence, companyId, token, onSaved }: { occurrence: Occurrence; companyId: string; token: string; onSaved: () => void }) {
  const [resolution, setResolution] = useState(''); const [pending, setPending] = useState(false); const [message, setMessage] = useState('');
  async function resolve() {
    setPending(true); setMessage('');
    try { await api(`/v1/occurrences/${occurrence.id}/resolution`, token, { method: 'POST', body: JSON.stringify({ company_id: companyId, resolution }) }); setMessage('Ocorrência resolvida.'); onSaved(); }
    catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Não foi possível resolver a ocorrência.'); }
    finally { setPending(false); }
  }
  return <tr><td>{occurrence.type}</td><td><span className={`pill ${occurrence.severity}`}>{occurrence.severity}</span></td><td>{occurrence.status}</td><td>{occurrence.status === 'resolved' ? occurrence.resolution ?? 'Resolvida' : <div className="occurrence-actions"><input aria-label={`Resolução para ${occurrence.type}`} maxLength={500} placeholder="Motivo da resolução" value={resolution} onChange={(event) => setResolution(event.target.value)} /><button className="secondary small-button" disabled={pending || !resolution.trim()} onClick={() => void resolve()}>{pending ? 'Salvando…' : 'Resolver'}</button>{message && <p className="row-message">{message}</p>}</div>}</td></tr>;
}
function Bank({ values }: { values: BankEntry[] }) { return <section className="panel"><h2>Banco de horas</h2><div className="table-wrap"><table><thead><tr><th>Quando</th><th>Motivo</th><th>Saldo</th></tr></thead><tbody>{values.slice(0, 8).map((item) => <tr key={item.id}><td>{dateTime(item.created_at)}</td><td>{item.reason}</td><td>{minutes(item.delta_minutes)}</td></tr>)}{!values.length && <Empty colSpan={3} />}</tbody></table></div></section>; }
function Empty({ colSpan }: { colSpan: number }) { return <tr><td colSpan={colSpan} className="empty">Nenhum registro para este filtro.</td></tr>; }
function punchKind(value: string) { return ({ entry: 'Entrada', break_start: 'Início do intervalo', break_end: 'Fim do intervalo', exit: 'Saída', unclassified: 'Registrada' } as Record<string, string>)[value] ?? 'Registrada'; }
function RecentPunches({ values, days }: { values: Punch[]; days: WorkDay[] }) { const calculatedTypes = new Map(days.flatMap((day) => currentCalculation(day)?.classifications ?? []).map((item) => [item.event_id, item.type])); return <section className="panel recent-punches"><h2>Registros de ponto</h2><p>Mostra o funcionário, local e período selecionados acima. A jornada une as batidas da mesma pessoa, mesmo quando ocorrerem em locais diferentes.</p><div className="table-wrap"><table><thead><tr><th>Funcionário</th><th>Local</th><th>Quando</th><th>Tipo calculado</th><th>Origem</th><th>Status</th></tr></thead><tbody>{values.slice(0, 200).map((item) => <tr key={item.id}><td>{item.employee_name ?? 'Funcionário não localizado'}{item.employee_registration ? ` · ${item.employee_registration}` : ''}</td><td>{item.location_name ?? '—'}</td><td>{dateTime(item.timestamp)}</td><td>{punchKind(calculatedTypes.get(item.id) ?? item.punch_type)}</td><td>{item.source === 'manual' ? 'Inclusa pelo responsável' : 'Reconhecimento facial'}</td><td>{item.sync_status === 'accepted' ? 'Confirmada' : 'Em análise'}</td></tr>)}{!values.length && <Empty colSpan={6} />}</tbody></table></div></section>; }
function paymentInput(cents: number) { return (cents / 100).toFixed(2).replace('.', ','); }
function parsePaymentInput(value: string) { const parsed = Number(value.replace('.', '').replace(',', '.')); return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : 0; }
function PaymentSettingsForm({ employee, companyId, token }: { employee: Employee; companyId: string; token: string }) {
  const blank = { regular_hour_cents: 0, overtime_hour_cents: 0, meal_cents: 0, dinner_cents: 0, daily_allowance_cents: 0, night_shift_cents: 0, saturday_cents: 0 };
  const [settings, setSettings] = useState<EmployeePaymentSettings | null>(null); const [values, setValues] = useState(blank); const [message, setMessage] = useState(''); const [pending, setPending] = useState(false);
  useEffect(() => { let active = true; setMessage(''); void api<{ data: EmployeePaymentSettings | null }>(withQuery('/v1/payment-settings', { company_id: companyId, employee_id: employee.id }), token).then((result) => { if (!active) return; setSettings(result.data); setValues(result.data ? { regular_hour_cents: result.data.regular_hour_cents, overtime_hour_cents: result.data.overtime_hour_cents, meal_cents: result.data.meal_cents, dinner_cents: result.data.dinner_cents, daily_allowance_cents: result.data.daily_allowance_cents, night_shift_cents: result.data.night_shift_cents, saturday_cents: result.data.saturday_cents } : blank); }).catch((cause) => { if (active) setMessage(cause instanceof ApiError ? cause.message : 'Não foi possível carregar os valores.'); }); return () => { active = false; }; }, [companyId, employee.id, token]);
  const fields: Array<[keyof typeof blank, string]> = [['regular_hour_cents', 'Hora normal'], ['overtime_hour_cents', 'Hora extra'], ['meal_cents', 'Almoço'], ['dinner_cents', 'Janta'], ['daily_allowance_cents', 'Diária'], ['night_shift_cents', 'Madrugada'], ['saturday_cents', 'Sábado']];
  async function save(event: FormEvent) { event.preventDefault(); setPending(true); setMessage(''); try { const saved = await api<EmployeePaymentSettings>('/v1/payment-settings', token, { method: 'POST', body: JSON.stringify({ company_id: companyId, employee_id: employee.id, expected_version: settings?.version ?? null, ...values }) }); setSettings(saved); setValues({ regular_hour_cents: saved.regular_hour_cents, overtime_hour_cents: saved.overtime_hour_cents, meal_cents: saved.meal_cents, dinner_cents: saved.dinner_cents, daily_allowance_cents: saved.daily_allowance_cents, night_shift_cents: saved.night_shift_cents, saturday_cents: saved.saturday_cents }); setMessage('Valores de pagamento salvos para este funcionário.'); } catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Não foi possível salvar os valores.'); } finally { setPending(false); } }
  return <section className="payment-settings"><div><strong>Valores de pagamento</strong><span>Preencha manualmente os valores que valem para {employee.name}. Use R$ e vírgula, por exemplo 15,00.</span></div><form onSubmit={save}>{fields.map(([key, label]) => <label key={key}>{label}<input inputMode="decimal" aria-label={label} value={paymentInput(values[key])} onChange={(event) => setValues((current) => ({ ...current, [key]: parsePaymentInput(event.target.value) }))} /></label>)}<button disabled={pending}>{pending ? 'Salvando…' : 'Salvar valores'}</button></form>{message && <p className="form-message">{message}</p>}</section>;
}
function cents(value: number) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value / 100); }
function PaymentSummary({ employee, companyId, token, rows, from, to }: { employee: Employee; companyId: string; token: string; rows: Array<{ date: string; worked: number; overtime: number }>; from: string; to: string }) {
  const [settings, setSettings] = useState<EmployeePaymentSettings | null>(null); const [days, setDays] = useState<EmployeePaymentDay[]>([]); const [message, setMessage] = useState(''); const [pendingDate, setPendingDate] = useState('');
  async function load() { try { const [settingsResult, daysResult] = await Promise.all([api<{ data: EmployeePaymentSettings | null }>(withQuery('/v1/payment-settings', { company_id: companyId, employee_id: employee.id }), token), api<{ data: EmployeePaymentDay[] }>(withQuery('/v1/payment-days', { company_id: companyId, employee_id: employee.id, date_from: from || undefined, date_to: to || undefined }), token)]); setSettings(settingsResult.data); setDays(daysResult.data); } catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Não foi possível carregar a apuração financeira.'); } }
  useEffect(() => { void load(); }, [companyId, employee.id, from, to, token]);
  const dayByDate = new Map(days.map((item) => [item.local_date, item]));
  const total = rows.reduce((sum, row) => { const flags = dayByDate.get(row.date); const regular = Math.max(0, row.worked - row.overtime); return sum + Math.round(regular * (settings?.regular_hour_cents ?? 0) / 60) + Math.round(row.overtime * (settings?.overtime_hour_cents ?? 0) / 60) + (flags?.meal_units ?? 0) * (settings?.meal_cents ?? 0) + (flags?.dinner_units ?? 0) * (settings?.dinner_cents ?? 0) + (flags?.daily_allowance_units ?? 0) * (settings?.daily_allowance_cents ?? 0) + (flags?.night_shift_units ?? 0) * (settings?.night_shift_cents ?? 0) + (flags?.saturday_units ?? 0) * (settings?.saturday_cents ?? 0); }, 0);
  async function toggle(date: string, field: 'meal_units' | 'dinner_units' | 'daily_allowance_units' | 'night_shift_units' | 'saturday_units') { const current = dayByDate.get(date); const updated = { meal_units: current?.meal_units ?? 0, dinner_units: current?.dinner_units ?? 0, daily_allowance_units: current?.daily_allowance_units ?? 0, night_shift_units: current?.night_shift_units ?? 0, saturday_units: current?.saturday_units ?? 0, [field]: current?.[field] ? 0 : 1 }; setPendingDate(date); setMessage(''); try { await api('/v1/payment-days', token, { method: 'POST', body: JSON.stringify({ company_id: companyId, employee_id: employee.id, local_date: date, expected_version: current?.version ?? null, ...updated }) }); await load(); } catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Não foi possível salvar este adicional.'); } finally { setPendingDate(''); } }
  const columns: Array<[keyof Pick<EmployeePaymentDay, 'meal_units' | 'dinner_units' | 'daily_allowance_units' | 'night_shift_units' | 'saturday_units'>, string]> = [['meal_units', 'Almoço'], ['dinner_units', 'Janta'], ['daily_allowance_units', 'Diária'], ['night_shift_units', 'Madrugada'], ['saturday_units', 'Sábado']];
  return <section className="payment-summary"><div><strong>Apuração de pagamento</strong><span>Total previsto: <b>{cents(total)}</b></span><small>Marque apenas os adicionais pagos em cada dia. Horas normais e extras vêm das batidas acima.</small></div><div className="table-wrap"><table><thead><tr><th>Data</th><th>Horas</th><th>Extra</th>{columns.map(([, label]) => <th key={label}>{label}</th>)}</tr></thead><tbody>{rows.map((row) => { const flags = dayByDate.get(row.date); return <tr key={row.date}><td>{dayLabel(row.date)}</td><td>{minutes(row.worked)}</td><td>{minutes(row.overtime)}</td>{columns.map(([field, label]) => <td key={field}><input type="checkbox" aria-label={`${label} em ${row.date}`} checked={Boolean(flags?.[field])} disabled={Boolean(pendingDate)} onChange={() => void toggle(row.date, field)} /></td>)}</tr>; })}{!rows.length && <Empty colSpan={8} />}</tbody></table></div>{message && <p className="form-message">{message}</p>}</section>;
}
function Timesheet({ employee, punches, days, locations, companyId, token, selectedLocationId, from, to, onSaved }: { employee: Employee | undefined; punches: Punch[]; days: WorkDay[]; locations: Location[]; companyId: string; token: string; selectedLocationId: string; from: string; to: string; onSaved: () => void }) {
  const [message, setMessage] = useState(''); const [pending, setPending] = useState(false);
  const slotOrder = ['entry', 'break_start', 'break_end', 'exit'];
  const dailyRows = useMemo(() => {
    const dayByKey = new Map(days.map((day) => [day.local_date, day]));
    const punchByDay = new Map<string, Punch[]>();
    punches.forEach((punch) => { const key = fortalezaDate(punch.timestamp); punchByDay.set(key, [...(punchByDay.get(key) ?? []), punch]); });
    const keys = new Set([...dayByKey.keys(), ...punchByDay.keys()]);
    if (from && to) {
      const cursor = new Date(`${from}T12:00:00Z`); const end = new Date(`${to}T12:00:00Z`);
      while (cursor <= end) { keys.add(cursor.toISOString().slice(0, 10)); cursor.setUTCDate(cursor.getUTCDate() + 1); }
    }
    const classifications = new Map(days.flatMap((day) => currentCalculation(day)?.classifications ?? []).map((item) => [item.event_id, item.type]));
    return [...keys].sort().map((date) => {
      const slots: Record<string, Punch | undefined> = {}; const extras: Punch[] = [];
      (punchByDay.get(date) ?? []).sort((left, right) => left.timestamp.localeCompare(right.timestamp)).forEach((punch, index) => {
        const type = classifications.get(punch.id); const slot = type && slotOrder.includes(type) ? type : slotOrder[index];
        if (slot && !slots[slot]) slots[slot] = punch; else extras.push(punch);
      });
      return { date, slots, extras, calculation: currentCalculation(dayByKey.get(date) ?? { attendance_calculations: [] } as WorkDay) };
    });
  }, [days, punches, from, to]);
  const totals = dailyRows.reduce((result, row) => ({ worked: result.worked + (row.calculation?.worked_minutes ?? 0), overtime: result.overtime + (row.calculation?.gross_overtime_minutes ?? 0), balance: result.balance + (row.calculation?.net_balance_minutes ?? 0) }), { worked: 0, overtime: 0, balance: 0 });
  async function editPunch(punch: Punch, date: string, label: string) {
    if (punch.source === 'manual') { setMessage('Esta batida foi incluída manualmente. Para preservar a auditoria, registre a correção pelo formulário de correções.'); return; }
    if (punch.sync_status !== 'accepted') { setMessage('Aguarde a confirmação da batida antes de corrigi-la.'); return; }
    const time = window.prompt(`Novo horário para ${label} (${date})`, fortalezaTime(punch.timestamp));
    if (!time || !/^\d{2}:\d{2}$/.test(time)) return;
    const reason = window.prompt('Motivo da correção', 'Correção pela apuração do período');
    if (!reason?.trim()) return;
    setPending(true); setMessage('');
    try { await api(`/v1/punches/${punch.id}/adjustments`, token, { method: 'POST', body: JSON.stringify({ company_id: companyId, corrected_timestamp: `${date}T${time}:00-03:00`, reason: reason.trim() }) }); setMessage('Horário corrigido e jornada enviada para recálculo.'); onSaved(); }
    catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Não foi possível corrigir o horário.'); }
    finally { setPending(false); }
  }
  async function addPunch(date: string, label: string) {
    const time = window.prompt(`Horário de ${label} (${date})`, '08:00');
    if (!time || !/^\d{2}:\d{2}$/.test(time)) return;
    const reason = window.prompt('Motivo da inclusão', 'Batida esquecida informada na apuração do período');
    if (!reason?.trim()) return;
    const locationId = selectedLocationId || employee?.home_location_id || locations.find((item) => item.active)?.id;
    if (!locationId) { setMessage('Cadastre ou selecione um local antes de incluir uma batida.'); return; }
    setPending(true); setMessage('');
    try { await api('/v1/manual-punches', token, { method: 'POST', body: JSON.stringify({ company_id: companyId, employee_id: employee?.id, location_id: locationId, corrected_timestamp: `${date}T${time}:00-03:00`, reason: reason.trim() }) }); setMessage('Batida incluída e jornada enviada para recálculo.'); onSaved(); }
    catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Não foi possível incluir a batida.'); }
    finally { setPending(false); }
  }
  const cell = (row: typeof dailyRows[number], slot: string, label: string) => { const punch = row.slots[slot]; return <td className="timesheet-cell" title="Clique duas vezes para corrigir ou incluir" onDoubleClick={() => { if (!pending) void (punch ? editPunch(punch, row.date, label) : addPunch(row.date, label)); }}>{punch ? fortalezaTime(punch.timestamp) : '—'}</td>; };
  return <section className="panel timesheet"><div className="timesheet-heading"><div><p className="eyebrow">APURAÇÃO E RELATÓRIO DO PERÍODO</p><h2>{employee?.name ?? 'Funcionário'}</h2><p>{employee?.registration ? `Matrícula: ${employee.registration}` : 'Matrícula não informada'} · {from || 'Início não selecionado'} até {to || 'Fim não selecionado'}</p></div><small>Clique duas vezes em um horário para corrigir. Clique duas vezes em uma célula vazia para incluir uma batida esquecida.</small></div><PaymentSettingsForm employee={employee} companyId={companyId} token={token} /><PaymentSummary employee={employee} companyId={companyId} token={token} from={from} to={to} rows={dailyRows.map((row) => ({ date: row.date, worked: row.calculation?.worked_minutes ?? 0, overtime: row.calculation?.gross_overtime_minutes ?? 0 }))} /><ReportDownloads companyId={companyId} employeeId={employee?.id ?? ''} from={from} to={to} token={token} /><div className="table-wrap"><table><thead><tr><th>Data</th><th>Entrada</th><th>Saída 1</th><th>Entrada 2</th><th>Saída 2</th><th>Outras</th><th>Trabalhado</th><th>Extra</th><th>Saldo</th></tr></thead><tbody>{dailyRows.map((row) => <tr key={row.date}><td>{dayLabel(row.date)}</td>{cell(row, 'entry', 'entrada')}{cell(row, 'break_start', 'saída para intervalo')}{cell(row, 'break_end', 'retorno do intervalo')}{cell(row, 'exit', 'saída')}<td>{row.extras.map((punch) => fortalezaTime(punch.timestamp)).join(' · ') || '—'}</td><td>{minutes(row.calculation?.worked_minutes)}</td><td>{minutes(row.calculation?.gross_overtime_minutes)}</td><td>{minutes(row.calculation?.net_balance_minutes)}</td></tr>)}{!dailyRows.length && <Empty colSpan={9} />}</tbody></table></div><div className="timesheet-totals"><strong>Horas trabalhadas: {minutes(totals.worked)}</strong><strong>Horas extras: {minutes(totals.overtime)}</strong><strong>Saldo: {minutes(totals.balance)}</strong></div>{message && <p className="form-message">{message}</p>}</section>;
}
function Adjustments({ values, employees }: { values: PunchAdjustment[]; employees: Employee[] }) { const name = (id: string) => employees.find((employee) => employee.id === id)?.name ?? 'Funcionário não localizado'; return <section className="panel adjustments"><h2>Correções recentes</h2><div className="table-wrap"><table><thead><tr><th>Funcionário</th><th>Registrada</th><th>Novo horário</th><th>Motivo</th></tr></thead><tbody>{values.slice(0, 8).map((item) => <tr key={item.id}><td>{name(item.employee_id)}</td><td>{dateTime(item.created_at)}</td><td>{dateTime(item.corrected_timestamp)}</td><td>{item.reason}</td></tr>)}{!values.length && <Empty colSpan={4} />}</tbody></table></div></section>; }
function Employees({ values, facialProfiles, companyId, token, onSaved }: { values: Employee[]; facialProfiles: FacialProfileStatus[]; companyId: string; token: string; onSaved: () => void }) { const prepared = new Map(facialProfiles.map((profile) => [profile.employee_id, profile])); return <section className="panel employees"><h2>Funcionários</h2><p>Funcionários desativados permanecem visíveis para que possam ser reativados sem perder o histórico.</p><div className="table-wrap"><table><thead><tr><th>Matrícula</th><th>Nome</th><th>Cargo</th><th>Situação</th><th>Reconhecimento facial</th><th></th></tr></thead><tbody>{values.map((item) => <EmployeeRow key={item.id} employee={item} facialProfile={prepared.get(item.id)} companyId={companyId} token={token} onSaved={onSaved} />)}{!values.length && <Empty colSpan={6} />}</tbody></table></div></section>; }
function EmployeeRow({ employee, facialProfile, companyId, token, onSaved }: { employee: Employee; facialProfile: FacialProfileStatus | undefined; companyId: string; token: string; onSaved: () => void }) {
  const [pending, setPending] = useState(false); const [message, setMessage] = useState('');
  async function toggleActive() {
    setPending(true); setMessage('');
    try { await api(`/v1/employees/${employee.id}`, token, { method: 'PATCH', body: JSON.stringify({ company_id: companyId, expected_version: employee.version, active: !employee.active }) }); setMessage(employee.active ? 'Funcionário desativado.' : 'Funcionário reativado.'); onSaved(); }
    catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Não foi possível atualizar o funcionário.'); }
    finally { setPending(false); }
  }
  return <tr><td>{employee.registration}</td><td>{employee.name}</td><td>{employee.job_title || '—'}</td><td>{employee.active ? 'Ativo' : 'Desativado'}</td><td>{facialProfile ? `Perfil preparado · versão ${facialProfile.profile_version}` : 'Pendente'}</td><td><button className="secondary small-button" disabled={pending} onClick={() => void toggleActive()}>{pending ? 'Salvando…' : employee.active ? 'Desativar' : 'Reativar'}</button>{message && <p className="row-message">{message}</p>}</td></tr>;
}
function FacialProfileProvisioning({ employees, facialProfiles, companyId, token, onSaved }: { employees: Employee[]; facialProfiles: FacialProfileStatus[]; companyId: string; token: string; onSaved: () => void }) {
  const [employeeId, setEmployeeId] = useState(''); const [message, setMessage] = useState(''); const [pending, setPending] = useState(false);
  const prepared = new Map(facialProfiles.map((profile) => [profile.employee_id, profile]));
  const availableEmployees = employees.filter((item) => item.active && !prepared.has(item.id));
  useEffect(() => { if (!availableEmployees.some((item) => item.id === employeeId)) setEmployeeId(availableEmployees[0]?.id ?? ''); }, [availableEmployees, employeeId]);
  async function provision(event: FormEvent) {
    event.preventDefault(); setPending(true); setMessage('');
    try {
      const profile = await api<{ version: number }>('/v1/facial-profiles', token, { method: 'POST', body: JSON.stringify({ company_id: companyId, employee_id: employeeId }) });
      setMessage(`Perfil versão ${profile.version} preparado. O terminal atualiza o catálogo automaticamente.`); onSaved();
    } catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Não foi possível preparar o perfil.'); }
    finally { setPending(false); }
  }
  return <section className="panel facial-profile"><h2>Preparar reconhecimento facial</h2><p>Escolha apenas um funcionário pendente. Quem já tem perfil preparado não aparece para evitar novo cadastro facial por engano.</p><form onSubmit={provision} className="inline-form"><label>Funcionário<select required value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} disabled={!availableEmployees.length}>{availableEmployees.length ? availableEmployees.map((item) => <option key={item.id} value={item.id}>{item.name}</option>) : <option value="">Todos os funcionários ativos já estão preparados</option>}</select></label><button disabled={pending || !employeeId}>{pending ? 'Preparando…' : 'Preparar no terminal'}</button></form><p className="form-message">{employees.filter((employee) => employee.active && prepared.has(employee.id)).map((employee) => `${employee.name}: já preparado`).join(' · ') || 'Nenhum perfil preparado ainda.'}</p>{message && <p className="form-message">{message}</p>}</section>;
}function EmployeeLocations({ values, employees, locations, companyId, token, onSaved }: { values: EmployeeLocation[]; employees: Employee[]; locations: Location[]; companyId: string; token: string; onSaved: () => void }) {
  const [employeeId, setEmployeeId] = useState(''); const [locationId, setLocationId] = useState(''); const [date, setDate] = useState(new Date().toISOString().slice(0, 10)); const [message, setMessage] = useState(''); const [pending, setPending] = useState(false);
  const activeLocations = locations.filter((item) => item.active);
  useEffect(() => { if (!employees.some((item) => item.id === employeeId)) setEmployeeId(employees[0]?.id ?? ''); if (!activeLocations.some((item) => item.id === locationId)) setLocationId(activeLocations[0]?.id ?? ''); }, [employees, activeLocations, employeeId, locationId]);
  async function submit(event: FormEvent) {
    event.preventDefault(); setPending(true); setMessage('');
    try {
      await api('/v1/employee-locations', token, { method: 'POST', body: JSON.stringify({ company_id: companyId, employee_id: employeeId, location_id: locationId, valid_from: `${date}T00:00:00-03:00` }) });
      setMessage('Local adicional autorizado para este funcionário.'); onSaved();
    } catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Não foi possível autorizar o local.'); }
    finally { setPending(false); }
  }
  const name = (id: string) => employees.find((item) => item.id === id)?.name ?? id.slice(0, 8);
  const locationName = (id: string) => locations.find((item) => item.id === id)?.name ?? id.slice(0, 8);
  return <section className="panel employee-locations"><h2>Autorizar outros locais</h2><p>O local principal continua definido no cadastro. Os vínculos abaixo permitem registrar ponto em outros locais a partir da data informada.</p><div className="table-wrap"><table><thead><tr><th>Funcionário</th><th>Local autorizado</th><th>Válido desde</th></tr></thead><tbody>{values.map((item) => <tr key={item.id}><td>{name(item.employee_id)}</td><td>{locationName(item.location_id)}</td><td>{dateTime(item.valid_from)}</td></tr>)}{!values.length && <Empty colSpan={3} />}</tbody></table></div><form onSubmit={submit} className="inline-form employee-location-form"><label>Funcionário<select required value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}>{employees.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Local adicional<select required value={locationId} onChange={(event) => setLocationId(event.target.value)}>{activeLocations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Válido desde<input required type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><button disabled={pending || !employeeId || !locationId}>{pending ? 'Salvando…' : 'Autorizar local'}</button></form>{message && <p className="form-message">{message}</p>}</section>;
}
function EmployeeForm({ companyId, locations, token, draft, onDraftSaved, onSaved }: { companyId: string; locations: Location[]; token: string; draft: EmployeeRegistrationRequest | null; onDraftSaved: () => void; onSaved: () => void }) {
  const [registration, setRegistration] = useState(''); const [name, setName] = useState(''); const [jobTitle, setJobTitle] = useState(''); const [locationId, setLocationId] = useState('');
  const [message, setMessage] = useState(''); const [pending, setPending] = useState(false);
  const activeLocations = locations.filter((item) => item.active);
  useEffect(() => { if (!activeLocations.some((item) => item.id === locationId)) setLocationId(activeLocations[0]?.id ?? ''); }, [companyId, locations, locationId, activeLocations]);
  useEffect(() => {
    if (!draft) return;
    setRegistration(draft.registration ?? ''); setName(draft.name); setJobTitle('');
    setMessage(draft.registration ? 'Dados da solicitação preenchidos. Confira o local e conclua o cadastro.' : 'Dados da solicitação preenchidos. Informe a matrícula, confira o local e conclua o cadastro.');
    document.getElementById('employee-registration-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [draft]);
  async function submit(event: FormEvent) {
    event.preventDefault(); setPending(true); setMessage('');
    try {
      await api('/v1/employees', token, { method: 'POST', body: JSON.stringify({ company_id: companyId, registration, name, job_title: jobTitle, home_location_id: locationId }) });
      setMessage('Funcionário cadastrado.'); setRegistration(''); setName(''); setJobTitle(''); onDraftSaved(); onSaved();
    } catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Não foi possível cadastrar o funcionário.'); }
    finally { setPending(false); }
  }
  return <section id="employee-registration-form" className="panel employee-form"><h2>Cadastrar funcionário</h2><p>Selecione “Cadastrar com estes dados” em uma solicitação analisada para preencher este formulário. Depois confira a matrícula e o local principal.</p><form onSubmit={submit}><label>Matrícula<input required maxLength={40} value={registration} onChange={(event) => setRegistration(event.target.value)} /></label><label>Nome<input required maxLength={160} value={name} onChange={(event) => setName(event.target.value)} /></label><label>Cargo<input maxLength={160} value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} /></label><label>Local principal<select required value={locationId} onChange={(event) => setLocationId(event.target.value)}><option value="">Cadastre um local primeiro</option>{activeLocations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button disabled={pending || !locationId}>{pending ? 'Salvando…' : 'Cadastrar funcionário'}</button>{message && <p className="form-message">{message}</p>}</form></section>;
}
function RegistrationRequests({ values, companyId, token, onUseForRegistration, onSaved }: { values: EmployeeRegistrationRequest[]; companyId: string; token: string; onUseForRegistration: (request: EmployeeRegistrationRequest) => void; onSaved: () => void }) {
  const [pending, setPending] = useState<string | null>(null); const [message, setMessage] = useState('');
  async function review(item: EmployeeRegistrationRequest, status: 'reviewed' | 'declined') {
    setPending(item.id); setMessage('');
    try {
      await api(`/v1/employee-registration-requests/${item.id}`, token, { method: 'PATCH', body: JSON.stringify({ company_id: companyId, status }) });
      if (status === 'reviewed') { onUseForRegistration(item); setMessage('Solicitação analisada. Os dados foram levados ao formulário de cadastro.'); }
      else setMessage('Solicitação cancelada.');
      onSaved();
    } catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Não foi possível analisar a solicitação.'); }
    finally { setPending(null); }
  }
  const statusLabel = (status: EmployeeRegistrationRequest['status']) => status === 'pending' ? 'Pendente' : status === 'reviewed' ? 'Analisada' : 'Cancelada';
  return <section className="panel registration-requests"><h2>Solicitações de cadastro</h2><p>Após analisar uma solicitação, os dados continuam aqui. Use “Cadastrar com estes dados” para preencher o formulário de funcionário automaticamente. Uma solicitação enviada por engano pode ser cancelada.</p><div className="table-wrap"><table><thead><tr><th>Nome</th><th>Matrícula</th><th>Contato</th><th>Observação</th><th>Status</th><th>Recebida</th><th>Ação</th></tr></thead><tbody>{values.map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.registration || '—'}</td><td>{item.contact || '—'}</td><td>{item.note || '—'}</td><td>{statusLabel(item.status)}</td><td>{dateTime(item.created_at)}</td><td><div className="request-actions">{item.status === 'pending' ? <><button className="secondary small-button" disabled={pending === item.id} onClick={() => void review(item, 'reviewed')}>{pending === item.id ? 'Salvando…' : 'Analisar e cadastrar'}</button><button className="secondary small-button" disabled={pending === item.id} onClick={() => void review(item, 'declined')}>Cancelar solicitação</button></> : item.status === 'reviewed' ? <button className="secondary small-button" onClick={() => onUseForRegistration(item)}>Cadastrar com estes dados</button> : '—'}</div></td></tr>)}{!values.length && <Empty colSpan={7} />}</tbody></table></div>{message && <p className="form-message">{message}</p>}</section>;
}
function Locations({ values, companyId, token, onSaved }: { values: Location[]; companyId: string; token: string; onSaved: () => void }) {
  const [name, setName] = useState(''); const [message, setMessage] = useState('');
  async function submit(event: FormEvent) { event.preventDefault(); try { await api('/v1/locations', token, { method: 'POST', body: JSON.stringify({ company_id: companyId, name }) }); setName(''); setMessage('Local cadastrado.'); onSaved(); } catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Não foi possível cadastrar o local.'); } }
  return <section className="panel"><h2>Locais</h2><ul className="simple-list">{values.map((item) => <LocationRow key={item.id} location={item} companyId={companyId} token={token} onSaved={onSaved} />)}{!values.length && <li>Nenhum local cadastrado.</li>}</ul><form onSubmit={submit} className="inline-form"><label>Novo local<input required maxLength={160} value={name} onChange={(event) => setName(event.target.value)} /></label><button>Cadastrar local</button></form>{message && <p className="form-message">{message}</p>}</section>;
}
function LocationRow({ location, companyId, token, onSaved }: { location: Location; companyId: string; token: string; onSaved: () => void }) {
  const [pending, setPending] = useState(false); const [message, setMessage] = useState('');
  async function toggle() {
    setPending(true); setMessage('');
    try { await api(`/v1/locations/${location.id}`, token, { method: 'PATCH', body: JSON.stringify({ company_id: companyId, expected_version: location.version, active: !location.active }) }); setMessage(location.active ? 'Local desativado.' : 'Local ativado.'); onSaved(); }
    catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Não foi possível atualizar o local.'); }
    finally { setPending(false); }
  }
  return <li className="managed-list-row"><span>{location.name}</span><button className="secondary small-button" disabled={pending} onClick={() => void toggle()}>{location.active ? 'Desativar' : 'Ativar'}</button>{message && <small>{message}</small>}</li>;
}
function Terminals({ values, locations, companyId, token, onSaved }: { values: Terminal[]; locations: Location[]; companyId: string; token: string; onSaved: () => void }) {
  const [code, setCode] = useState(''); const [name, setName] = useState(''); const [locationId, setLocationId] = useState('');
  const [message, setMessage] = useState(''); const [pairing, setPairing] = useState<{ terminalId: string; code: string; expiresAt: number } | null>(null); const [pending, setPending] = useState(false);
  const activeLocations = locations.filter((item) => item.active);
  useEffect(() => { if (!activeLocations.some((item) => item.id === locationId)) setLocationId(activeLocations[0]?.id ?? ''); }, [locations, locationId, activeLocations]);
  async function create(event: FormEvent) {
    event.preventDefault(); setPending(true); setMessage('');
    try {
      await api('/v1/terminals', token, { method: 'POST', body: JSON.stringify({ company_id: companyId, location_id: locationId, code, name }) });
      setCode(''); setName(''); setMessage('Terminal cadastrado. Gere o código somente quando o celular estiver pronto.'); onSaved();
    } catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Não foi possível cadastrar o terminal.'); }
    finally { setPending(false); }
  }
  async function generatePairing(terminalId: string) {
    setMessage(''); setPairing(null);
    try {
      const result = await api<{ code: string; expires_in_seconds: number }>(`/v1/terminals/${terminalId}/pairing`, token, { method: 'POST' });
      setPairing({ terminalId, code: result.code, expiresAt: Date.now() + result.expires_in_seconds * 1_000 });
    } catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Não foi possível gerar o código.'); }
  }
  return <section className="panel terminals"><h2>Terminais</h2><p>Cadastre o relógio agora. O código de pareamento só deve ser gerado quando o aplicativo estiver aberto no celular, pois expira em 10 minutos.</p>
    <div className="table-wrap"><table><thead><tr><th>Código</th><th>Nome</th><th>Local</th><th>Estado</th><th>Ações</th></tr></thead><tbody>{values.map((item) => <TerminalRow key={item.id} terminal={item} locations={locations} companyId={companyId} token={token} onSaved={onSaved} onPair={() => void generatePairing(item.id)} pairing={pairing?.terminalId === item.id ? pairing : null} />)}{!values.length && <Empty colSpan={5} />}</tbody></table></div>
    <form onSubmit={create} className="inline-form terminal-form"><label>Código interno<input required maxLength={64} value={code} onChange={(event) => setCode(event.target.value)} placeholder="RELOGIO-01" /></label><label>Nome<input required maxLength={160} value={name} onChange={(event) => setName(event.target.value)} placeholder="Recepção" /></label><label>Local<select required value={locationId} onChange={(event) => setLocationId(event.target.value)}><option value="">Cadastre um local primeiro</option>{activeLocations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button disabled={pending || !locationId}>{pending ? 'Salvando…' : 'Cadastrar terminal'}</button></form>{message && <p className="form-message">{message}</p>}
  </section>;
}
function TerminalRow({ terminal, locations, companyId, token, onSaved, onPair, pairing }: { terminal: Terminal; locations: Location[]; companyId: string; token: string; onSaved: () => void; onPair: () => void; pairing: { code: string; expiresAt: number } | null }) {
  const [newLocationId, setNewLocationId] = useState(terminal.location_id); const [pending, setPending] = useState(false); const [message, setMessage] = useState('');
  const currentLocation = locations.find((location) => location.id === terminal.location_id)?.name ?? terminal.location_id.slice(0, 8);
  async function reassign() {
    if (newLocationId === terminal.location_id) return;
    setPending(true); setMessage('');
    try {
      await api(`/v1/terminals/${terminal.id}/reassign`, token, { method: 'POST', body: JSON.stringify({ company_id: companyId, new_location_id: newLocationId, expected_version: terminal.version, effective_at: new Date().toISOString() }) });
      setMessage('Terminal reassociado.'); onSaved();
    } catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Não foi possível reassociar o terminal.'); }
    finally { setPending(false); }
  }
  async function toggleActive() {
    setPending(true); setMessage('');
    try {
      await api(`/v1/terminals/${terminal.id}`, token, { method: 'PATCH', body: JSON.stringify({ company_id: companyId, expected_version: terminal.version, active: !terminal.active }) });
      setMessage(terminal.active ? 'Terminal desativado.' : 'Terminal ativado.'); onSaved();
    } catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Não foi possível atualizar o terminal.'); }
    finally { setPending(false); }
  }
  return <tr><td>{terminal.code}</td><td>{terminal.name}</td><td>{currentLocation}<select className="location-select" aria-label={`Novo local para ${terminal.name}`} value={newLocationId} onChange={(event) => setNewLocationId(event.target.value)} disabled={pending}>{locations.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button className="secondary small-button" disabled={pending || newLocationId === terminal.location_id} onClick={() => void reassign()}>Mover</button></td><td>{terminal.active ? (terminal.last_heartbeat_at ? `visto ${dateTime(terminal.last_heartbeat_at)}` : 'aguardando pareamento') : 'desativado'}</td><td><div className="terminal-actions"><button className="secondary small-button" disabled={pending || !terminal.active} onClick={onPair}>Gerar código</button><button className="secondary small-button" disabled={pending} onClick={() => void toggleActive()}>{terminal.active ? 'Desativar' : 'Ativar'}</button>{pairing && <p className="pairing-code"><strong>{pairing.code}</strong><br />Expira às {new Date(pairing.expiresAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</p>}{message && <p className="row-message">{message}</p>}</div></td></tr>;
}
function Schedules({ values, companyId, token, onSaved }: { values: Schedule[]; companyId: string; token: string; onSaved: () => void }) {
  const [name, setName] = useState(''); const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]); const [segments, setSegments] = useState([{ id: 1, start: '08:00', end: '17:00', nextDay: false }]); const [message, setMessage] = useState('');
  const toMinute = (value: string) => { const [hours = 0, minutes = 0] = value.split(':').map(Number); return hours * 60 + minutes; };
  const formatMinute = (value: number) => `${String(Math.floor((value % 1440) / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}${value >= 1440 ? ' (+1 dia)' : ''}`;
  function updateSegment(id: number, field: 'start' | 'end' | 'nextDay', value: string | boolean) { setSegments((current) => current.map((item) => item.id === id ? { ...item, [field]: value } : item)); }
  function toggleWeekday(day: number) { setWeekdays((current) => current.includes(day) ? current.filter((item) => item !== day) : [...current, day].sort((a, b) => a - b)); }
  function addSegment() { setSegments((current) => [...current, { id: Math.max(...current.map((item) => item.id)) + 1, start: '14:00', end: '18:00', nextDay: false }]); }
  function removeSegment(id: number) { setSegments((current) => current.length > 1 ? current.filter((item) => item.id !== id) : current); }
  async function submit(event: FormEvent) {
    event.preventDefault(); setMessage('');
    const payloadSegments = segments.map((item, index) => ({ ordinal: index + 1, start_minute: toMinute(item.start), end_minute: toMinute(item.end) + (item.nextDay ? 1440 : 0) }));
    if (!weekdays.length || payloadSegments.some((item) => item.end_minute <= item.start_minute)) { setMessage('Selecione ao menos um dia e informe períodos com saída posterior à entrada.'); return; }
    try { await api('/v1/schedules', token, { method: 'POST', body: JSON.stringify({ company_id: companyId, name, timezone: 'America/Fortaleza', rules: { late_tolerance_minutes: 5, overtime_tolerance_minutes: 5, missing_punch_grace_minutes: 60 }, weekdays, segments: payloadSegments }) }); setName(''); setWeekdays([1, 2, 3, 4, 5]); setSegments([{ id: 1, start: '08:00', end: '17:00', nextDay: false }]); setMessage('Escala criada.'); onSaved(); } catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Não foi possível criar a escala.'); }
  }
  const dayLabels = [{ day: 1, label: 'Seg' }, { day: 2, label: 'Ter' }, { day: 3, label: 'Qua' }, { day: 4, label: 'Qui' }, { day: 5, label: 'Sex' }, { day: 6, label: 'Sáb' }, { day: 7, label: 'Dom' }];
  return <section className="panel schedules"><h2>Escalas</h2><ul className="simple-list">{values.map((item) => <li key={item.id}><strong>{item.name}</strong>{item.schedule_versions[0] && <small>{item.schedule_versions[0].schedule_segments.map((segment) => `${formatMinute(segment.start_minute)}–${formatMinute(segment.end_minute)}`).join(' · ')}</small>}</li>)}{!values.length && <li>Nenhuma escala cadastrada.</li>}</ul><form onSubmit={submit} className="schedule-editor"><label>Nome da escala<input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Administrativo com intervalo" /></label><fieldset className="weekday-picker"><legend>Dias de trabalho</legend>{dayLabels.map(({ day, label }) => <label key={day}><input type="checkbox" checked={weekdays.includes(day)} onChange={() => toggleWeekday(day)} />{label}</label>)}</fieldset><div className="segment-editor"><strong>Períodos trabalhados</strong>{segments.map((segment, index) => <div className="segment-row" key={segment.id}><span>{index + 1}.</span><label>Entrada<input type="time" required value={segment.start} onChange={(event) => updateSegment(segment.id, 'start', event.target.value)} /></label><label>Saída<input type="time" required value={segment.end} onChange={(event) => updateSegment(segment.id, 'end', event.target.value)} /></label><label className="next-day"><input type="checkbox" checked={segment.nextDay} onChange={(event) => updateSegment(segment.id, 'nextDay', event.target.checked)} />Termina no dia seguinte</label><button type="button" className="secondary small-button" disabled={segments.length === 1} onClick={() => removeSegment(segment.id)}>Remover</button></div>)}<button type="button" className="secondary add-segment" disabled={segments.length >= 12} onClick={addSegment}>Adicionar período</button></div><button>Criar escala</button></form>{message && <p className="form-message">{message}</p>}</section>;
}
function ScheduleAssignment({ companyId, employees, schedules, token, onSaved }: { companyId: string; employees: Employee[]; schedules: Schedule[]; token: string; onSaved: () => void }) {
  const [employeeId, setEmployeeId] = useState(''); const [versionId, setVersionId] = useState(''); const [date, setDate] = useState(new Date().toISOString().slice(0, 10)); const [message, setMessage] = useState('');
  const versions = schedules.flatMap((schedule) => schedule.schedule_versions.map((version) => ({ id: version.id, label: `${schedule.name} · versão ${version.version}` })));
  useEffect(() => { if (!employees.some((item) => item.id === employeeId)) setEmployeeId(employees[0]?.id ?? ''); if (!versions.some((item) => item.id === versionId)) setVersionId(versions[0]?.id ?? ''); }, [employees, versions, employeeId, versionId]);
  async function submit(event: FormEvent) { event.preventDefault(); try { await api('/v1/schedule-assignments', token, { method: 'POST', body: JSON.stringify({ company_id: companyId, employee_id: employeeId, schedule_version_id: versionId, valid_from: `${date}T00:00:00-03:00` }) }); setMessage('Escala atribuída ao funcionário.'); onSaved(); } catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Não foi possível atribuir a escala.'); } }
  return <section className="panel assignment"><h2>Atribuir escala</h2><form onSubmit={submit} className="inline-form assignment-form"><label>Funcionário<select required value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}>{employees.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Escala<select required value={versionId} onChange={(event) => setVersionId(event.target.value)}>{versions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label>Válida desde<input required type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><button disabled={!employeeId || !versionId}>Atribuir</button></form>{message && <p className="form-message">{message}</p>}</section>;
}
function DailySchedulePlans({ values, employees, schedules, companyId, token, onSaved }: { values: EmployeeSchedulePlan[]; employees: Employee[]; schedules: Schedule[]; companyId: string; token: string; onSaved: () => void }) {
  const [employeeId, setEmployeeId] = useState(''); const [versionId, setVersionId] = useState(''); const [date, setDate] = useState(new Date().toISOString().slice(0, 10)); const [message, setMessage] = useState(''); const [pending, setPending] = useState(false);
  const versions = schedules.flatMap((schedule) => schedule.schedule_versions.map((version) => ({ id: version.id, label: `${schedule.name} · versão ${version.version}` })));
  useEffect(() => { if (!employees.some((item) => item.id === employeeId)) setEmployeeId(employees[0]?.id ?? ''); if (!versions.some((item) => item.id === versionId)) setVersionId(versions[0]?.id ?? ''); }, [employees, versions, employeeId, versionId]);
  async function submit(event: FormEvent) {
    event.preventDefault(); setPending(true); setMessage('');
    const existing = values.find((item) => item.employee_id === employeeId && item.local_date === date);
    try { await api('/v1/employee-schedule-plans', token, { method: 'POST', body: JSON.stringify({ company_id: companyId, employee_id: employeeId, local_date: date, schedule_version_id: versionId, expected_version: existing?.version }) }); setMessage(existing ? 'Programação diária atualizada.' : 'Programação diária criada.'); onSaved(); }
    catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Não foi possível salvar a programação diária.'); }
    finally { setPending(false); }
  }
  return <section className="panel daily-plans"><h2>Programação diária</h2><p>Use somente nos dias que fogem da escala padrão. Ela tem prioridade naquela data e não altera o vínculo fixo do funcionário.</p><div className="table-wrap"><table><thead><tr><th>Data</th><th>Funcionário</th><th>Escala do dia</th><th>Ação</th></tr></thead><tbody>{values.map((item) => <DailySchedulePlanRow key={item.id} plan={item} employee={employees.find((candidate) => candidate.id === item.employee_id)} companyId={companyId} token={token} onSaved={onSaved} />)}{!values.length && <Empty colSpan={4} />}</tbody></table></div><form onSubmit={submit} className="daily-plan-form"><label>Data<input required type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label>Funcionário<select required value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}>{employees.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Escala do dia<select required value={versionId} onChange={(event) => setVersionId(event.target.value)}>{versions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><button disabled={pending || !employeeId || !versionId}>{pending ? 'Salvando…' : 'Programar dia'}</button></form>{message && <p className="form-message">{message}</p>}</section>;
}
function DailySchedulePlanRow({ plan, employee, companyId, token, onSaved }: { plan: EmployeeSchedulePlan; employee: Employee | undefined; companyId: string; token: string; onSaved: () => void }) {
  const [pending, setPending] = useState(false); const [message, setMessage] = useState(''); const schedule = plan.schedule_versions?.work_schedules?.name ?? 'Escala removida';
  async function clear() {
    setPending(true); setMessage('');
    try { await api(`/v1/employee-schedule-plans/${plan.id}`, token, { method: 'DELETE', body: JSON.stringify({ company_id: companyId, expected_version: plan.version }) }); setMessage('Programação diária removida.'); onSaved(); }
    catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Não foi possível remover a programação diária.'); }
    finally { setPending(false); }
  }
  return <tr><td>{plan.local_date}</td><td>{employee?.name ?? plan.employee_id.slice(0, 8)}</td><td>{schedule} · versão {plan.schedule_versions?.version ?? '—'}</td><td><button className="secondary small-button" disabled={pending} onClick={() => void clear()}>{pending ? 'Salvando…' : 'Usar escala padrão'}</button>{message && <p className="row-message">{message}</p>}</td></tr>;
}
function ScheduleAssignments({ values, employees, companyId, token, onSaved }: { values: ScheduleAssignmentRecord[]; employees: Employee[]; companyId: string; token: string; onSaved: () => void }) {
  return <section className="panel schedule-assignments"><h2>Vínculos de escala</h2><p>Um vínculo ativo vale até ser encerrado. A nova escala deve começar depois do encerramento.</p><div className="table-wrap"><table><thead><tr><th>Funcionário</th><th>Escala</th><th>Vigência</th><th>Ação</th></tr></thead><tbody>{values.map((item) => <ScheduleAssignmentRow key={item.id} assignment={item} employee={employees.find((candidate) => candidate.id === item.employee_id)} companyId={companyId} token={token} onSaved={onSaved} />)}{!values.length && <Empty colSpan={4} />}</tbody></table></div></section>;
}
function ScheduleAssignmentRow({ assignment, employee, companyId, token, onSaved }: { assignment: ScheduleAssignmentRecord; employee: Employee | undefined; companyId: string; token: string; onSaved: () => void }) {
  const minDate = assignment.valid_from.slice(0, 10);
  const suggestedDate = new Date(`${minDate}T12:00:00`); suggestedDate.setDate(suggestedDate.getDate() + 1);
  const [validTo, setValidTo] = useState(suggestedDate.toISOString().slice(0, 10)); const [pending, setPending] = useState(false); const [message, setMessage] = useState('');
  const schedule = assignment.schedule_versions?.work_schedules?.name ?? 'Escala removida';
  async function close() {
    setPending(true); setMessage('');
    try {
      await api(`/v1/schedule-assignments/${assignment.id}/close`, token, { method: 'PATCH', body: JSON.stringify({ company_id: companyId, valid_to: `${validTo}T00:00:00-03:00` }) });
      setMessage('Vínculo encerrado.'); onSaved();
    } catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Não foi possível encerrar o vínculo.'); }
    finally { setPending(false); }
  }
  return <tr><td>{employee?.name ?? assignment.employee_id.slice(0, 8)}</td><td>{schedule} · versão {assignment.schedule_versions?.version ?? '—'}</td><td>{assignment.valid_from.slice(0, 10)}{assignment.valid_to ? ` até ${assignment.valid_to.slice(0, 10)}` : ' · ativa'}</td><td>{assignment.valid_to ? 'Encerrada' : <div className="assignment-actions"><input aria-label={`Data de encerramento de ${employee?.name ?? assignment.employee_id}`} type="date" min={minDate} value={validTo} onChange={(event) => setValidTo(event.target.value)} /><button className="secondary small-button" disabled={pending || validTo <= minDate} onClick={() => void close()}>{pending ? 'Salvando…' : 'Encerrar'}</button>{message && <p className="row-message">{message}</p>}</div>}</td></tr>;
}

function AdjustmentForm({ companyId, punches, token, onSaved }: { companyId: string; punches: Punch[]; token: string; onSaved: () => void }) {
  const [punchId, setPunchId] = useState(''); const [timestamp, setTimestamp] = useState(''); const [reason, setReason] = useState('');
  const [message, setMessage] = useState(''); const [pending, setPending] = useState(false);
  const accepted = punches.filter((item) => item.sync_status === 'accepted');
  async function submit(event: FormEvent) {
    event.preventDefault(); setPending(true); setMessage('');
    try {
      await api(`/v1/punches/${punchId}/adjustments`, token, { method: 'POST', body: JSON.stringify({ company_id: companyId, corrected_timestamp: new Date(timestamp).toISOString(), reason }) });
      setMessage('Correção registrada e jornada enviada para recálculo.'); setReason(''); onSaved();
    } catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Não foi possível registrar a correção.'); }
    finally { setPending(false); }
  }
  return <section className="panel adjustment"><h2>Corrigir batida</h2><p>A batida original não é alterada. Informe o motivo para criar uma correção auditável.</p>
    <form onSubmit={submit} className="adjustment-form"><label>Batida<select required value={punchId} onChange={(event) => setPunchId(event.target.value)}><option value="">Selecione uma batida aceita</option>{accepted.map((item) => <option key={item.id} value={item.id}>{dateTime(item.timestamp)} · {item.employee_name ?? 'Funcionário não localizado'}{item.employee_registration ? ` (${item.employee_registration})` : ''}</option>)}</select></label>
      <label>Novo horário<input required type="datetime-local" value={timestamp} onChange={(event) => setTimestamp(event.target.value)} /></label><label>Motivo<textarea required minLength={1} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      <button disabled={pending || !accepted.length}>{pending ? 'Salvando…' : 'Registrar correção'}</button>{message && <p className="form-message">{message}</p>}
    </form></section>;
}

function ManualPunchForm({ companyId, employees, locations, token, onSaved }: { companyId: string; employees: Employee[]; locations: Location[]; token: string; onSaved: () => void }) {
  const activeEmployees = employees.filter((item) => item.active); const activeLocations = locations.filter((item) => item.active);
  const [employeeId, setEmployeeId] = useState(''); const [locationId, setLocationId] = useState(''); const [timestamp, setTimestamp] = useState(''); const [reason, setReason] = useState('');
  const [message, setMessage] = useState(''); const [pending, setPending] = useState(false);
  useEffect(() => { if (!activeEmployees.some((item) => item.id === employeeId)) setEmployeeId(activeEmployees[0]?.id ?? ''); if (!activeLocations.some((item) => item.id === locationId)) setLocationId(activeLocations[0]?.id ?? ''); }, [activeEmployees, activeLocations, employeeId, locationId]);
  async function submit(event: FormEvent) {
    event.preventDefault(); setPending(true); setMessage('');
    try {
      await api('/v1/manual-punches', token, { method: 'POST', body: JSON.stringify({ company_id: companyId, employee_id: employeeId, location_id: locationId, corrected_timestamp: new Date(timestamp).toISOString(), reason }) });
      setMessage('Marcação incluída e jornada enviada para recálculo.'); setReason(''); onSaved();
    } catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Não foi possível incluir a marcação.'); }
    finally { setPending(false); }
  }
  return <section className="panel adjustment"><h2>Incluir batida esquecida</h2><p>Use quando não existe uma marcação para corrigir. A inclusão fica registrada com o motivo e recalcula a jornada.</p><form onSubmit={submit} className="adjustment-form"><label>Funcionário<select required value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}>{activeEmployees.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Local<select required value={locationId} onChange={(event) => setLocationId(event.target.value)}>{activeLocations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Data e horário<input required type="datetime-local" value={timestamp} onChange={(event) => setTimestamp(event.target.value)} /></label><label>Motivo<textarea required minLength={1} maxLength={500} placeholder="Ex.: esqueceu de registrar a entrada" value={reason} onChange={(event) => setReason(event.target.value)} /></label><button disabled={pending || !employeeId || !locationId}>{pending ? 'Salvando…' : 'Incluir marcação'}</button>{message && <p className="form-message">{message}</p>}</form></section>;
}
