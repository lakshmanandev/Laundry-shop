import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api, queryString } from './services/api.js';
import { date, localDateTime, mapUrl, money, pretty, terminal, time, transitions } from './utils/format.js';
import './styles/portal.css';

const publicSiteHref = import.meta.env.DEV ? __PUBLIC_SITE_URL__ : '/';
const adminNav = [
  ['inbox', '✉', 'Customer inbox'], ['manage-orders', '⚒', 'Manage orders'], ['services', '✳', 'Services & pricing'],
  ['settings', '⚙', 'Business settings'], ['customers', '♧', 'Customers'], ['audit', '⌁', 'Audit log']
];
const commonNav = [
  ['overview', '◫', 'Overview'], ['orders', '▫', 'My orders'], ['new-order', '＋', 'New order'],
  ['notifications', '♢', 'Updates'], ['profile', '♙', 'My profile'], ['my-messages', '', 'My messages']
];
const pageTitles = {
  overview: ['Your laundry, on track.', 'Good work starts with a clear view.'],
  orders: ['Your order history.', 'Every order, in one place.'], 'new-order': ['Let’s plan your next pickup.', 'Let’s plan your next pickup.'],
  'manage-orders': ['Keep every order moving.', 'Keep every order moving.'], inbox: ['The team is here to help.', 'Every customer, heard.'],
  profile: ['Your details, your way.', 'Your details, your way.'], notifications: ['The latest from our team.', 'The latest from our team.'],
  'my-messages': ['The team is here to help.', 'The team is here to help.'], services: ['Services and pricing.', 'Services and pricing.'],
  settings: ['Pickup and store settings.', 'Pickup and store settings.'], customers: ['Your local customer book.', 'Your local customer book.'],
  audit: ['Administrative activity.', 'Administrative activity.']
};

function Loading({ label = 'Loading your laundry workspace…' }) {
  return <div className="auth-layout" role="status"><div className="auth-card">{label}</div></div>;
}

function AuthScreen({ onAuthenticated, error: initialError = '' }) {
  const [mode, setMode] = useState('login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  useEffect(() => setError(initialError), [initialError]);
  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form).entries());
    setBusy(true); setError('');
    try { await onAuthenticated(mode, body); }
    catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }
  return <section className="auth-layout">
    <div className="auth-art"><a className="auth-brand" href={publicSiteHref}><img src="/assets/images/muniyasamy-mark.svg" alt="" /><span>Muniyasamy<small>LAUNDRY SERVICES</small></span></a><span className="eyebrow">CARE THAT FITS YOUR DAY</span><h2>Fresh clothes.<br /><em>Clear updates.</em></h2><p>Book a pickup, follow each step, and message our team from one simple place.</p><div className="art-orbit" aria-hidden="true">◌<span>✳</span></div><div className="auth-perks"><span>✦ Doorstep pickup</span><span>✦ Live order progress</span><span>✦ Local team in Madurai</span></div></div>
    <div className="auth-card"><div className="auth-tabs" role="tablist" aria-label="Account access"><button type="button" role="tab" aria-selected={mode === 'login'} className={`auth-tab ${mode === 'login' ? 'active' : ''}`} onClick={() => { setMode('login'); setError(''); }}>Sign in</button><button type="button" role="tab" aria-selected={mode === 'register'} className={`auth-tab ${mode === 'register' ? 'active' : ''}`} onClick={() => { setMode('register'); setError(''); }}>Create account</button></div>
      <form onSubmit={submit}>
        {mode === 'register' && <div className="register-fields"><label>Full name<input name="name" autoComplete="name" placeholder="Your name" required maxLength="80" /></label><label>Phone number<input name="phone" autoComplete="tel" placeholder="+91 98439 11292" required maxLength="20" /></label></div>}
        <label>Email address<input name="email" type="email" autoComplete="email" placeholder="you@example.com" required maxLength="254" /></label>
        <label>Password<input name="password" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} placeholder="At least 10 characters" required minLength="10" /></label>
        <button className="button primary full" disabled={busy}>{busy ? (mode === 'register' ? 'Creating account…' : 'Signing in…') : <>{mode === 'register' ? 'Create account' : 'Sign in'} <span>→</span></>}</button>
        <p className="form-note">Your account keeps your orders and conversations together.</p>
      </form>{error && <div className="notice error" role="alert">{error}</div>}
    </div>
  </section>;
}

function PortalApp() {
  const [user, setUser] = useState(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionError, setSessionError] = useState('');
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    let active = true;
    api('/auth/me').then(({ user: current }) => { if (active) setUser(current); })
      .catch(error => { if (active && error.status !== 401) setSessionError(error.message); })
      .finally(() => { if (active) setSessionReady(true); });
    return () => { active = false; };
  }, []);
  const authenticate = async (mode, body) => {
    const result = await api(`/auth/${mode === 'register' ? 'register' : 'login'}`, { method: 'POST', body: JSON.stringify(body) });
    setUser(result.user); setSessionError('');
    navigate(result.user.role === 'admin' ? '/admin/overview' : '/customer/overview', { replace: true });
  };
  const signOut = async () => {
    await api('/auth/logout', { method: 'POST', body: '{}' }).catch(() => {});
    setUser(null); navigate('/', { replace: true });
  };
  if (!sessionReady) return <Loading />;
  if (sessionError && !user) return <AuthScreen onAuthenticated={authenticate} error={`Could not connect to the laundry service: ${sessionError}`} />;
  return <Routes>
    <Route path="/" element={user ? <Navigate to={user.role === 'admin' ? '/admin/overview' : '/customer/overview'} replace /> : <AuthScreen onAuthenticated={authenticate} />} />
    <Route path="/customer" element={<Navigate to="/customer/overview" replace />} />
    <Route path="/admin" element={<Navigate to="/admin/overview" replace />} />
    <Route path="/customer/*" element={user?.role === 'customer' ? <Dashboard user={user} onUserUpdate={setUser} onSignOut={signOut} onSessionExpired={() => setUser(null)} /> : <Navigate to={user ? '/admin/overview' : '/'} replace state={{ from: location.pathname }} />} />
    <Route path="/admin/*" element={user?.role === 'admin' ? <Dashboard user={user} onUserUpdate={setUser} onSignOut={signOut} onSessionExpired={() => setUser(null)} /> : <Navigate to={user ? '/customer/overview' : '/'} replace state={{ from: location.pathname }} />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>;
}

function EmptyState({ title, hint, action }) {
  return <div className="empty-state"><strong>{title}</strong>{hint}{action && <div style={{ marginTop: 14 }}>{action}</div>}</div>;
}

