import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const MANAGEMENT_FEE_RATE = 0.05; // 5% decurtato dall'utile lordo

// Solo questo account GitHub può accedere (stessa regola di Controlli Industriali,
// applicata qui anche lato client per un messaggio chiaro; la vera protezione
// resta comunque la RLS sul database).
const AUTHORIZED_GITHUB_USERNAME = 'P1pp89';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let localProjectsState = [];

const fmtCurr = (val) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(val);
const fmtPct = (val) => new Intl.NumberFormat('it-IT', { style: 'percent', minimumFractionDigits: 2 }).format(val / 100);

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]));
}

function closeProjectModal() {
  document.getElementById('project-modal').classList.add('hidden');
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-login-github').addEventListener('click', async () => {
    // Usiamo origin+pathname "puliti" (senza query o hash residui) come redirect,
    // altrimenti eventuali frammenti di un tentativo precedente si accumulano
    // nell'URL di ritorno e Supabase scarta tutto come "bad_oauth_state".
    const cleanRedirect = window.location.origin + window.location.pathname;
    await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo: cleanRedirect }
    });
  });

  document.getElementById('btn-logout').addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.reload();
  });

  document.getElementById('btn-refresh').addEventListener('click', loadDashboardData);
  document.getElementById('btn-print').addEventListener('click', () => window.print());
  document.getElementById('btn-add-project').addEventListener('click', () => openProjectModal(-1));
  document.getElementById('btn-close-modal').addEventListener('click', closeProjectModal);
  document.getElementById('btn-cancel-modal').addEventListener('click', closeProjectModal);
  document.getElementById('project-form').addEventListener('submit', handleFormSubmit);

  document.getElementById('btn-open-calculator').addEventListener('click', openCalculator);
  document.getElementById('btn-close-calculator').addEventListener('click', closeCalculator);
  initCalculator();

  // Gestisce sia la sessione già attiva sia il redirect di ritorno da GitHub
  supabase.auth.onAuthStateChange((_event, session) => {
    if (session) {
      showAppForUser(session);
    } else {
      showLoginScreen();
    }
  });

  supabase.auth.getSession().then(({ data: { session } }) => {
    if (session) showAppForUser(session);
  });
});

function showLoginScreen() {
  document.getElementById('auth-modal').classList.remove('hidden');
  document.getElementById('btn-logout').classList.add('hidden');
  document.getElementById('btn-add-project').classList.add('hidden');
  document.getElementById('btn-open-calculator').classList.add('hidden');
  document.getElementById('user-badge').classList.add('hidden');
}

function showAppForUser(session) {
  // Ripulisce l'URL da eventuali token/parametri OAuth residui dopo il login,
  // così un refresh della pagina non tenta di rileggere un fragment scaduto.
  if (window.location.hash || window.location.search) {
    window.history.replaceState({}, document.title, window.location.origin + window.location.pathname);
  }

  const username = session.user.user_metadata?.user_name || session.user.email;

  if (!username || username.toLowerCase() !== AUTHORIZED_GITHUB_USERNAME.toLowerCase()) {
    // Autenticato con GitHub, ma non è l'account autorizzato: nega e disconnetti subito
    const authError = document.getElementById('auth-error');
    authError.textContent = `Accesso negato. Solo l'account GitHub "${AUTHORIZED_GITHUB_USERNAME}" è autorizzato. Sei autenticato come: "${username || 'sconosciuto'}"`;
    authError.classList.remove('hidden');
    supabase.auth.signOut();
    return;
  }

  document.getElementById('auth-modal').classList.add('hidden');
  document.getElementById('btn-logout').classList.remove('hidden');
  document.getElementById('btn-add-project').classList.remove('hidden');
  document.getElementById('btn-open-calculator').classList.remove('hidden');
  const badge = document.getElementById('user-badge');
  badge.textContent = `@${username}`;
  badge.classList.remove('hidden');

  loadDashboardData();
}

async function loadDashboardData() {
  const authError = document.getElementById('auth-error');
  authError.classList.add('hidden');

  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .order('id', { ascending: true });

  if (error) {
    // Se l'utente loggato non è nella allowlist "team_members", la RLS
    // restituisce semplicemente 0 righe invece di un errore: gestiamo comunque
    // eventuali errori di rete/config qui.
    handleApiError(error, 'lettura');
    return false;
  }

  localProjectsState = (data || []).map(row => ({
    id: row.id,
    name: row.name,
    budget_authorized: Number(row.budget_authorized),
    discount_applied: Number(row.discount_applied),
    costs: {
      materials: Number(row.cost_materials),
      labor: Number(row.cost_labor),
      rentals: Number(row.cost_rentals)
    }
  }));

  renderDashboard(localProjectsState);
  return true;
}

