const REPO_OWNER = 'NOME_UTENTE_GITHUB'; // Modificare con il proprio username
const REPO_NAME = 'NOME_REPOSITORY';      // Modificare con il nome repo
const FILE_PATH = 'data/projects.json';

let octokit = null;
let currentFileSha = null;

const fmtCurr = (val) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(val);
const fmtPct = (val) => new Intl.NumberFormat('it-IT', { style: 'percent', minimumFractionDigits: 2 }).format(val / 100);

document.addEventListener('DOMContentLoaded', () => {
  const token = sessionStorage.getItem('gh_pat');
  if (token) {
    initOctokit(token);
  }

  document.getElementById('btn-login').addEventListener('click', () => {
    const pat = document.getElementById('pat-input').value.trim();
    if (pat) {
      sessionStorage.setItem('gh_pat', pat);
      initOctokit(pat);
    }
  });

  document.getElementById('btn-logout').addEventListener('click', () => {
    sessionStorage.removeItem('gh_pat');
    window.location.reload();
  });

  document.getElementById('btn-refresh').addEventListener('click', loadDashboardData);
});

function initOctokit(token) {
  try {
    octokit = new window.Octokit({ auth: token });
    document.getElementById('auth-modal').classList.add('hidden');
    document.getElementById('btn-logout').classList.remove('hidden');
    loadDashboardData();
  } catch (err) {
    alert('Errore di inizializzazione client GitHub: ' + err.message);
  }
}

async function loadDashboardData() {
  if (!octokit) return;

  try {
    const { data } = await octokit.rest.repos.getContent({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      path: FILE_PATH,
    });

    currentFileSha = data.sha;
    const contentUtf8 = new TextDecoder().decode(
      Uint8Array.from(atob(data.content.replace(/\n/g, '')), c => c.charCodeAt(0))
    );
    
    const projects = JSON.parse(contentUtf8);
    renderDashboard(projects);
  } catch (err) {
    console.error('Errore nel recupero dati:', err);
    if (err.status === 401) {
      alert('Token non valido o scaduto.');
      sessionStorage.removeItem('gh_pat');
      window.location.reload();
    }
  }
}

function renderDashboard(projects) {
  const tbody = document.getElementById('projects-table-body');
  tbody.innerHTML = '';

  let totalAuthorized = 0;
  let totalActual = 0;

  projects.forEach(p => {
    const profitNominal = p.budget_authorized - p.actual_cost;
    const profitPercent = p.budget_authorized > 0 ? (profitNominal / p.budget_authorized) * 100 : 0;

    totalAuthorized += p.budget_authorized;
    totalActual += p.actual_cost;

    const row = document.createElement('tr');
    row.className = 'hover:bg-slate-800/30 transition';

    let badgeColor = 'text-emerald-400 bg-emerald-950/40 border-emerald-800';
    if (profitPercent < 10) badgeColor = 'text-rose-400 bg-rose-950/40 border-rose-800';
    else if (profitPercent < 25) badgeColor = 'text-amber-400 bg-amber-950/40 border-amber-800';

    row.innerHTML = `
      <td class="px-6 py-4 font-mono text-xs text-slate-400">${p.id}</td>
      <td class="px-6 py-4 font-medium text-slate-100">${p.name}</td>
      <td class="px-6 py-4 text-right font-mono">${fmtCurr(p.budget_authorized)}</td>
      <td class="px-6 py-4 text-right font-mono text-amber-300">${fmtCurr(p.actual_cost)}</td>
      <td class="px-6 py-4 text-right font-mono">${fmtCurr(profitNominal)}</td>
      <td class="px-6 py-4 text-right font-mono">
        <span class="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold border ${badgeColor}">
          ${fmtPct(profitPercent)}
        </span>
      </td>
    `;
    tbody.appendChild(row);
  });

  const totalProfitNominal = totalAuthorized - totalActual;
  const totalProfitPercent = totalAuthorized > 0 ? (totalProfitNominal / totalAuthorized) * 100 : 0;

  document.getElementById('metric-authorized').textContent = fmtCurr(totalAuthorized);
  document.getElementById('metric-actual').textContent = fmtCurr(totalActual);
  document.getElementById('metric-profit').textContent = fmtPct(totalProfitPercent);
}
