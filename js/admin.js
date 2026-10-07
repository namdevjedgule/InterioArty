(function () {
  var SESSION_API = '/api/admin/session';
  var LEADS_API = '/api/admin/leads';
  var POLL_MS = 20000;
  var STATUS_LABEL = { new: 'New', contacted: 'Contacted', closed: 'Closed' };

  var loginEl = document.getElementById('login');
  var panelEl = document.getElementById('panel');
  var listEl = document.getElementById('leadList');
  var bannerEl = document.getElementById('banner');
  var leads = [];
  var filter = 'all';
  var query = '';
  var openIds = new Set();
  var pollTimer = null;
  var typing = false;

  function $(id) {
    return document.getElementById(id);
  }

  function esc(str) {
    var d = document.createElement('div');
    d.textContent = str == null ? '' : String(str);
    return d.innerHTML;
  }

  function api(url, method, body) {
    return fetch(url, {
      method: method || 'GET',
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      return r
        .json()
        .catch(function () {
          return {};
        })
        .then(function (data) {
          return { status: r.status, ok: r.ok, data: data };
        });
    });
  }

  function showLogin(message) {
    stopPolling();
    panelEl.hidden = true;
    loginEl.hidden = false;
    $('loginErr').textContent = message || '';
    $('password').focus();
  }

  function showPanel() {
    loginEl.hidden = true;
    panelEl.hidden = false;
    refresh();
    startPolling();
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(function () {
      if (!document.hidden && !typing) refresh();
    }, POLL_MS);
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  function refresh() {
    return api(LEADS_API).then(function (res) {
      if (res.status === 401) {
        showLogin('Session expired. Please sign in again.');
        return;
      }
      if (res.status === 503) {
        showBanner('Lead storage is not set up on the server yet. Add the Upstash Redis integration in Vercel (see README), then redeploy.');
        leads = [];
        render();
        return;
      }
      if (!res.ok) {
        showBanner('Could not load leads right now. Retrying automatically.');
        return;
      }
      bannerEl.hidden = true;
      leads = res.data.leads || [];
      render();
    });
  }

  function showBanner(text) {
    bannerEl.textContent = text;
    bannerEl.hidden = false;
  }

  function timeAgo(iso) {
    var diff = Date.now() - new Date(iso).getTime();
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }

  function isSummarizing(l) {
    return l.summarizing === true && Date.now() - new Date(l.updatedAt).getTime() < 3 * 60 * 1000;
  }

  function matches(l) {
    if (filter !== 'all' && (l.status || 'new') !== filter) return false;
    if (!query) return true;
    var hay = [l.name, l.phone, l.email, l.location, l.projectType, l.budget, l.summary].join(' ').toLowerCase();
    return hay.indexOf(query) !== -1;
  }

  function waNumber(phone) {
    var digits = String(phone || '').replace(/\D/g, '');
    if (digits.length === 10) digits = '91' + digits;
    return digits;
  }

  function specRow(l) {
    var parts = [l.projectType, l.bhk, l.location, l.budget, l.timeline].filter(Boolean);
    if (!parts.length) return '';
    return '<div class="detail-specs">' + parts.map(function (p) { return '<span class="dim">' + esc(p) + '</span>'; }).join('') + '</div>';
  }

  function transcriptHtml(l) {
    return (l.transcript || [])
      .map(function (m) {
        return (
          '<div class="t-msg ' + (m.role === 'user' ? 'user' : 'bot') + '">' +
          '<span class="t-role">' + (m.role === 'user' ? 'Visitor' : 'Arty') + '</span>' +
          esc(m.content) + '</div>'
        );
      })
      .join('');
  }

  function render() {
    var today = new Date().toDateString();
    $('statTotal').textContent = leads.length;
    $('statToday').textContent = leads.filter(function (l) { return new Date(l.createdAt).toDateString() === today; }).length;
    $('statPending').textContent = leads.filter(function (l) { return (l.status || 'new') === 'new'; }).length;

    document.querySelectorAll('.filter-btn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.filter === filter);
    });

    var shown = leads.filter(matches);
    if (!shown.length) {
      listEl.innerHTML =
        '<div class="empty-state"><b>' + (leads.length ? 'Nothing matches' : 'No leads yet') + '</b>' +
        (leads.length
          ? 'No leads match this filter or search.'
          : 'When a visitor chats with Arty and shares their details, the lead shows up here on every device.') +
        '</div>';
      return;
    }

    listEl.innerHTML = shown
      .map(function (l) {
        var open = openIds.has(l.cid);
        var status = l.status || 'new';
        var wa = waNumber(l.phone);
        var contact = l.phone || l.email || 'N/A';
        return (
          '<div class="lead-card' + (open ? ' open' : '') + '" data-cid="' + esc(l.cid) + '">' +
          '<div class="lead-row" data-toggle="' + esc(l.cid) + '">' +
          '<div class="lead-field"><label>Name</label><span>' + (esc(l.name) || 'N/A') + '</span></div>' +
          '<div class="lead-field"><label>Contact</label><span>' + esc(contact) + '</span></div>' +
          '<div class="lead-field"><label>Project</label><span>' + (esc(l.projectType) || 'N/A') + '</span></div>' +
          '<div class="lead-field"><label>Updated</label><span>' + timeAgo(l.updatedAt) + '</span></div>' +
          '<div class="lead-badge' + (isSummarizing(l) ? ' pending' : '') + '">' + (isSummarizing(l) ? 'Summarizing…' : STATUS_LABEL[status]) + '</div>' +
          '<div class="lead-chevron">→</div>' +
          '</div>' +
          '<div class="lead-detail"><div class="lead-detail-inner">' +
          '<div class="detail-block"><label>AI Summary</label>' +
          '<p class="summary-text">' + (esc(l.summary) || (isSummarizing(l) ? 'Analyzing conversation…' : 'No summary available.')) + '</p>' +
          specRow(l) +
          '<label style="margin-top:20px">Your notes</label>' +
          '<textarea class="notes" data-notes="' + esc(l.cid) + '" placeholder="Add a note about this lead">' + esc(l.notes) + '</textarea>' +
          '</div>' +
          '<div class="detail-block"><label>Conversation (' + (l.transcript || []).length + ' messages)</label>' +
          '<div class="transcript">' + transcriptHtml(l) + '</div></div>' +
          '</div>' +
          '<div class="lead-actions">' +
          '<select class="status-select" data-status="' + esc(l.cid) + '">' +
          ['new', 'contacted', 'closed'].map(function (s) { return '<option value="' + s + '"' + (s === status ? ' selected' : '') + '>' + STATUS_LABEL[s] + '</option>'; }).join('') +
          '</select>' +
          (l.phone ? '<a class="action-btn" href="tel:' + esc(l.phone) + '">Call</a>' : '') +
          (wa ? '<a class="action-btn" target="_blank" rel="noopener" href="https://wa.me/' + wa + '">WhatsApp</a>' : '') +
          (l.email ? '<a class="action-btn" href="mailto:' + esc(l.email) + '">Email</a>' : '') +
          '<span class="saved" data-saved="' + esc(l.cid) + '">Saved</span>' +
          '<button class="action-btn danger" data-delete="' + esc(l.cid) + '">Delete</button>' +
          '</div></div></div>'
        );
      })
      .join('');
  }

  function flashSaved(cid) {
    var el = listEl.querySelector('[data-saved="' + cid + '"]');
    if (!el) return;
    el.classList.add('show');
    setTimeout(function () { el.classList.remove('show'); }, 1500);
  }

  function patch(cid, fields) {
    var body = Object.assign({ cid: cid }, fields);
    return api(LEADS_API, 'PATCH', body).then(function (res) {
      if (res.status === 401) return showLogin('Session expired. Please sign in again.');
      if (!res.ok) return showBanner('Could not save that change. Please try again.');
      var rec = leads.find(function (l) { return l.cid === cid; });
      if (rec && res.data.lead) Object.assign(rec, res.data.lead);
      bannerEl.hidden = true;
      if (fields.status !== undefined) render();
      flashSaved(cid);
    });
  }

  // delegated events: the list re-renders, so listeners live on the container
  listEl.addEventListener('click', function (e) {
    var del = e.target.closest('[data-delete]');
    if (del) {
      e.stopPropagation();
      if (!confirm('Delete this lead permanently?')) return;
      var cid = del.dataset.delete;
      api(LEADS_API, 'DELETE', { cid: cid }).then(function (res) {
        if (res.ok) {
          leads = leads.filter(function (l) { return l.cid !== cid; });
          openIds.delete(cid);
          render();
        } else if (res.status === 401) showLogin('Session expired. Please sign in again.');
      });
      return;
    }
    if (e.target.closest('.lead-actions, .detail-block, .lead-detail')) return;
    var row = e.target.closest('[data-toggle]');
    if (row) {
      var id = row.dataset.toggle;
      if (openIds.has(id)) openIds.delete(id);
      else openIds.add(id);
      render();
    }
  });

  listEl.addEventListener('change', function (e) {
    var sel = e.target.closest('[data-status]');
    if (sel) patch(sel.dataset.status, { status: sel.value });
  });

  listEl.addEventListener('focusin', function (e) {
    if (e.target.matches('.notes')) typing = true;
  });
  listEl.addEventListener('focusout', function (e) {
    if (!e.target.matches('.notes')) return;
    typing = false;
    var cid = e.target.dataset.notes;
    var rec = leads.find(function (l) { return l.cid === cid; });
    if (rec && (rec.notes || '') !== e.target.value) patch(cid, { notes: e.target.value });
  });

  document.querySelectorAll('.filter-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      filter = b.dataset.filter;
      render();
    });
  });

  $('search').addEventListener('input', function (e) {
    query = e.target.value.trim().toLowerCase();
    render();
  });

  function csvCell(v) {
    var s = v == null ? '' : String(v);
    return '"' + s.replace(/"/g, '""') + '"';
  }

  $('exportCsv').addEventListener('click', function () {
    if (!leads.length) return;
    var cols = ['Name', 'Phone', 'Email', 'Project', 'BHK', 'Location', 'Budget', 'Timeline', 'Status', 'Captured', 'Last updated', 'Notes', 'Summary'];
    var rows = leads.map(function (l) {
      return [l.name, l.phone, l.email, l.projectType, l.bhk, l.location, l.budget, l.timeline, STATUS_LABEL[l.status || 'new'], l.createdAt, l.updatedAt, l.notes, l.summary];
    });
    var csv = [cols].concat(rows).map(function (r) { return r.map(csvCell).join(','); }).join('\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'interio-arty-leads-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
  });

  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = $('loginBtn');
    btn.disabled = true;
    $('loginErr').textContent = '';
    api(SESSION_API, 'POST', { password: $('password').value })
      .then(function (res) {
        if (res.ok) {
          $('password').value = '';
          showPanel();
        } else {
          $('loginErr').textContent = (res.data && res.data.error) || 'Could not sign in.';
        }
      })
      .catch(function () {
        $('loginErr').textContent = 'Network problem. Please try again.';
      })
      .finally(function () {
        btn.disabled = false;
      });
  });

  $('logout').addEventListener('click', function () {
    api(SESSION_API, 'DELETE').then(function () {
      leads = [];
      showLogin('');
    });
  });

  api(SESSION_API)
    .then(function (res) {
      if (res.data && res.data.authed) showPanel();
      else if (res.data && res.data.configured === false) showLogin('Admin password is not configured on the server yet.');
      else showLogin('');
    })
    .catch(function () {
      showLogin('Could not reach the server.');
    });
})();
