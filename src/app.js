import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const MANAGEMENT_FEE_RATE = 0.05; // 5% decurtato dall'utile lordo

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
    await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo: window.location.href }
    });
  });

  document.getElementById('btn-logout').addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.reload();
  });

  document.getElementById('btn-refresh').addEventListener('click', loadDashboardData);
  document.getElementById('btn-add-project').addEventListener('click', () => openProjectModal(-1));
  document.getElementById('btn-close-modal').addEventListener('click', closeProjectModal);
  document.getElementById('btn-cancel-modal').addEventListener('click', closeProjectModal);
  document.getElementById('project-form').addEventListener('submit', handleFormSubmit);

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
  document.getElementById('user-badge').classList.add('hidden');
}

function showAppForUser(session) {
  const username = session.user.user_metadata?.user_name || session.user.email;
  document.getElementById('auth-modal').classList.add('hidden');
  document.getElementById('btn-logout').classList.remove('hidden');
  document.getElementById('btn-add-project').classList.remove('hidden');
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
      <td class="px-4 py-3 text-center">
        <button class="btn-edit text-xs text-emerald-400 hover:text-emerald-300 font-semibold px-2 py-1 rounded border border-emerald-900 bg-emerald-950/30" data-index="${idx}">Edit</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  document.querySelectorAll('.btn-edit').forEach(b => b.addEventListener('click', e => openProjectModal(e.target.dataset.index)));

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