function OrderCard({ order, admin, onDetails, onCancel, onStatus, onFinalPrice }) {
  const statusOptions = [order.status, ...(transitions[order.status] || [])];
  const canPrice = ['picked_up', 'processing', 'ready_for_delivery', 'out_for_delivery'].includes(order.status);
  const quantity = order.serviceSnapshot?.quantity ?? order.weightKg ?? '—';
  const serviceName = order.serviceSnapshot?.name || pretty(order.service);
  const totalLine = order.priceBreakdown?.finalTotal == null ? `${money(order.priceBreakdown?.estimatedTotal ?? order.amount)} estimate` : `${money(order.priceBreakdown.finalTotal)} final price`;
  return <article className="order-card">
    <div className="order-primary"><strong>{admin ? `${order.orderNumber} · ${serviceName}` : `${serviceName} · ${order.orderNumber}`}</strong><small>{quantity} {order.serviceSnapshot?.unit || 'kg'} · {order.address}</small>{admin && <small>{order.customer?.name || 'Customer'} · {order.customer?.phone || order.customer?.email || ''}</small>}</div>
    <div className="order-meta"><strong>{date(order.pickupAt)}</strong><small>{totalLine} · {pretty(order.paymentStatus)}</small></div>
    <span className={`status ${order.status}`}>{pretty(order.status)}</span>
    <div className="order-actions">
      <button type="button" className="text-button" onClick={() => onDetails(order)}>{admin ? 'Details' : 'Details / receipt'}</button>
      {admin ? <>
        <select className="status-select" value={order.status} onChange={event => onStatus(order, event.target.value)} aria-label={`Update order ${order.orderNumber} status`}>{statusOptions.map(status => <option value={status} key={status}>{pretty(status)}</option>)}</select>
        {canPrice && <button type="button" className="text-button" onClick={() => onFinalPrice(order)}>{order.priceBreakdown?.finalTotal == null ? 'Set final price' : 'Edit final price'}</button>}
      </> : ['booking_received', 'pickup_scheduled', 'placed', 'confirmed'].includes(order.status) && <button type="button" className="text-button danger-text" onClick={() => onCancel(order)}>Cancel</button>}
      <a className="map-link" href={mapUrl(order)} target="_blank" rel="noopener noreferrer">⌖ Map</a>
    </div>
  </article>;
}

function Pager({ page, pages, total, onPage }) {
  return <div className="pagination"><button className="button outline" disabled={page <= 1} onClick={() => onPage(Math.max(1, page - 1))}>← Previous</button><span>Page {page} of {Math.max(pages, 1)} · {total} orders</span><button className="button outline" disabled={page >= pages} onClick={() => onPage(Math.min(pages, page + 1))}>Next →</button></div>;
}

