import { Octokit } from 'https://esm.sh/@octokit/rest@20.0.2';

function getRepoContext() {
  const hostname = window.location.hostname;
  const pathSegments = window.location.pathname.split('/').filter(Boolean);

  if (hostname.endsWith('.github.io')) {
    const owner = hostname.split('.')[0];
    const repo = pathSegments.length > 0 ? pathSegments[0] : `${owner}.github.io`;
    return { owner, repo };
  }

  return {
    owner: 'P1pp89',
    repo: 'dashboard-cantieri'
  };
}

const { owner: REPO_OWNER, repo: REPO_NAME } = getRepoContext();
const FILE_PATH = 'data/projects.json';

let octokit = null;
let currentFileSha = null;
let localProjectsState = [];

const fmtCurr = (val) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(val);
const fmtPct = (val) => new Intl.NumberFormat('it-IT', { style: 'percent', minimumFractionDigits: 2 }).format(val / 100);

document.addEventListener('DOMContentLoaded', () => {
  const token = sessionStorage.getItem('gh_pat');
  if (token) {
    initOctokit(token);
  }

  document.getElementById('btn-login')?.addEventListener('click', () => {
    const input = document.getElementById('pat-input');
    const pat = input ? input.value.trim() : '';
    if (pat) {
      sessionStorage.setItem('gh_pat', pat);
      initOctokit(pat);
    }
  });

  document.getElementById('btn-logout')?.addEventListener('click', () => {
    sessionStorage.removeItem('gh_pat');
    window.location.reload();
  });

  document.getElementById('btn-refresh')?.addEventListener('click', loadDashboardData);

  // Modal handlers
  document.getElementById('btn-add-project')?.addEventListener('click', () => openProjectModal(-1));
  document.getElementById('btn-close-modal')?.addEventListener('click', closeProjectModal);
  document.getElementById('btn-cancel-modal')?.addEventListener('click', closeProjectModal);
  document.getElementById('project-form')?.addEventListener('submit', handleFormSubmit);
});

function initOctokit(token) {
  try {
    octokit = new Octokit({ auth: token });
    
    document.getElementById('auth-modal')?.classList.add('hidden');
    document.getElementById('btn-logout')?.classList.remove('hidden');
    document.getElementById('btn-add-project')?.classList.remove('hidden');
    
    loadDashboardData();
  } catch (err) {
    alert(`Errore di inizializzazione client GitHub: ${err.message}`);
    sessionStorage.removeItem('gh_pat');
  }
}

function decodeBase64Utf8(b64Str) {
  const cleanB64 = b64Str.replace(/\s/g, '');
  const binaryString = atob(cleanB64);
  const bytes = Uint8Array.from(binaryString, char => char.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

function encodeBase64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function loadDashboardData() {
  if (!octokit) return;

  try {
    const { data } = await octokit.rest.repos.getContent({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      path: FILE_PATH,
      headers: {
        'x-github-api-version': '2022-11-28',
        'cache-control': 'no-cache'
      }
    });

    currentFileSha = data.sha;
    const jsonContent = decodeBase64Utf8(data.content);
    localProjectsState = JSON.parse(jsonContent);

    renderDashboard(localProjectsState);
  } catch (err) {
    console.error('Errore API GitHub:', err);
    if (err.name === 'TypeError' && err.message.includes('fetch')) {
      alert('Errore di Connessione (Failed to Fetch): Verificare la presenza di AdBlocker o estensioni di rete che bloccano le chiamate verso api.github.com.');
    } else if (err.status === 401) {
      alert('Autenticazione fallita: Token PAT non valido.');
      sessionStorage.removeItem('gh_pat');
      window.location.reload();
    } else if (err.status === 404) {
      alert(`Risorsa non trovata: Inizializzare il file "${FILE_PATH}" su repository.`);
    } else {
      alert(`Errore API [HTTP ${err.status || 'N/A'}]: ${err.message}`);
    }
  }
}

function renderDashboard(projects) {
  const tbody = document.getElementById('projects-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  let totalAuthorizedNet = 0;
  let totalActualCost = 0;

  projects.forEach((p, idx) => {
    const baseBudget = Number(p.budget_authorized) || 0;
    const discount = Number(p.discount_applied) || 0;
    const netBudget = baseBudget * (1 - discount / 100);

    const mat = Number(p.costs?.materials) || 0;
    const lab = Number(p.costs?.labor) || 0;
    const ren = Number(p.costs?.rentals) || 0;
    const actualCost = mat + lab + ren;

    const profitNominal = netBudget - actualCost;
    const profitPercent = netBudget > 0 ? (profitNominal / netBudget) * 100 : 0;

    totalAuthorizedNet += netBudget;
    totalActualCost += actualCost;

    const row = document.createElement('tr');
    row.className = 'hover:bg-slate-800/30 transition border-b border-slate-800/50';

    let badgeColor = 'text-emerald-400 bg-emerald-950/40 border-emerald-800';
    if (profitPercent < 10) {
      badgeColor = 'text-rose-400 bg-rose-950/40 border-rose-800';
    } else if (profitPercent < 25) {
      badgeColor = 'text-amber-400 bg-amber-950/40 border-amber-800';
    }

    row.innerHTML = `
      <td class="px-4 py-3 font-mono text-xs text-slate-400">${escapeHtml(p.id)}</td>
      <td class="px-4 py-3 font-medium text-slate-100">${escapeHtml(p.name)}</td>
      <td class="px-4 py-3 text-right font-mono">${fmtCurr(netBudget)}</td>
      <td class="px-4 py-3 text-right font-mono text-slate-400">${fmtCurr(mat)}</td>
      <td class="px-4 py-3 text-right font-mono text-slate-400">${fmtCurr(lab)}</td>
      <td class="px-4 py-3 text-right font-mono text-slate-400">${fmtCurr(ren)}</td>
      <td class="px-4 py-3 text-right font-mono text-amber-300 font-semibold">${fmtCurr(actualCost)}</td>
      <td class="px-4 py-3 text-right font-mono">${fmtCurr(profitNominal)}</td>
      <td class="px-4 py-3 text-right font-mono">
        <span class="inline-block px-2 py-0.5 rounded-full text-xs font-semibold border ${badgeColor}">
          ${fmtPct(profitPercent)}
        </span>
      </td>
      <td class="px-4 py-3 text-center">
        <button class="btn-edit text-xs text-emerald-400 hover:text-emerald-300 font-semibold px-2 py-1 rounded border border-emerald-900 bg-emerald-950/30" data-index="${idx}">Modifica</button>
      </td>
    `;
    tbody.appendChild(row);
  });

  document.querySelectorAll('.btn-edit').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const index = parseInt(e.target.getAttribute('data-index'), 10);
      openProjectModal(index);
    });
  });

  const totalProfitNominal = totalAuthorizedNet - totalActualCost;
  const totalProfitPercent = totalAuthorizedNet > 0 ? (totalProfitNominal / totalAuthorizedNet) * 100 : 0;

  document.getElementById('metric-authorized').textContent = fmtCurr(totalAuthorizedNet);
  document.getElementById('metric-actual').textContent = fmtCurr(totalActualCost);
  document.getElementById('metric-profit-nominal').textContent = fmtCurr(totalProfitNominal);
  document.getElementById('metric-profit-pct').textContent = fmtPct(totalProfitPercent);
}

