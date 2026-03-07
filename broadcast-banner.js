(function () {
  const page = (window.location.pathname.split('/').pop() || '').toLowerCase();
  const supportedPages = new Set([
    'client_dashboard.html',
    'sales_dashboard.html',
    'developer_dashboard.html'
  ]);
  if (!supportedPages.has(page)) return;

  let currentUserId = null;
  let channel = null;

  function injectStylesOnce() {
    if (document.getElementById('global-broadcast-style')) return;
    const style = document.createElement('style');
    style.id = 'global-broadcast-style';
    style.textContent = `
      .global-broadcast-banner {
        display: none;
        align-items: flex-start;
        gap: 10px;
        margin: 10px 18px 0;
        padding: 10px 12px;
        border-radius: 12px;
        border: 1px solid rgba(255,255,255,.12);
        border-left: 4px solid #eab308;
        background: rgba(26,26,26,.95);
        box-shadow: 0 8px 20px rgba(0,0,0,.2);
      }
      .global-broadcast-banner.show { display: flex; }
      .global-broadcast-title { font-size: 12.5px; font-weight: 700; color: #fff; }
      .global-broadcast-body { font-size: 11.5px; color: #c7c7c7; margin-top: 2px; line-height: 1.4; }
      .global-broadcast-meta { font-size: 10px; color: #8f8f8f; margin-top: 4px; }
      .global-broadcast-close {
        margin-left: auto;
        background: transparent;
        border: 1px solid rgba(255,255,255,.18);
        color: #fff;
        border-radius: 8px;
        padding: 3px 8px;
        cursor: pointer;
        font-size: 10px;
      }
      .global-broadcast-close:hover { background: rgba(255,255,255,.08); }
    `;
    document.head.appendChild(style);
  }

  function getOrCreateBanner() {
    injectStylesOnce();
    let el = document.getElementById('global-broadcast-banner');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'global-broadcast-banner';
    el.className = 'global-broadcast-banner';
    const topbar = document.querySelector('.topbar');
    if (topbar && topbar.parentNode) {
      topbar.parentNode.insertBefore(el, topbar.nextSibling);
    } else {
      document.body.prepend(el);
    }
    return el;
  }

  function normalizePriority(value) {
    const p = String(value || '').toLowerCase();
    if (p === 'urgent') return { label: 'URGENT', color: '#ef4444' };
    if (p === 'high') return { label: 'HIGH', color: '#f59e0b' };
    if (p === 'low') return { label: 'LOW', color: '#60a5fa' };
    return { label: 'NORMAL', color: '#22c55e' };
  }

  function isExpired(row) {
    if (!row?.expires_at) return false;
    const t = new Date(row.expires_at).getTime();
    return Number.isFinite(t) && t < Date.now();
  }

  async function dismissBroadcast(id) {
    const sb = window.sbClient;
    if (!sb || !id) return;
    await sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id);
    await loadBroadcast();
  }

  async function loadBroadcast() {
    const sb = window.sbClient;
    if (!sb) return;
    const banner = getOrCreateBanner();

    const { data: authData } = await sb.auth.getUser();
    const user = authData?.user || null;
    if (!user?.id) {
      banner.classList.remove('show');
      banner.innerHTML = '';
      return;
    }
    currentUserId = user.id;

    const { data, error } = await sb
      .from('notifications')
      .select('id,title,body,payload,priority,created_at,read_at,expires_at,type')
      .eq('user_id', user.id)
      .eq('type', 'admin_broadcast')
      .order('created_at', { ascending: false })
      .limit(20);

    if (error || !Array.isArray(data) || !data.length) {
      banner.classList.remove('show');
      banner.innerHTML = '';
      return;
    }

    const active = data.find(row => !row.read_at && !isExpired(row))
      || data.find(row => !isExpired(row));

    if (!active) {
      banner.classList.remove('show');
      banner.innerHTML = '';
      return;
    }

    const priority = normalizePriority(active.priority || active.payload?.priority);
    const createdAt = active.created_at ? new Date(active.created_at) : null;
    const when = createdAt && !Number.isNaN(createdAt.getTime())
      ? createdAt.toLocaleString()
      : 'recently';

    banner.innerHTML = `
      <div style="width:7px;height:7px;border-radius:50%;margin-top:5px;background:${priority.color};flex:0 0 auto"></div>
      <div style="min-width:0;flex:1;">
        <div class="global-broadcast-title">${active.title || 'Platform Update'}</div>
        <div class="global-broadcast-body">${active.body || ''}</div>
        <div class="global-broadcast-meta">${priority.label} - ${when}</div>
      </div>
      <button class="global-broadcast-close" type="button" data-bid="${active.id}">Dismiss</button>
    `;
    banner.classList.add('show');

    const closeBtn = banner.querySelector('.global-broadcast-close');
    if (closeBtn) {
      closeBtn.onclick = () => dismissBroadcast(closeBtn.dataset.bid);
    }
  }

  function subscribeRealtime() {
    const sb = window.sbClient;
    if (!sb || !currentUserId) return;
    if (channel) sb.removeChannel(channel);
    channel = sb
      .channel(`broadcast-banner-${currentUserId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${currentUserId}` },
        (payload) => {
          if (payload?.new?.type !== 'admin_broadcast') return;
          loadBroadcast();
          if (window.showToast) window.showToast('New admin broadcast received');
        }
      )
      .subscribe();
  }

  async function init() {
    await loadBroadcast();
    subscribeRealtime();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 120));
  } else {
    setTimeout(init, 120);
  }
})();
