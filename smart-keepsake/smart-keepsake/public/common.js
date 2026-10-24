// Small helpers shared by the family, owner and simulator pages.

async function api(path, opts = {}) {
  const init = { credentials: 'same-origin', ...opts, headers: { ...(opts.headers || {}) } };
  if (opts.json !== undefined) {
    init.body = JSON.stringify(opts.json);
    init.headers['Content-Type'] = 'application/json';
    if (!opts.method) init.method = 'POST';
  }
  const res = await fetch(path, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// 'YYYY-MM-DD' or '--MM-DD' -> 'Mar 4, 1946' / 'Mar 4'
function fmtDate(s) {
  const m = /^(?:(\d{4})-|--)(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) return '';
  const md = `${MONTHS[+m[2] - 1]} ${+m[3]}`;
  return m[1] ? `${md}, ${m[1]}` : md;
}

function lifeYears(memorial) {
  const y = (s) => (/^\d{4}/.exec(s || '') || [''])[0];
  const a = y(memorial.born), b = y(memorial.died);
  return a || b ? `${a || '?'} – ${b || ''}`.trim() : '';
}

function timeAgo(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
}

function fmtDuration(sec) {
  if (!sec || !isFinite(sec)) return '';
  sec = Math.round(sec);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function toast(msg, isError) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = isError ? 'show error' : 'show';
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.className = ''), 3500);
}
