import { Octokit } from 'https://esm.sh/@octokit/rest@20.0.2';

/**
 * Determinazione automatica del contesto Repository da window.location
 */
function getRepoContext() {
  const hostname = window.location.hostname;
  const pathSegments = window.location.pathname.split('/').filter(Boolean);

  if (hostname.endsWith('.github.io')) {
    const owner = hostname.split('.')[0];
    const repo = pathSegments.length > 0 ? pathSegments[0] : `${owner}.github.io`;
    return { owner, repo };
  }

  // Fallback per test in locale (es. localhost)
  return {
    owner: 'P1pp89',
    repo: 'dashboard-cantieri'
  };
}

const { owner: REPO_OWNER, repo: REPO_NAME } = getRepoContext();
const FILE_PATH = 'data/projects.json';

let octokit = null;

// Formattazione localizzata IT/EUR
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
});

/**
 * Inizializzazione Client Octokit SDK
 * @param {string} token 
 */
function initOctokit(token) {
  try {
    octokit = new Octokit({ auth: token });
    
    document.getElementById('auth-modal')?.classList.add('hidden');
    document.getElementById('btn-logout')?.classList.remove('hidden');
    
    loadDashboardData();
  } catch (err) {
    alert(`Errore di inizializzazione client GitHub: ${err.message}`);
    sessionStorage.removeItem('gh_pat');
  }
}

/**
 * Decodifica Base64 UTF-8
 * @param {string} b64Str 
 * @returns {string}
 */
function decodeBase64Utf8(b64Str) {
  const cleanB64 = b64Str.replace(/\s/g, '');
  const binaryString = atob(cleanB64);
  const bytes = Uint8Array.from(binaryString, char => char.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * Fetch dati da GitHub REST API v3
 */
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

    const jsonContent = decodeBase64Utf8(data.content);
    const projects = JSON.parse(jsonContent);

    renderDashboard(projects);
  } catch (err) {
    console.error('Errore API GitHub:', err);
    if (err.status === 401) {
      alert('Autenticazione fallita: Token PAT non valido o privo dei permessi necessari.');
      sessionStorage.removeItem('gh_pat');
      window.location.reload();
    } else if (err.status === 404) {
      alert(`Risorsa non trovata: Verificare l'esistenza di "${FILE_PATH}" nel repo ${REPO_OWNER}/${REPO_NAME}.`);
    } else {
      alert(`Errore API GitHub [HTTP ${err.status || 'N/A'}]: ${err.message}`);
    }
  }
}

/**
 * Rendering Metriche e Tabella Avanzamento
 * @param {Array<Object>} projects 
 */
function renderDashboard(projects) {
  const tbody = document.getElementById('projects-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  let totalAuthorized = 0;
  let totalActual = 0;

  projects.forEach(p => {
    const authorized = Number(p.budget_authorized) || 0;
    const actual = Number(p.actual_cost) || 0;

    const profitNominal = authorized - actual;
    const profitPercent = authorized > 0 ? (profitNominal / authorized) * 100 : 0;

    totalAuthorized += authorized;
    totalActual += actual;

    const row = document.createElement('tr');
    row.className = 'hover:bg-slate-800/30 transition border-b border-slate-800/50';

    let badgeColor = 'text-emerald-400 bg-emerald-950/40 border-emerald-800';
    if (profitPercent < 10) {
      badgeColor = 'text-rose-400 bg-rose-950/40 border-rose-800';
    } else if (profitPercent < 25) {
      badgeColor = 'text-amber-400 bg-amber-950/40 border-amber-800';
    }

    row.innerHTML = `
      <td class="px-6 py-4 font-mono text-xs text-slate-400">${escapeHtml(p.id)}</td>
      <td class="px-6 py-4 font-medium text-slate-100">${escapeHtml(p.name)}</td>
      <td class="px-6 py-4 text-right font-mono">${fmtCurr(authorized)}</td>
      <td class="px-6 py-4 text-right font-mono text-amber-300">${fmtCurr(actual)}</td>
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

  const elemAuthorized = document.getElementById('metric-authorized');
  const elemActual = document.getElementById('metric-actual');
  const elemProfit = document.getElementById('metric-profit');

  if (elemAuthorized) elemAuthorized.textContent = fmtCurr(totalAuthorized);
  if (elemActual) elemActual.textContent = fmtCurr(totalActual);
  if (elemProfit) elemProfit.textContent = fmtPct(totalProfitPercent);
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