function openProjectModal(index) {
  const modal = document.getElementById('project-modal');
  const title = document.getElementById('modal-title');
  const formIdx = document.getElementById('form-project-index');

  formIdx.value = index;

  if (index >= 0) {
    const p = localProjectsState[index];
    title.textContent = `Modifica Commessa: ${p.id}`;
    document.getElementById('form-id').value = p.id;
    document.getElementById('form-name').value = p.name;
    document.getElementById('form-budget').value = p.budget_authorized;
    document.getElementById('form-discount').value = p.discount_applied || 0;
    document.getElementById('form-cost-materials').value = p.costs?.materials || 0;
    document.getElementById('form-cost-labor').value = p.costs?.labor || 0;
    document.getElementById('form-cost-rentals').value = p.costs?.rentals || 0;
  } else {
    title.textContent = 'Nuova Commessa Cantiere';
    document.getElementById('project-form').reset();
    formIdx.value = -1;
  }

  modal.classList.remove('hidden');
}

function closeProjectModal() {
  document.getElementById('project-modal').classList.add('hidden');
}

async function handleFormSubmit(e) {
  e.preventDefault();
  
  const index = parseInt(document.getElementById('form-project-index').value, 10);
  const btnSave = document.getElementById('btn-save-project');
  
  btnSave.disabled = true;
  btnSave.textContent = 'Commit in corso...';

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

  const success = await commitDataToGithub(`Aggiornamento contabilità commessa ${updatedProject.id}`);
  
  btnSave.disabled = false;
  btnSave.textContent = 'Salva e Committa';

  if (success) {
    closeProjectModal();
    renderDashboard(localProjectsState);
  }
}

async function commitDataToGithub(commitMessage) {
  if (!octokit || !currentFileSha) {
    alert('Errore: SHA del file non presente. Impossibile committare.');
    return false;
  }

  try {
    const updatedJsonStr = JSON.stringify(localProjectsState, null, 2);
    const encodedContent = encodeBase64Utf8(updatedJsonStr);

    const response = await octokit.rest.repos.createOrUpdateFileContents({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      path: FILE_PATH,
      message: commitMessage,
      content: encodedContent,
      sha: currentFileSha,
      headers: {
        'x-github-api-version': '2022-11-28'
      }
    });

    currentFileSha = response.data.content.sha;
    return true;
  } catch (err) {
    console.error('Errore durante il commit:', err);
    alert(`Errore Commit su GitHub [HTTP ${err.status || 'N/A'}]: ${err.message}`);
    return false;
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
