import { Octokit } from 'https://esm.sh/@octokit/rest@20.0.2';

const OVERHEAD_RATE = 0.05; // 5% Costi di gestione (overhead)

// Strict Repo Context Resolution
function getRepoContext() {
  const hostname = window.location.hostname;
  const pathSegments = window.location.pathname.split('/').filter(Boolean);

  if (hostname.endsWith('.github.io')) {
    const owner = hostname.split('.')[0];
    const repo = pathSegments.length > 0 ? pathSegments[0] : `${owner}.github.io`;
    return { owner, repo };
  }
  return { owner: 'P1pp89', repo: 'dashboard-cantieri' };
}

const { owner: REPO_OWNER, repo: REPO_NAME } = getRepoContext();
const FILE_PATH = 'data/projects.json';

let octokit = null;
let currentFileSha = null;
let localProjectsState = [];

// Safe UTF-8 Base64 Transcoding
const encodeBase64Utf8 = (str) => btoa(unescape(encodeURIComponent(str)));
const decodeBase64Utf8 = (b64) => decodeURIComponent(escape(atob(b64)));

const fmtCurr = (val) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(val);
const fmtPct = (val) => new Intl.NumberFormat('it-IT', { style: 'percent', minimumFractionDigits: 2 }).format(val / 100);

document.addEventListener('DOMContentLoaded', () => {
  const token = sessionStorage.getItem('gh_pat');
  if (token) initOctokit(token);

  document.getElementById('btn-login').addEventListener('click', () => {
    const pat = document.getElementById('pat-input').value.trim();
    if (!pat.startsWith('github_pat_')) {
      alert("Formato Token non valido. Deve iniziare con 'github_pat_'");
      return;
    }
    sessionStorage.setItem('gh_pat', pat);
    initOctokit(pat);
  });

  document.getElementById('btn-logout').addEventListener('click', () => {
    sessionStorage.removeItem('gh_pat');
    window.location.reload();
  });

  document.getElementById('btn-refresh').addEventListener('click', loadDashboardData);
  document.getElementById('btn-add-project').addEventListener('click', () => openProjectModal(-1));
  document.getElementById('btn-close-modal').addEventListener('click', closeProjectModal);
  document.getElementById('btn-cancel-modal').addEventListener('click', closeProjectModal);
  document.getElementById('project-form').addEventListener('submit', handleFormSubmit);
});

function initOctokit(token) {
  octokit = new Octokit({ 
    auth: token,
    request: { fetch: (url, opts) => fetch(url, { ...opts, cache: "no-store" }) }
  });
  
  document.getElementById('auth-modal').classList.add('hidden');
  document.getElementById('btn-logout').classList.remove('hidden');
  document.getElementById('btn-add-project').classList.remove('hidden');
  
  loadDashboardData();
}

async function loadDashboardData() {
  if (!octokit) return false;

  try {
    const { data } = await octokit.rest.repos.getContent({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      path: FILE_PATH,
      headers: {
        'x-github-api-version': '2022-11-28',
        'If-None-Match': ''
      }
    });

    currentFileSha = data.sha;
    const jsonContent = decodeBase64Utf8(data.content);
    localProjectsState = JSON.parse(jsonContent);

    renderDashboard(localProjectsState);
    return true;
  } catch (err) {
    if (err.status === 404) {
      console.warn(`File ${FILE_PATH} assente. Inizializzazione state vuoto.`);
      currentFileSha = null;
      localProjectsState = [];
      renderDashboard(localProjectsState);
      return true;
    }
    handleApiError(err, 'lettura');
    return false;
  }
}

async function commitDataToGithub(commitMessage) {
  try {
    const updatedJsonStr = JSON.stringify(localProjectsState, null, 2);
    const encodedContent = encodeBase64Utf8(updatedJsonStr);

    const payload = {
      owner: REPO_OWNER,
      repo: REPO_NAME,
      path: FILE_PATH,
      message: commitMessage,
      content: encodedContent,
      headers: { 'x-github-api-version': '2022-11-28' }
    };

    if (currentFileSha) payload.sha = currentFileSha;

    const response = await octokit.rest.repos.createOrUpdateFileContents(payload);
    currentFileSha = response.data.content.sha;
    return true;
  } catch (err) {
    handleApiError(err, 'commit (HTTP ' + err.status + ')');
    return false;
  }
}