async function saveProjectToSupabase(project) {
  const { data: { user } } = await supabase.auth.getUser();

  const { error } = await supabase.from('projects').upsert({
    id: project.id,
    name: project.name,
    budget_authorized: project.budget_authorized,
    discount_applied: project.discount_applied,
    cost_materials: project.costs.materials,
    cost_labor: project.costs.labor,
    cost_rentals: project.costs.rentals,
    last_updated: new Date().toISOString(),
    updated_by: user?.id
  });

  if (error) {
    handleApiError(error, 'salvataggio');
    return false;
  }
  return true;
}

async function deleteProjectFromSupabase(id) {
  const { error } = await supabase.from('projects').delete().eq('id', id);

  if (error) {
    handleApiError(error, 'eliminazione');
    return false;
  }
  return true;
}

async function handleDeleteProject(index) {
  const idx = parseInt(index, 10);
  const project = localProjectsState[idx];
  if (!project) return;

  const confirmed = window.confirm(`Eliminare definitivamente la commessa "${project.id} — ${project.name}"?\n\nQuesta azione non può essere annullata.`);
  if (!confirmed) return;

  const success = await deleteProjectFromSupabase(project.id);
  if (success) {
    await loadDashboardData();
  }
}

async function handleFormSubmit(e) {
  e.preventDefault();

  const index = parseInt(document.getElementById('form-project-index').value, 10);
  const btnSave = document.getElementById('btn-save-project');

  btnSave.disabled = true;
  btnSave.textContent = 'Salvataggio...';

  const updatedProject = {
    id: document.getElementById('form-id').value.trim(),
    name: document.getElementById('form-name').value.trim(),
    budget_authorized: parseFloat(document.getElementById('form-budget').value) || 0,
    discount_applied: parseFloat(document.getElementById('form-discount').value) || 0,
    costs: {
      materials: parseFloat(document.getElementById('form-cost-materials').value) || 0,
      labor: parseFloat(document.getElementById('form-cost-labor').value) || 0,
      rentals: parseFloat(document.getElementById('form-cost-rentals').value) || 0
    }
  };

  const success = await saveProjectToSupabase(updatedProject);

  btnSave.disabled = false;
  btnSave.textContent = 'Salva Commessa';

  if (success) {
    closeProjectModal();
    await loadDashboardData();
  }
}

function handleApiError(err, context) {
  console.error(`Errore [${context}]:`, err);
  const authError = document.getElementById('auth-error');
  if (err.message && err.message.toLowerCase().includes('jwt')) {
    supabase.auth.signOut();
    window.location.reload();
    return;
  }
  authError.textContent = `Errore: ${err.message || 'operazione non riuscita'}. Verifica di essere autorizzato ad accedere a questa dashboard.`;
  authError.classList.remove('hidden');
  alert(`Errore: ${err.message || 'operazione non riuscita'}`);
}