function Dashboard({ user, onUserUpdate, onSignOut, onSessionExpired }) {
  const admin = user.role === 'admin';
  const navigate = useNavigate();
  const currentRoute = useLocation();
  const view = currentRoute.pathname.split('/').filter(Boolean).at(-1) || 'overview';
  const [toast, setToast] = useState(null);
  const [modal, setModal] = useState(null);
  const closeModal = useCallback(() => setModal(null), []);
  const toastTimer = useRef(null);
  const say = useCallback((message, bad = false) => {
    setToast({ message, bad }); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), 3800);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const [services, setServices] = useState([]);
  const [settings, setSettings] = useState(null);
  const [orders, setOrders] = useState([]);
  const [summary, setSummary] = useState({});
  const [orderPage, setOrderPage] = useState(1);
  const [orderPages, setOrderPages] = useState(1);
  const [orderTotal, setOrderTotal] = useState(0);
  const [overview, setOverview] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [pageBusy, setPageBusy] = useState(false);
  const [orderBusy, setOrderBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const actionLock = useRef(false);
  const [filters, setFilters] = useState({ search: '', status: 'all', service: '', paymentStatus: '', from: '', to: '', sort: 'createdAt', direction: 'desc' });
  const [messageFolder, setMessageFolder] = useState('active');
  const [messages, setMessages] = useState([]);
  const [myMessages, setMyMessages] = useState([]);
  const [profile, setProfile] = useState({ name: user.name, phone: user.phone, address: user.addresses?.find(item => item.isDefault)?.address || user.addresses?.[0]?.address || '' });
  const [profileLocation, setProfileLocation] = useState(null);
  const [locationMessage, setLocationMessage] = useState('Optional · helps our pickup team find you');
  const [profileLocationMessage, setProfileLocationMessage] = useState('Optional · attach coordinates to your default address');
  const [customers, setCustomers] = useState([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerHistory, setCustomerHistory] = useState({});
  const [auditLogs, setAuditLogs] = useState([]);
  const [modalBusy, setModalBusy] = useState(false);
  const [draft, setDraft] = useState({ service: '', quantity: '3', pickupDate: '', pickupAt: '', address: '', notes: '' });
  const [bookingStep, setBookingStep] = useState(1);
  const [slots, setSlots] = useState([]);
  const [slotsBusy, setSlotsBusy] = useState(false);
  const [pickupLocation, setPickupLocation] = useState(null);
  const requestId = useRef(crypto.randomUUID());
  useEffect(() => {
    const timer = setTimeout(() => setCustomerQuery(customerSearch), 250);
    return () => clearTimeout(timer);
  }, [customerSearch]);

  const loadOrders = useCallback(async (page = 1, filterValues = filters) => {
    const params = { page, limit: 50 };
    if (admin) Object.assign(params, filterValues);
    const result = await api(`/orders?${queryString(params)}`);
    setOrders(result.orders); setSummary(result.summary || {}); setOrderPage(result.pagination.page);
    setOrderPages(result.pagination.pages); setOrderTotal(result.pagination.total);
    return result;
  }, [admin, filters]);
  const loadNotifications = useCallback(async () => {
    const result = await api('/notifications'); setNotifications(result.notifications); setUnreadNotifications(result.unread || 0);
  }, []);
  const loadOverview = useCallback(async () => {
    if (!admin) return;
    const result = await api('/admin/overview'); setOverview(result); setUnreadMessages(result.unreadMessages || 0);
  }, [admin]);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const [catalog, orderResult, notificationResult, adminSummary, adminCatalog] = await Promise.all([
          api('/services'), loadOrders(1, { ...filters, status: '', service: '', paymentStatus: '', from: '', to: '', search: '', sort: 'createdAt', direction: 'desc' }),
          api('/notifications'), admin ? api('/admin/overview') : Promise.resolve(null), admin ? api('/admin/services') : Promise.resolve(null)
        ]);
        if (!alive) return;
        setServices(adminCatalog?.services || catalog.services); setSettings(catalog.settings); setOrders(orderResult.orders); setSummary(orderResult.summary || {});
        setOrderPage(orderResult.pagination.page); setOrderPages(orderResult.pagination.pages); setOrderTotal(orderResult.pagination.total);
        setNotifications(notificationResult.notifications); setUnreadNotifications(notificationResult.unread || 0);
        if (adminSummary) { setOverview(adminSummary); setUnreadMessages(adminSummary.unreadMessages || 0); }
      } catch (error) {
        if (alive && error.status === 401) onSessionExpired();
        else if (alive) say(error.message, true);
      }
    };
    setPageBusy(true); refresh().finally(() => { if (alive) setPageBusy(false); });
    const timer = setInterval(refresh, 30000);
    return () => { alive = false; clearInterval(timer); };
  // The periodic refresh is deliberately role-scoped; filters are loaded by the orders view below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin, onSessionExpired, say]);

  useEffect(() => {
    let alive = true;
    async function loadCurrentView() {
      try {
        if (view === 'orders') await loadOrders(1);
        if (view === 'inbox') {
          const { messages: items } = await api(`/messages?archived=${messageFolder === 'archived'}`);
          if (alive) setMessages(items);
        }
        if (view === 'my-messages') {
          const { messages: items } = await api('/my-messages'); if (alive) setMyMessages(items);
        }
        if (view === 'profile') {
          const { user: current } = await api('/profile');
          if (alive) {
            const address = current.addresses?.find(item => item.isDefault) || current.addresses?.[0];
            setProfile({ name: current.name, phone: current.phone, address: address?.address || '' });
            setProfileLocation(address?.location || null);
          }
        }
        if (view === 'settings') {
          const { settings: current } = await api('/admin/settings'); if (alive) setSettings(current);
        }
        if (view === 'services') {
          const { services: items } = await api('/admin/services'); if (alive) setServices(items);
        }
        if (view === 'customers') await loadCustomers();
        if (view === 'audit') { const { logs } = await api('/admin/audit'); if (alive) setAuditLogs(logs); }
      } catch (error) {
        if (alive && error.status === 401) onSessionExpired(); else if (alive) say(error.message, true);
      }
    }
    async function loadCustomers() {
      const { customers: items } = await api(`/admin/customers?search=${encodeURIComponent(customerQuery)}`);
      if (alive) setCustomers(items);
    }
    loadCurrentView();
    return () => { alive = false; };
  }, [view, messageFolder, customerQuery, admin, loadOrders, filters, onSessionExpired, say]);

  useEffect(() => {
    if (view !== 'manage-orders') return undefined;
    const timer = setTimeout(() => loadOrders(1, filters).catch(error => say(error.message, true)), 280);
    return () => clearTimeout(timer);
  }, [view, filters, loadOrders, say]);

  const activeCount = useMemo(() => Object.entries(summary).filter(([status]) => !terminal(status)).reduce((sum, [, count]) => sum + count, 0), [summary]);
  const latest = orders.find(order => !terminal(order.status));
  const selectedService = services.find(service => service.slug === draft.service) || services.find(service => service.available);
  const estimate = useMemo(() => {
    if (!selectedService) return null;
    const subtotal = Number(draft.quantity || 0) * Number(selectedService.price);
    return subtotal + Number(settings?.deliveryFee || 0) + Math.max(0, Number(settings?.minimumOrderValue || 0) - subtotal);
  }, [selectedService, draft.quantity, settings]);
  useEffect(() => {
    if (!draft.service && services.some(service => service.available)) setDraft(value => ({ ...value, service: services.find(service => service.available).slug }));
  }, [services, draft.service]);

  const go = target => navigate(`/${admin ? 'admin' : 'customer'}/${target}`);
  const run = async (action, success) => {
    if (actionLock.current) return;
    actionLock.current = true; setSaving(true);
    try { await action(); if (success) say(success); }
    catch (error) { if (error.status === 401) onSessionExpired(); else say(error.message, true); }
    finally { actionLock.current = false; setSaving(false); }
  };
  async function fetchSlots(dateValue) {
    setDraft(value => ({ ...value, pickupAt: '' }));
    if (!dateValue) { setSlots([]); return; }
    setSlotsBusy(true);
    try { const result = await api(`/pickup-slots?date=${encodeURIComponent(dateValue)}`); setSlots(result.slots.filter(slot => slot.available)); }
    catch (error) { setSlots([]); say(error.message, true); }
    finally { setSlotsBusy(false); }
  }
  function locate(setCoordinates, setLabel, successPrefix) {
    if (!navigator.geolocation) return say('Location is not available in this browser.', true);
    navigator.geolocation.getCurrentPosition(position => {
      const coordinates = { lat: position.coords.latitude, lng: position.coords.longitude };
      setCoordinates(coordinates); setLabel(`${successPrefix} · ${coordinates.lat.toFixed(4)}, ${coordinates.lng.toFixed(4)}`);
    }, () => say('Could not read location. Check browser location permission.', true), { enableHighAccuracy: true, timeout: 10000 });
  }

  const onOrderSubmit = async event => {
    event.preventDefault();
    const payload = { service: draft.service, quantity: Number(draft.quantity), pickupAt: draft.pickupAt, address: draft.address, notes: draft.notes, location: pickupLocation, clientRequestId: requestId.current };
    setOrderBusy(true);
    try {
      const { order } = await api('/orders', { method: 'POST', headers: { 'Idempotency-Key': requestId.current }, body: JSON.stringify(payload) });
      requestId.current = crypto.randomUUID(); setDraft(value => ({ ...value, quantity: '3', pickupDate: '', pickupAt: '', address: '', notes: '' })); setPickupLocation(null); setSlots([]); setBookingStep(1); setLocationMessage('Optional · helps our pickup team find you');
      await loadOrders(1); say(`Pickup request ${order.orderNumber} received.`); go('orders');
    } catch (error) { if (error.status === 401) onSessionExpired(); else say(error.message, true); }
    finally { setOrderBusy(false); }
  };

  const openOrder = order => setModal({ kind: 'order', order });
  const cancelOrder = order => {
    const reason = window.prompt(`Reason for cancelling ${order.orderNumber}:`, 'Cancelled by customer');
    if (!reason?.trim()) return say('A reason is required.', true);
    if (!window.confirm(`Confirm cancellation for ${order.orderNumber}?`)) return;
    run(async () => { await api(`/orders/${order._id}/cancel`, { method: 'PATCH', body: JSON.stringify({ reason }) }); await loadOrders(orderPage); }, 'Order cancelled.');
  };
  const changeStatus = (order, status) => {
    let reason = '';
    if (['cancelled', 'rejected'].includes(status)) {
      reason = window.prompt(`Reason for ${status}:`);
      if (!reason?.trim()) return say('A reason is required.', true);
      if (!window.confirm(`Confirm ${status} for ${order.orderNumber}?`)) return;
    }
    run(async () => { await api(`/orders/${order._id}/status`, { method: 'PATCH', body: JSON.stringify({ status, reason }) }); await loadOrders(orderPage, filters); await loadOverview(); }, 'Order status updated.');
  };
  const setFinalPrice = order => setModal({ kind: 'quote', order, amount: order.priceBreakdown?.finalTotal ?? '', reason: '' });
  const exportOrders = async () => {
    const params = queryString({ ...filters, limit: 5000 });
    const response = await fetch(`${import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/$/, '') || ''}/api/admin/orders.csv?${params}`, { credentials: 'include' });
    if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || 'Export failed.'); }
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'muniyasamy-orders.csv'; anchor.click(); URL.revokeObjectURL(url);
  };
  const pageTitle = pageTitles[view]?.[admin ? 1 : 0] || pageTitles.overview[admin ? 1 : 0];
  const section = renderSection();

  function renderSection() {
    if (view === 'overview') return <>
      {!admin && <div className="welcome-card"><div><span className="eyebrow">YOUR LAUNDRY DASHBOARD</span><h2>A little more time for you.</h2><p>Book a pickup or check on the care we’re giving your clothes.</p><button className="button light" onClick={() => go('new-order')}>Schedule a pickup <span>→</span></button></div><div className="welcome-art" aria-hidden="true">◉<span>✳</span></div></div>}
      <div className="stats-grid">{admin ? <>
        <Stat icon="◷" title="Orders today" value={overview?.ordersToday ?? 0} hint="Bookings created today · IST" />
        <Stat icon="⌖" title="Upcoming pickups" value={overview?.upcomingPickups ?? 0} hint="Future pickups not yet completed" />
        <Stat icon="▫" title="Total orders" value={overview?.totalOrders || 0} hint="All bookings" />
        <Stat icon="↗" title="Pending pickup" value={(overview?.orders?.booking_received || 0) + (overview?.orders?.pickup_scheduled || 0)} hint="Scheduled and awaiting collection" />
        <Stat icon="↻" title="In progress" value={activeCount} hint="Active service stages" />
        <Stat icon="✓" title="Completed" value={overview?.orders?.delivered || 0} hint="Delivered orders" />
        <Stat icon="×" title="Cancelled" value={(overview?.orders?.cancelled || 0) + (overview?.orders?.rejected || 0)} hint="Cancelled or rejected" />
        <Stat icon="₹" title="Paid revenue" value={money(overview?.revenue || 0)} hint="Verified paid orders only" />
      </> : <>
        <Stat icon="▫" title="Total orders" value={orderTotal} hint="Your laundry bookings" />
        <Stat icon="↻" title="In progress" value={activeCount} hint="We’re taking care of it" />
        <Stat icon="✓" title="Completed" value={summary.delivered || 0} hint="Delivered with care" />
        <Stat icon="✳" title="Next pickup" value={latest ? date(latest.pickupAt).split(' at ')[0] : 'Whenever you’re ready'} hint={latest ? pretty(latest.status) : 'Book when it suits you'} compact={Boolean(latest)} />
      </>}</div>
      <div className="section-heading"><div><span className="eyebrow">RECENT ACTIVITY</span><h2>{admin ? 'Latest orders' : 'Recent orders'}</h2></div><button className="text-button" onClick={() => go(admin ? 'manage-orders' : 'orders')}>View all →</button></div>
      <OrdersList orders={orders.slice(0, 4)} admin={admin} onDetails={openOrder} onCancel={cancelOrder} onStatus={changeStatus} onFinalPrice={setFinalPrice} onBook={() => go('new-order')} />
      {!admin && <div className="message-cta"><div className="cta-icon">✉</div><div><strong>Have a question or special request?</strong><p>Send a note straight to our laundry team.</p></div><button className="button outline" onClick={() => setModal({ kind: 'message' })}>Message us <span>→</span></button></div>}
    </>;
    if (view === 'orders' || view === 'manage-orders') return <>
      <div className="section-heading"><div><span className="eyebrow">{admin ? 'FULFILMENT WORKSPACE' : 'YOUR SERVICE HISTORY'}</span><h2>{admin ? 'Manage orders' : 'Orders'}</h2></div>{admin ? <div className="admin-toolbar">
        <input type="search" placeholder="Order, customer or phone" value={filters.search} onChange={event => updateFilter('search', event.target.value)} aria-label="Search orders" />
        <select value={filters.status} onChange={event => updateFilter('status', event.target.value)} aria-label="Filter by status"><option value="all">All statuses</option>{['booking_received', 'pickup_scheduled', 'picked_up', 'processing', 'ready_for_delivery', 'out_for_delivery', 'delivered', 'cancelled', 'rejected'].map(status => <option key={status} value={status}>{pretty(status)}</option>)}</select>
        <select value={filters.service} onChange={event => updateFilter('service', event.target.value)} aria-label="Filter by service"><option value="">All services</option>{services.map(service => <option key={service.slug} value={service.slug}>{service.name}</option>)}</select>
        <select value={filters.paymentStatus} onChange={event => updateFilter('paymentStatus', event.target.value)} aria-label="Filter by payment"><option value="">All payments</option><option value="unpaid">Unpaid</option><option value="paid">Paid</option></select>
        <label>From<input type="date" value={filters.from} onChange={event => updateFilter('from', event.target.value)} /></label><label>To<input type="date" value={filters.to} onChange={event => updateFilter('to', event.target.value)} /></label>
        <select value={filters.sort} onChange={event => updateFilter('sort', event.target.value)} aria-label="Sort orders"><option value="createdAt">Newest first</option><option value="pickupAt">Pickup date</option><option value="amount">Price estimate</option><option value="status">Status</option></select>
        <select value={filters.direction} onChange={event => updateFilter('direction', event.target.value)} aria-label="Sort direction"><option value="desc">Descending</option><option value="asc">Ascending</option></select>
        <button className="button outline" disabled={saving} onClick={() => run(exportOrders, 'CSV export downloaded.')}>Export CSV</button>
      </div> : <button className="button primary" onClick={() => go('new-order')}>＋ New order</button>}</div>
      {pageBusy && !orders.length ? <Loading label="Loading orders…" /> : <OrdersList orders={orders} admin={admin} onDetails={openOrder} onCancel={cancelOrder} onStatus={changeStatus} onFinalPrice={setFinalPrice} onBook={() => go('new-order')} />}
      <Pager page={orderPage} pages={orderPages} total={orderTotal} onPage={page => loadOrders(page, admin ? filters : {}).catch(error => say(error.message, true))} />
    </>;
    if (view === 'new-order') return <>
      <div className="section-heading"><div><span className="eyebrow">PICKUP BOOKING</span><h2>Let’s get your laundry sorted.</h2><p>Choose a service and we’ll take it from here.</p></div></div>
      <ol className="booking-progress" aria-label="Booking progress">{['Service', 'Pickup', 'Review'].map((label, index) => <li key={label} className={bookingStep === index + 1 ? 'current' : bookingStep > index + 1 ? 'complete' : ''} aria-current={bookingStep === index + 1 ? 'step' : undefined}><span>{index + 1}</span>{label}</li>)}</ol>
      <form className="form-card" onSubmit={onOrderSubmit}>
        {bookingStep === 1 && <div className="form-grid">
          <label className="span-2">Choose a service<select required value={draft.service} onChange={event => setDraft(value => ({ ...value, service: event.target.value }))}><option value="">Choose a service</option>{services.filter(service => service.available).map(service => <option value={service.slug} key={service.slug}>{service.name} · {money(service.price)}/{service.unit}</option>)}</select></label>
          <label className="span-2">Quantity<input type="number" min={selectedService?.minimumQuantity || 1} max="100" step={selectedService?.unit === 'piece' ? '1' : '0.1'} required value={draft.quantity} onChange={event => setDraft(value => ({ ...value, quantity: event.target.value }))} /><small>Price per {selectedService?.unit || 'unit'}; minimum {selectedService?.minimumQuantity || 1}.</small></label>
          <div className="span-2 booking-actions"><button type="button" className="button primary" onClick={event => { if (event.currentTarget.form.reportValidity()) setBookingStep(2); }}>Continue to pickup <span>→</span></button></div>
        </div>}
        {bookingStep === 2 && <div className="form-grid">
          <label className="span-2">Pickup date<input type="date" required min={indiaToday()} value={draft.pickupDate} onChange={event => { setDraft(value => ({ ...value, pickupDate: event.target.value })); fetchSlots(event.target.value); }} /></label>
          <label className="span-2">Available pickup window<select required disabled={!draft.pickupDate || slotsBusy || !slots.length} value={draft.pickupAt} onChange={event => setDraft(value => ({ ...value, pickupAt: event.target.value }))}><option value="">{slotsBusy ? 'Loading available pickup windows…' : !draft.pickupDate ? 'Choose a date first' : slots.length ? 'Choose a pickup window' : 'No pickup windows available for this date'}</option>{slots.map(slot => <option key={slot.start} value={slot.start}>{slot.label} – {time(slot.end)}</option>)}</select><small>Times are shown in India Standard Time. Availability is checked again when you book.</small></label>
          <label className="span-2">Pickup address<textarea rows="3" required maxLength="300" placeholder="House / street, area, Madurai" value={draft.address} onChange={event => setDraft(value => ({ ...value, address: event.target.value }))} /></label>
          <div className="span-2 location-row"><button type="button" className="button outline" onClick={() => locate(setPickupLocation, setLocationMessage, 'Location attached')}>⌖ Use my current location</button><span>{pickupLocation ? `Location attached · ${pickupLocation.lat.toFixed(4)}, ${pickupLocation.lng.toFixed(4)}` : locationMessage}</span></div>
          <div className="span-2 booking-actions"><button type="button" className="button outline" onClick={() => setBookingStep(1)}>Back</button><button type="button" className="button primary" onClick={event => { if (event.currentTarget.form.reportValidity()) setBookingStep(3); }}>Review booking <span>→</span></button></div>
        </div>}
        {bookingStep === 3 && <div className="form-grid">
          <div className="booking-review span-2"><h3>Review your pickup</h3><p><strong>Service:</strong> {selectedService?.name || 'Choose a service'} · {draft.quantity} {selectedService?.unit || ''}</p><p><strong>Pickup:</strong> {draft.pickupAt ? `${date(draft.pickupAt)} · ${time(draft.pickupAt)}` : 'Choose a pickup window'}</p><p><strong>Address:</strong> {draft.address || 'Add a pickup address'}</p></div>
          <label className="span-2">Anything we should know?<textarea rows="2" maxLength="1000" placeholder="Stains, delicate items, gate instructions…" value={draft.notes} onChange={event => setDraft(value => ({ ...value, notes: event.target.value }))} /></label>
          <div className="price-estimate span-2"><span>Estimated total <small>Estimate includes configured fees. The final price is confirmed after assessment.</small></span><strong>{estimate == null ? '—' : money(estimate)}</strong></div>
          <div className="span-2 booking-actions"><button type="button" className="button outline" onClick={() => setBookingStep(2)}>Back</button><button className="button primary" type="submit" disabled={orderBusy || !draft.pickupAt || !draft.address || !services.some(service => service.available)}>{orderBusy ? 'Placing request…' : 'Confirm pickup request'} <span>→</span></button></div>
        </div>}
      </form>
    </>;
    if (view === 'profile') return <>
      <div className="section-heading"><div><span className="eyebrow">ACCOUNT SETTINGS</span><h2>Your profile & pickup addresses</h2><p>Keep your contact details and preferred pickup location up to date.</p></div></div>
      <form className="form-card" onSubmit={event => { event.preventDefault(); run(async () => { const addresses = profile.address.trim() ? [{ label: 'Home', address: profile.address.trim(), location: profileLocation, isDefault: true }] : []; const { user: updated } = await api('/profile', { method: 'PATCH', body: JSON.stringify({ name: profile.name, phone: profile.phone, addresses }) }); setProfile(value => ({ ...value, name: updated.name, phone: updated.phone })); onUserUpdate(updated); say('Profile saved.'); }, null); }}><div className="form-grid">
        <label>Name<input required maxLength="80" value={profile.name} onChange={event => setProfile(value => ({ ...value, name: event.target.value }))} /></label><label>Phone<input required maxLength="20" value={profile.phone} onChange={event => setProfile(value => ({ ...value, phone: event.target.value }))} /></label>
        <label className="span-2">Default pickup address<textarea rows="3" maxLength="300" placeholder="Street, area, Madurai" value={profile.address} onChange={event => setProfile(value => ({ ...value, address: event.target.value }))} /></label>
        <div className="span-2 location-row"><button type="button" className="button outline" onClick={() => locate(setProfileLocation, setProfileLocationMessage, 'Coordinates attached')}>⌖ Save my current location</button><span>{profileLocation ? `Coordinates attached · ${profileLocation.lat.toFixed(4)}, ${profileLocation.lng.toFixed(4)}` : profileLocationMessage}</span></div>
        <div className="span-2"><button className="button primary" disabled={saving}>Save profile</button></div>
      </div></form>
    </>;
    if (view === 'notifications') return <>
      <SectionHeading eyebrow="ORDER UPDATES" title="Notifications" subtitle="Important changes to your bookings show here." />
      <div className="messages-list">{notifications.length ? notifications.map(item => <article className={`notification-row ${item.readAt ? '' : 'unread'}`} key={item._id}><div><strong>{item.title}</strong><small>{item.body} · {date(item.createdAt)}</small></div>{!item.readAt && <button className="text-button" onClick={() => run(async () => { await api(`/notifications/${item._id}/read`, { method: 'PATCH', body: '{}' }); await loadNotifications(); }, 'Notification marked read.')}>Mark read</button>}</article>) : <EmptyState title="All caught up" hint="Order and service updates will appear here." />}</div>
    </>;
    if (view === 'my-messages') return <>
      <div className="section-heading"><div><span className="eyebrow">CUSTOMER CARE</span><h2>Your messages</h2><p>Questions and team replies stay together here.</p></div><button className="button outline" onClick={() => setModal({ kind: 'message' })}>Message the team</button></div>
      <div className="messages-list">{myMessages.length ? myMessages.map(item => <article className="message-card" key={item._id}><div className="message-head"><div><strong>Your message</strong><small>{date(item.createdAt)}</small></div></div><p className="message-body">{item.body}</p><div className="message-reply">{item.reply ? <><strong>Muniyasamy Laundry · {date(item.repliedAt)}</strong><br />{item.reply}</> : 'Our team has received this message and will get back to you.'}</div></article>) : <EmptyState title="No messages yet" hint="Send a question or special request to our laundry team." />}</div>
    </>;
    if (view === 'inbox') return <>
      <div className="section-heading"><div><span className="eyebrow">CUSTOMER CARE</span><h2>Your inbox</h2><p>Messages sent from the website and customer portal.</p></div><select value={messageFolder} onChange={event => setMessageFolder(event.target.value)} aria-label="Choose message folder"><option value="active">Open messages</option><option value="archived">Archived messages</option></select></div>
      <div className="messages-list">{messages.length ? messages.map(item => <MessageCard key={item._id} message={item} archived={messageFolder === 'archived'} onUpdate={async payload => { await api(`/messages/${item._id}`, { method: 'PATCH', body: JSON.stringify(payload) }); const result = await api(`/messages?archived=${messageFolder === 'archived'}`); setMessages(result.messages); await loadOverview(); say(payload.reply ? 'Reply saved.' : 'Inbox updated.'); }} />) : <EmptyState title="Your inbox is clear" hint="Website enquiries and customer requests land here." />}</div>
    </>;
    if (view === 'services') return <>
      <SectionHeading eyebrow="CATALOG MANAGEMENT" title="Services & pricing" subtitle="Changes apply to new estimates. Existing order quotes remain unchanged." />
      <div className="orders-list">{services.map(service => <ServiceRow key={service._id} service={service} onChange={(patch, success) => run(async () => { await api(`/admin/services/${service._id}`, { method: 'PATCH', body: JSON.stringify(patch) }); const result = await api('/admin/services'); setServices(result.services); }, success)} />)}</div>
      <form className="form-card" onSubmit={event => { event.preventDefault(); const form = event.currentTarget; const body = Object.fromEntries(new FormData(form)); run(async () => { await api('/admin/services', { method: 'POST', body: JSON.stringify(body) }); form.reset(); const result = await api('/admin/services'); setServices(result.services); }, 'Service added.'); }}><h3>Add a laundry service</h3><div className="form-grid"><label>Service name<input name="name" required maxLength="80" /></label><label>Service ID<input name="slug" required pattern="[a-z0-9-]+" placeholder="special-care" /></label><label>Price (₹)<input name="price" type="number" min="0" step="0.01" required /></label><label>Unit<select name="unit"><option value="kg">Kilogram</option><option value="piece">Piece</option></select></label><label className="span-2">Description<input name="description" maxLength="300" /></label><div className="span-2"><button className="button primary" disabled={saving}>Add service</button></div></div></form>
    </>;
    if (view === 'settings') return <>
      <SectionHeading eyebrow="STORE CONFIGURATION" title="Business & pickup settings" subtitle="Pickup windows use India Standard Time." />
      {settings && <form className="form-card" onSubmit={event => { event.preventDefault(); const form = event.currentTarget; const data = Object.fromEntries(new FormData(form)); Object.keys(data).forEach(key => { if (key !== 'businessDays') data[key] = Number(data[key]); }); data.businessDays = new FormData(form).getAll('businessDays').map(Number); run(async () => { const result = await api('/admin/settings', { method: 'PATCH', body: JSON.stringify(data) }); setSettings(result.settings); }, 'Business settings saved.'); }}>
        <div className="form-grid"><label>Doorstep delivery fee (₹)<input name="deliveryFee" type="number" min="0" step="0.01" defaultValue={settings.deliveryFee} /></label><label>Minimum order value (₹)<input name="minimumOrderValue" type="number" min="0" step="0.01" defaultValue={settings.minimumOrderValue} /></label><label>Opening hour (0–23)<input name="openHour" type="number" min="0" max="23" defaultValue={settings.openHour} /></label><label>Closing hour (1–24)<input name="closeHour" type="number" min="1" max="24" defaultValue={settings.closeHour} /></label><label>Bookings per pickup slot<input name="slotCapacity" type="number" min="1" max="100" defaultValue={settings.slotCapacity} /></label><label>Slot duration (minutes)<input name="slotDurationMinutes" type="number" min="30" max="240" step="30" defaultValue={settings.slotDurationMinutes} /></label>
          <fieldset className="span-2"><legend>Pickup days</legend><div className="weekday-options">{['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((day, index) => <label key={day}><input type="checkbox" name="businessDays" value={index} defaultChecked={(settings.businessDays || []).includes(index)} /> {day}</label>)}</div></fieldset><div className="span-2"><button className="button primary" disabled={saving}>Save settings</button></div>
        </div></form>}
    </>;
    if (view === 'customers') return <>
      <div className="section-heading"><div><span className="eyebrow">CUSTOMER DIRECTORY</span><h2>Customers</h2></div><input id="customer-search" type="search" placeholder="Search name, email or phone" value={customerSearch} onChange={event => setCustomerSearch(event.target.value)} /></div>
      <div className="orders-list">{customers.length ? customers.map(customer => <article className="customer-row" key={customer._id}><div><strong>{customer.name} · {customer.phone}</strong><small>{customer.email} · {customer.orderCount} orders{customer.lastOrder ? ` · last order ${date(customer.lastOrder)}` : ''}</small>{customerHistory[customer._id] && <div className="customer-history">{customerHistory[customer._id].map(order => <div className="customer-order-line" key={order._id}><strong>{order.orderNumber} · {order.serviceSnapshot?.name || pretty(order.service)}</strong><small>{pretty(order.status)} · {date(order.pickupAt)} · {money(order.priceBreakdown?.finalTotal ?? order.amount)}</small></div>)}</div>}</div><div><a className="text-button" href={`tel:${encodeURIComponent(customer.phone)}`}>Call customer</a> <button className="text-button" onClick={() => run(async () => { if (customerHistory[customer._id]) { setCustomerHistory(value => { const next = { ...value }; delete next[customer._id]; return next; }); return; } const result = await api(`/admin/customers/${customer._id}/orders`); setCustomerHistory(value => ({ ...value, [customer._id]: result.orders })); })}>{customerHistory[customer._id] ? 'Hide history' : 'Order history'}</button></div></article>) : <EmptyState title="No customers match" hint="Try a different name, email or phone." />}</div>
    </>;
    if (view === 'audit') return <><SectionHeading eyebrow="ADMINISTRATIVE HISTORY" title="Audit log" subtitle="Recent administrative changes and actions." /><div className="messages-list">{auditLogs.length ? auditLogs.map(log => <article className="audit-row" key={log._id}><div><strong>{log.action}</strong><small>{log.actor?.name || 'Admin'} · {log.targetType} {log.targetId} · {date(log.createdAt)} {Object.keys(log.details || {}).length ? `· ${JSON.stringify(log.details)}` : ''}</small></div></article>) : <EmptyState title="No admin activity yet" hint="Order and settings changes are logged here." />}</div></>;
    return <EmptyState title="Page not found" hint="Choose a section from the workspace navigation." />;
  }

  function updateFilter(key, value) { setFilters(current => ({ ...current, [key]: value })); }

  const activeCountNav = orderTotal || 0;
  return <div className="app-shell">
    <aside className="sidebar"><a className="brand" href={publicSiteHref}><img className="brand-logo" src="/assets/images/muniyasamy-mark.svg" alt="" /><span>Muniyasamy<span className="brand-sub">LAUNDRY SERVICES</span></span></a>
      <div className="identity"><div className="avatar">{user.name.slice(0, 1).toUpperCase()}</div><div><strong>{user.name}</strong><small>{admin ? 'Administrator' : 'Customer account'}</small></div></div>
      <nav className={`nav ${admin ? 'admin-view' : ''}`} aria-label="Workspace navigation"><p className="nav-label">WORKSPACE</p>
        {commonNav.map(([key, icon, label]) => <NavLink key={key} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} to={`/${admin ? 'admin' : 'customer'}/${key}`}><span>{icon}</span>{label}{key === 'orders' && <span className="nav-count">{activeCountNav || ''}</span>}{key === 'notifications' && unreadNotifications > 0 && <span className="nav-count alert">{unreadNotifications}</span>}</NavLink>)}
        {adminNav.map(([key, icon, label]) => <NavLink key={key} className={({ isActive }) => `nav-link admin-only ${isActive ? 'active' : ''}`} to={`/admin/${key}`}><span>{icon}</span>{label}{key === 'inbox' && unreadMessages > 0 && <span className="nav-count alert">{unreadMessages}</span>}</NavLink>)}
      </nav>
      <div className="sidebar-bottom"><a href={publicSiteHref}>← Back to website</a><button type="button" onClick={onSignOut}>Sign out <span>↗</span></button><p>Need help? <a href="tel:9843911292">Call 98439 11292</a></p></div>
    </aside>
    <main className="main-area"><header className="topbar"><div><span className="eyebrow">MUNIASAMY LAUNDRY · MADURAI</span><h1>{pageTitle}</h1></div><div className="topbar-actions"><span className="open-indicator"><i /> Here to help</span><a className="icon-button" href="https://maps.google.com/?q=Muniyasamy+Laundry+Madurai" target="_blank" rel="noopener noreferrer" aria-label="Open laundry location in Google Maps">⌖</a><button type="button" className="mobile-signout" onClick={onSignOut}><span aria-hidden="true">↗</span> Sign out</button></div></header>
      {toast && <div className={`toast ${toast.bad ? 'bad' : ''}`} role={toast.bad ? 'alert' : 'status'} aria-live="polite">{toast.message}</div>}
      <section className="view">{section}</section>
      <footer className="footer">Muniyasamy Laundry · Kulamangalam Main Road, Madurai <span>Thoughtful care, every load.</span></footer>
    </main>
    {modal && <PortalModal modal={modal} busy={modalBusy} setBusy={setModalBusy} close={closeModal} onError={message => say(message, true)} user={user} services={services} onSaveMessage={async message => { await api('/messages', { method: 'POST', body: JSON.stringify({ name: user.name, email: user.email, phone: user.phone, message }) }); setModal(null); say('Message sent to the laundry team.'); if (view === 'my-messages') { const result = await api('/my-messages'); setMyMessages(result.messages); } }} onSaveQuote={async (order, amount, reason) => { await api(`/orders/${order._id}/quote`, { method: 'PATCH', body: JSON.stringify({ finalTotal: Number(amount), reason }) }); setModal(null); await loadOrders(orderPage, filters); await loadNotifications(); say('Final price saved and customer notified.'); }} onSaveOrder={async (order, body) => { await api(`/orders/${order._id}`, { method: 'PUT', body: JSON.stringify(body) }); setModal(null); await loadOrders(orderPage, filters); say('Booking updated.'); }} onPrint={printReceipt} />}
  </div>;

  function printReceipt(order) {
    const popup = window.open('', '_blank', 'width=720,height=800');
    if (!popup) return say('Allow pop-ups to print your receipt.', true);
    const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
    const breakdown = order.priceBreakdown || {};
    popup.opener = null;
    popup.document.write(`<!doctype html><html><head><title>Receipt ${esc(order.orderNumber)}</title><meta name="viewport" content="width=device-width"><style>body{font:15px Arial;color:#18344d;max-width:680px;margin:40px auto;padding:0 24px}h1{font-size:23px}dl{display:grid;grid-template-columns:1fr 1fr;gap:14px}dt{font-size:12px;color:#71849a}dd{margin:4px 0 0;font-weight:bold}hr{border:0;border-top:1px solid #e4ebf1;margin:24px 0}</style></head><body><h1>Muniyasamy Laundry</h1><p>Order receipt · ${esc(order.orderNumber)}</p><hr><dl><div><dt>Service</dt><dd>${esc(order.serviceSnapshot?.name || pretty(order.service))}</dd></div><div><dt>Status</dt><dd>${esc(pretty(order.status))}</dd></div><div><dt>Pickup</dt><dd>${esc(date(order.pickupAt))}</dd></div><div><dt>Quantity</dt><dd>${esc(order.serviceSnapshot?.quantity ?? order.weightKg)} ${esc(order.serviceSnapshot?.unit || 'kg')}</dd></div><div><dt>Address</dt><dd>${esc(order.address)}</dd></div><div><dt>Service subtotal</dt><dd>${money(breakdown.subtotal)}</dd></div><div><dt>Pickup fee</dt><dd>${money(breakdown.deliveryFee)}</dd></div><div><dt>Estimated total</dt><dd>${money(breakdown.finalTotal ?? breakdown.estimatedTotal ?? order.amount)}</dd></div></dl><hr><p>Thank you for choosing Muniyasamy Laundry.</p></body></html>`);
    popup.document.close(); setTimeout(() => { if (!popup.closed) popup.print(); }, 200);
  }
}