async function handleFormSubmit(e) {
  e.preventDefault();
  
  const index = parseInt(document.getElementById('form-project-index').value, 10);
  const btnSave = document.getElementById('btn-save-project');
  
  btnSave.disabled = true;
  btnSave.textContent = 'Sync state...';

  const syncSuccess = await loadDashboardData();
  if (!syncSuccess) {
    btnSave.disabled = false;
    btnSave.textContent = 'Esegui Commit';
    return;
  }

  const updatedProject = {
    id: document.getElementById('form-id').value.trim(),
    name: document.getElementById('form-name').value.trim(),
    budget_authorized: parseFloat(document.getElementById('form-budget').value) || 0,
    discount_applied: parseFloat(document.getElementById('form-discount').value) || 0,
    costs: {
      materials: parseFloat(document.getElementById('form-cost-materials').value) || 0,
      labor: parseFloat(document.getElementById('form-cost-labor').value) || 0,
      rentals: parseFloat(document.getElementById('form-cost-rentals').value) || 0
    },
    last_updated: new Date().toISOString()
  };

  if (index >= 0) {
    localProjectsState[index] = updatedProject;
  } else {
    localProjectsState.push(updatedProject);
  }

  btnSave.textContent = 'Commit Remoto...';
  const success = await commitDataToGithub(`[Update] Commessa ${updatedProject.id}`);
  
  btnSave.disabled = false;
  btnSave.textContent = 'Esegui Commit';

  if (success) {
    closeProjectModal();
    renderDashboard(localProjectsState);
  }
}

function handleApiError(err, context) {
  console.error(`API Error [${context}]:`, err);
  if (err.name === 'TypeError' && err.message.includes('fetch')) {
    alert('Network Error (HTTP 500 equivalent): Possibile blocco CORS o AdBlocker (api.github.com).');
  } else if (err.status === 401) {
    alert('Auth 401: PAT Scaduto o permessi insufficienti.');
    sessionStorage.removeItem('gh_pat');
    window.location.reload();
  } else if (err.status === 422) {
    alert('HTTP 422 Unprocessable Entity: Collisione SHA concorrente o validazione Base64 fallita. Ricarica la pagina.');
  } else {
    alert(`Errore GitHub API: ${err.message}`);
  }
}

function renderDashboard(projects) {
  const tbody = document.getElementById('projects-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  let totalAuthorizedNet = 0, totalActualCost = 0;

  projects.forEach((p, idx) => {
    const netBudget = (Number(p.budget_authorized) || 0) * (1 - (Number(p.discount_applied) || 0) / 100);
    
    // Calcolo Costi Diretti
    const directCost = (Number(p.costs?.materials) || 0) + (Number(p.costs?.labor) || 0) + (Number(p.costs?.rentals) || 0);
    
    // Applicazione Coefficiente 5% Costi Gestione
    const totalCostWithOverhead = directCost * (1 + OVERHEAD_RATE);
    
    const profitNominal = netBudget - totalCostWithOverhead;
    const profitPercent = netBudget > 0 ? (profitNominal / netBudget) * 100 : 0;

    totalAuthorizedNet += netBudget;
    totalActualCost += totalCostWithOverhead;

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
      <td class="px-4 py-3 text-right font-mono text-amber-300 font-semibold">${fmtCurr(totalCostWithOverhead)}</td>
      <td class="px-4 py-3 text-right font-mono">${fmtCurr(profitNominal)}</td>
      <td class="px-4 py-3 text-right font-mono"><span class="px-2 py-0.5 rounded-full text-xs font-semibold border ${badgeColor}">${fmtPct(profitPercent)}</span></td>
      <td class="px-4 py-3 text-center">
        <button class="btn-edit text-xs text-emerald-400 hover:text-emerald-300 font-semibold px-2 py-1 rounded border border-emerald-900 bg-emerald-950/30" data-index="${idx}">Edit</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  document.querySelectorAll('.btn-edit').forEach(b => b.addEventListener('click', e => openProjectModal(e.target.dataset.index)));

  const totalProfitPercent = totalAuthorizedNet > 0 ? ((totalAuthorizedNet - totalActualCost) / totalAuthorizedNet) * 100 : 0;
  document.getElementById('metric-authorized').textContent = fmtCurr(totalAuthorizedNet);
  document.getElementById('metric-actual').textContent = fmtCurr(totalActualCost);
  document.getElementById('metric-profit-nominal').textContent = fmtCurr(totalAuthorizedNet - totalActualCost);
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

function closeProjectModal() { document.getElementById('project-modal').classList.add('hidden'); }
function escapeHtml(str) { return String(str).replace(/[&<>"']/g, m => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'}[m])); }
function closeProjectModal() { document.getElementById('project-modal').classList.add('hidden'); }
function escapeHtml(str) { return String(str).replace(/[&<>"']/g, m => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'}[m])); }