function renderDashboard(projects) {
  const tbody = document.getElementById('projects-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  let totalAuthorizedNet = 0, totalActualCost = 0, totalNetProfit = 0;

  projects.forEach((p, idx) => {
    const netBudget = (Number(p.budget_authorized) || 0) * (1 - (Number(p.discount_applied) || 0) / 100);

    const directCost = (Number(p.costs?.materials) || 0) + (Number(p.costs?.labor) || 0) + (Number(p.costs?.rentals) || 0);

    const grossProfit = netBudget - directCost;

    const managementFee = grossProfit > 0 ? (grossProfit * MANAGEMENT_FEE_RATE) : 0;
    const netProfit = grossProfit - managementFee;

    const profitPercent = netBudget > 0 ? (netProfit / netBudget) * 100 : 0;

    totalAuthorizedNet += netBudget;
    totalActualCost += directCost;
    totalNetProfit += netProfit;

    let badgeColor = profitPercent < 10 ? 'text-rose-400 bg-rose-950/40 border-rose-800' :
                     profitPercent < 25 ? 'text-amber-400 bg-amber-950/40 border-amber-800' :
                     'text-emerald-400 bg-emerald-950/40 border-emerald-800';

    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-800/30 transition border-b border-slate-800/50';
    tr.innerHTML = `
      <td class="px-4 py-3 font-mono text-xs text-slate-400">${escapeHtml(p.id)}</td>
      <td class="px-4 py-3 font-medium text-slate-100">${escapeHtml(p.name)}</td>
      <td class="px-4 py-3 text-right font-mono">${fmtCurr(netBudget)}</td>
      <td class="px-4 py-3 text-right font-mono text-slate-400">${fmtCurr(p.costs?.materials || 0)}</td>
      <td class="px-4 py-3 text-right font-mono text-slate-400">${fmtCurr(p.costs?.labor || 0)}</td>
      <td class="px-4 py-3 text-right font-mono text-slate-400">${fmtCurr(p.costs?.rentals || 0)}</td>
      <td class="px-4 py-3 text-right font-mono text-amber-300 font-semibold">${fmtCurr(directCost)}</td>
      <td class="px-4 py-3 text-right font-mono text-emerald-400 font-semibold">${fmtCurr(netProfit)}</td>
      <td class="px-4 py-3 text-right font-mono"><span class="px-2 py-0.5 rounded-full text-xs font-semibold border ${badgeColor}">${fmtPct(profitPercent)}</span></td>
      <td class="px-4 py-3 text-center whitespace-nowrap">
        <button class="btn-edit text-xs text-emerald-400 hover:text-emerald-300 font-semibold px-2 py-1 rounded border border-emerald-900 bg-emerald-950/30" data-index="${idx}">Edit</button>
        <button class="btn-delete text-xs text-rose-400 hover:text-rose-300 font-semibold px-2 py-1 rounded border border-rose-900 bg-rose-950/30 ml-1.5" data-index="${idx}">Elimina</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  document.querySelectorAll('.btn-edit').forEach(b => b.addEventListener('click', e => openProjectModal(e.target.dataset.index)));
  document.querySelectorAll('.btn-delete').forEach(b => b.addEventListener('click', e => handleDeleteProject(e.target.dataset.index)));

  const totalProfitPercent = totalAuthorizedNet > 0 ? (totalNetProfit / totalAuthorizedNet) * 100 : 0;

  document.getElementById('metric-authorized').textContent = fmtCurr(totalAuthorizedNet);
  document.getElementById('metric-actual').textContent = fmtCurr(totalActualCost);
  document.getElementById('metric-profit-nominal').textContent = fmtCurr(totalNetProfit);
  document.getElementById('metric-profit-pct').textContent = fmtPct(totalProfitPercent);
}

function openProjectModal(index) {
  const p = index >= 0 ? localProjectsState[index] : null;
  document.getElementById('modal-title').textContent = p ? `Modifica: ${p.id}` : 'Nuova Commessa';
  document.getElementById('form-project-index').value = index;
  document.getElementById('form-id').value = p ? p.id : '';
  document.getElementById('form-name').value = p ? p.name : '';
  document.getElementById('form-budget').value = p ? p.budget_authorized : '';
  document.getElementById('form-discount').value = p ? (p.discount_applied || 0) : 0;
  document.getElementById('form-cost-materials').value = p ? (p.costs?.materials || 0) : 0;
  document.getElementById('form-cost-labor').value = p ? (p.costs?.labor || 0) : 0;
  document.getElementById('form-cost-rentals').value = p ? (p.costs?.rentals || 0) : 0;
  document.getElementById('project-modal').classList.remove('hidden');
}

// ---------------------------------------------------------------------
// Calcolatrice Scientifica
// ---------------------------------------------------------------------

let calcExpression = '';
let calcAngleMode = 'deg'; // 'deg' | 'rad'

function openCalculator() {
  document.getElementById('calculator-modal').classList.remove('hidden');
}

function closeCalculator() {
  document.getElementById('calculator-modal').classList.add('hidden');
}

function calcUpdateDisplay(text) {
  const display = document.getElementById('calc-display');
  display.textContent = text === '' ? '0' : text;
  // Tiene visibile la parte finale dell'espressione mentre si scrive/scorre
  display.scrollTop = display.scrollHeight;
}

function calcSetAngleMode(mode) {
  calcAngleMode = mode;
  const degBtn = document.getElementById('calc-mode-deg');
  const radBtn = document.getElementById('calc-mode-rad');
  const active = 'bg-emerald-600 text-white';
  const inactive = 'bg-slate-700 text-slate-300';
  degBtn.className = `calc-mode-btn text-[10px] uppercase tracking-wider py-1 rounded font-semibold ${mode === 'deg' ? active : inactive}`;
  radBtn.className = `calc-mode-btn text-[10px] uppercase tracking-wider py-1 rounded font-semibold ${mode === 'rad' ? active : inactive}`;
}

// Traduce l'espressione mostrata all'utente (es. "sin(30)", "2^3", "%")
// in un'espressione JS valutabile solo con le funzioni matematiche consentite.
function calcToEvaluable(expr) {
  let out = expr
    .replace(/\^/g, '**')
    .replace(/%/g, '/100')
    .replace(/pi/g, 'PI')
    .replace(/\be\b/g, 'E');

  // sin/cos/tan lavorano in gradi se calcAngleMode === 'deg'
  if (calcAngleMode === 'deg') {
    out = out.replace(/sin\(/g, 'sinDeg(')
             .replace(/cos\(/g, 'cosDeg(')
             .replace(/tan\(/g, 'tanDeg(');
  } else {
    out = out.replace(/sin\(/g, 'sin(')
             .replace(/cos\(/g, 'cos(')
             .replace(/tan\(/g, 'tan(');
  }
  out = out.replace(/log\(/g, 'log10(').replace(/ln\(/g, 'log(');
  return out;
}

function calcEvaluate() {
  if (!calcExpression) return;
  try {
    const evaluable = calcToEvaluable(calcExpression);
    // Whitelist rigorosa: solo cifre, operatori matematici e nomi di funzione consentiti.
    if (/[^0-9+\-*/().\s,a-zA-Z]/.test(evaluable)) throw new Error('invalid characters');

    const scope = {
      PI: Math.PI,
      E: Math.E,
      sqrt: Math.sqrt,
      log10: Math.log10,
      log: Math.log,
      sinDeg: (d) => Math.sin(d * Math.PI / 180),
      cosDeg: (d) => Math.cos(d * Math.PI / 180),
      tanDeg: (d) => Math.tan(d * Math.PI / 180),
      sin: Math.sin,
      cos: Math.cos,
      tan: Math.tan
    };
    const argNames = Object.keys(scope);
    const argValues = argNames.map(k => scope[k]);
    // eslint-disable-next-line no-new-func
    const fn = new Function(...argNames, `"use strict"; return (${evaluable});`);
    const result = fn(...argValues);

    if (typeof result !== 'number' || !isFinite(result)) throw new Error('math error');

    const rounded = Math.round(result * 1e10) / 1e10;
    document.getElementById('calc-history').textContent = calcExpression + ' =';
    calcExpression = String(rounded);
    calcUpdateDisplay(calcExpression);
  } catch (err) {
    document.getElementById('calc-history').textContent = '';
    calcExpression = '';
    calcUpdateDisplay('Errore');
  }
}

function calcAppend(str) {
  calcExpression += str;
  calcUpdateDisplay(calcExpression);
}

function calcClear() {
  calcExpression = '';
  document.getElementById('calc-history').textContent = '';
  calcUpdateDisplay('');
}

function calcBackspace() {
  calcExpression = calcExpression.slice(0, -1);
  calcUpdateDisplay(calcExpression);
}

function initCalculator() {
  calcSetAngleMode('deg');

  document.getElementById('calc-mode-deg').addEventListener('click', () => calcSetAngleMode('deg'));
  document.getElementById('calc-mode-rad').addEventListener('click', () => calcSetAngleMode('rad'));

  document.querySelectorAll('[data-calc-val]').forEach(btn => {
    btn.addEventListener('click', () => calcAppend(btn.dataset.calcVal));
  });

  document.querySelectorAll('[data-calc-fn]').forEach(btn => {
    btn.addEventListener('click', () => calcAppend(btn.dataset.calcFn));
  });

  document.getElementById('calc-clear').addEventListener('click', calcClear);
  document.getElementById('calc-backspace').addEventListener('click', calcBackspace);
  document.getElementById('calc-equals').addEventListener('click', calcEvaluate);

  // Supporto tastiera fisica, attivo solo mentre la calcolatrice è aperta.
  document.addEventListener('keydown', (e) => {
    const modal = document.getElementById('calculator-modal');
    if (modal.classList.contains('hidden')) return;

    // Cifre e operatori base digitabili direttamente
    if (/^[0-9.+\-*/()%]$/.test(e.key)) {
      e.preventDefault();
      calcAppend(e.key);
      return;
    }

    switch (e.key) {
      case 'Enter':
      case '=':
        e.preventDefault();
        calcEvaluate();
        break;
      case 'Backspace':
        e.preventDefault();
        calcBackspace();
        break;
      case 'Escape':
        e.preventDefault();
        closeCalculator();
        break;
      case 'Delete':
        e.preventDefault();
        calcClear();
        break;
      case '^':
        e.preventDefault();
        calcAppend('^');
        break;
    }
  });
}