function Stat({ icon, title, value, hint, compact = false }) {
  return <article className="stat-card"><span className="stat-icon">{icon}</span><span>{title}</span><strong style={compact ? { fontSize: 15 } : undefined}>{value}</strong><small>{hint}</small></article>;
}
function SectionHeading({ eyebrow, title, subtitle }) { return <div className="section-heading"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div></div>; }
function OrdersList({ orders, admin, onDetails, onCancel, onStatus, onFinalPrice, onBook }) {
  return <div className="orders-list">{orders.length ? orders.map(order => <OrderCard key={order._id} order={order} admin={admin} onDetails={onDetails} onCancel={onCancel} onStatus={onStatus} onFinalPrice={onFinalPrice} />) : <EmptyState title="No orders here yet" hint={admin ? 'New bookings will appear in the queue.' : 'Your laundry story starts with a pickup.'} action={!admin && <button className="button primary" onClick={onBook}>Book a pickup →</button>} />}</div>;
}
function MessageCard({ message, archived, onUpdate }) {
  const [reply, setReply] = useState(message.reply || '');
  const [busy, setBusy] = useState(false);
  async function save(payload) { setBusy(true); try { await onUpdate(payload); } finally { setBusy(false); } }
  return <article className={`message-card ${message.readAt ? '' : 'unread'}`}><div className="message-head"><div><strong>{message.name} {!message.readAt && <span className="status" style={{ marginLeft: 6 }}>New</span>}</strong><small>{message.email} {message.phone && `· ${message.phone}`} {message.locationName && `· ${message.locationName}`} · {date(message.createdAt)}</small></div></div><p className="message-body">{message.body}</p>{message.reply && <div className="message-reply"><strong>Team reply saved · {date(message.repliedAt)}</strong><br />{message.reply}</div>}<div className="message-tools"><textarea value={reply} onChange={event => setReply(event.target.value)} maxLength="2000" placeholder="Write a reply (saved for the record)…" aria-label={`Reply to ${message.name}`} /><button disabled={busy || !reply.trim()} onClick={() => save({ reply, read: true })}>Save reply</button>{!message.readAt && <button disabled={busy} onClick={() => save({ read: true })}>Mark read</button>}<button disabled={busy} onClick={() => save({ archived: !archived, read: true })}>{archived ? 'Restore' : 'Archive'}</button></div></article>;
}
function ServiceRow({ service, onChange }) {
  const [price, setPrice] = useState(service.price);
  return <article className="service-row"><div><strong>{service.name} · {money(service.price)}/{service.unit}</strong><small>{service.description} · minimum {service.minimumQuantity} · {service.available ? 'Available' : 'Paused'}</small></div><div className="service-admin-actions"><label>₹ <input type="number" min="0" step="0.01" value={price} onChange={event => setPrice(event.target.value)} onBlur={() => { if (Number(price) !== Number(service.price)) onChange({ price: Number(price) }, 'New price saved. Past quotes are unchanged.'); }} aria-label={`Price for ${service.name}`} /></label><button className="button outline" onClick={() => onChange({ available: !service.available }, 'Service availability updated.')}>{service.available ? 'Pause' : 'Enable'}</button></div></article>;
}
function PortalModal({ modal, busy, setBusy, close, onError, user, services, onSaveMessage, onSaveQuote, onSaveOrder, onPrint }) {
  const dialogRef = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const onKey = event => {
      if (event.key === 'Escape' && !busy) { close(); return; }
      if (event.key !== 'Tab') return;
      const focusable = [...(dialogRef.current?.querySelectorAll('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href]') || [])].filter(element => element.getClientRects().length);
      if (!focusable.length) return;
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    dialogRef.current?.querySelector('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled])')?.focus();
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); if (previous?.isConnected) previous.focus(); };
  }, [busy, close]);
  async function submit(event, save) {
    event.preventDefault(); const form = event.currentTarget; setBusy(true);
    try { await save(form); } catch (error) { onError(error.message); } finally { setBusy(false); }
  }
  if (modal.kind === 'message') return <section ref={dialogRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="message-title" onMouseDown={event => { if (event.target === event.currentTarget && !busy) close(); }}><form className="modal-card" onSubmit={event => submit(event, form => onSaveMessage(new FormData(form).get('message')))}><button type="button" className="modal-close" onClick={close} aria-label="Close">×</button><span className="eyebrow">WE’RE LISTENING</span><h2 id="message-title">Send our team a message.</h2><label>Your message<textarea name="message" rows="5" placeholder="Tell us how we can help…" required maxLength="2000" /></label><button className="button primary" disabled={busy}>Send message <span>→</span></button></form></section>;
  if (modal.kind === 'quote') return <section ref={dialogRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="quote-title" onMouseDown={event => { if (event.target === event.currentTarget && !busy) close(); }}><form className="modal-card" onSubmit={event => submit(event, form => { const data = new FormData(form); return onSaveQuote(modal.order, data.get('finalTotal'), data.get('reason')); })}><button type="button" className="modal-close" onClick={close} aria-label="Close">×</button><span className="eyebrow">FINAL ORDER PRICE</span><h2 id="quote-title">{modal.order.orderNumber}</h2><label>Final amount (₹)<input name="finalTotal" type="number" min="0" max="1000000" step="0.01" defaultValue={modal.amount} required /></label><label>Weighing or adjustment note<textarea name="reason" rows="3" minLength="3" maxLength="300" required /></label><button className="button primary" disabled={busy}>Save final price</button></form></section>;
  if (modal.kind === 'order') return <OrderDialog dialogRef={dialogRef} modal={modal} close={close} busy={busy} setBusy={setBusy} services={services} onSaveOrder={onSaveOrder} onPrint={onPrint} user={user} />;
  return null;
}

function OrderDialog({ dialogRef, modal, close, busy, setBusy, services, onSaveOrder, onPrint, user }) {
  const order = modal.order;
  const canEdit = user.role !== 'admin' && ['booking_received', 'placed'].includes(order.status);
  const breakdown = order.priceBreakdown || { subtotal: order.amount, estimatedTotal: order.amount };
  return <section ref={dialogRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="order-detail-title" onMouseDown={event => { if (event.target === event.currentTarget && !busy) close(); }}><article className="modal-card order-detail-modal"><button type="button" className="modal-close" onClick={close} aria-label="Close">×</button>
    <span className="eyebrow">ORDER RECEIPT · {order.orderNumber}</span><h2 id="order-detail-title">{order.serviceSnapshot?.name || pretty(order.service)}</h2>
    <div className="order-detail-grid">{user.role === 'admin' && <><Detail label="Customer" value={order.customer?.name || 'Customer'} /><Detail label="Customer contact" value={`${order.customer?.phone || ''}${order.customer?.email ? ` · ${order.customer.email}` : ''}`} /></>}<Detail label="Status" value={pretty(order.status)} /><Detail label="Pickup time" value={date(order.pickupAt)} /><Detail label="Quantity" value={`${order.serviceSnapshot?.quantity ?? order.weightKg} ${order.serviceSnapshot?.unit || 'kg'}`} /><Detail label="Address" value={order.address} /><Detail label="Service subtotal" value={money(breakdown.subtotal)} /><Detail label="Pickup fee" value={money(breakdown.deliveryFee)} /><Detail label="Minimum order adjustment" value={money(breakdown.minimumAdjustment)} /><Detail label={breakdown.finalTotal == null ? 'Estimated total' : 'Final confirmed price'} value={money(breakdown.finalTotal ?? breakdown.estimatedTotal)} /><Detail label="Payment" value={pretty(order.paymentStatus)} /><Detail label="Notes" value={order.notes || '—'} /></div>
    <h3>Order updates</h3><ol>{order.statusHistory?.map((item, index) => <li key={`${item.status}-${item.at}-${index}`}>{pretty(item.status)} · {date(item.at)}{item.actor?.name && ` · ${item.actor.name} (${item.actorRole || item.actor.role || 'team'})`}{item.note && ` · ${item.note}`}</li>) || <li>Booking received</li>}</ol>
    <button className="button primary" onClick={() => onPrint(order)}>Print receipt</button>
    {canEdit && <form className="edit-order-form" onSubmit={event => { event.preventDefault(); const form = event.currentTarget; const data = Object.fromEntries(new FormData(form)); data.quantity = Number(data.quantity); setBusy(true); onSaveOrder(order, data).catch(error => onError(error.message)).finally(() => setBusy(false)); }}><h3>Edit booking before confirmation</h3><div className="form-grid"><label>Service<select name="service" defaultValue={order.service}>{services.filter(item => item.available).map(item => <option key={item.slug} value={item.slug}>{item.name}</option>)}</select></label><label>Quantity<input name="quantity" type="number" min="1" max="100" step="0.1" defaultValue={order.serviceSnapshot?.quantity ?? order.weightKg ?? 1} required /></label><label className="span-2">Pickup date & time<input name="pickupAt" type="datetime-local" defaultValue={localDateTime(order.pickupAt)} required /></label><label className="span-2">Pickup address<textarea name="address" rows="2" defaultValue={order.address} required /></label><label className="span-2">Notes<textarea name="notes" rows="2" defaultValue={order.notes || ''} /></label><div className="span-2"><button className="button outline" disabled={busy}>Save booking changes</button></div></div></form>}
  </article></section>;
}
function Detail({ label, value }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
function indiaToday() { return new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10); }

export default function App() { return <PortalApp />; }
