(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = { user: null, orders: [], services: [], notifications: [], summary: {}, view: 'overview', page: 1, pages: 1, location: null, requestId: crypto.randomUUID() };
  let focusReturn = null;
  const transitions = {
    booking_received: ['pickup_scheduled', 'cancelled', 'rejected'], pickup_scheduled: ['picked_up', 'cancelled', 'rejected'],
    picked_up: ['processing'], processing: ['ready_for_delivery'], ready_for_delivery: ['out_for_delivery'],
    out_for_delivery: ['delivered'], delivered: [], cancelled: [], rejected: [], placed: ['pickup_scheduled', 'cancelled', 'rejected'],
    confirmed: ['picked_up', 'cancelled', 'rejected'], ready: ['out_for_delivery']
  };
  const friendly = { booking_received: 'Booking received', pickup_scheduled: 'Pickup scheduled', picked_up: 'Picked up', processing: 'Processing', ready_for_delivery: 'Ready for delivery', out_for_delivery: 'Out for delivery', delivered: 'Delivered', cancelled: 'Cancelled', rejected: 'Not accepted', placed: 'Booking received', confirmed: 'Pickup scheduled', ready: 'Ready for delivery' };
  const pretty = value => friendly[value] || String(value || '').replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const date = value => value ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(value)) : '—';
  const money = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value) || 0);
  const terminal = status => ['delivered', 'cancelled', 'rejected'].includes(status);
  const isAdmin = () => state.user?.role === 'admin';

  if (window.location.protocol === 'file:') {
    $('#auth-screen').classList.add('hidden');
    $('#file-warning').classList.remove('hidden');
    (async () => {
      for (const origin of ['http://localhost:5500', 'http://localhost:4000']) {
        try {
          await fetch(`${origin}/api/health`, { mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(1200) });
          window.location.replace(`${origin}/portal.html`);
          return;
        } catch { /* Keep the setup instructions visible if this port is not running. */ }
      }
    })();
    return;
  }

  async function api(url, options = {}) {
    if (window.location.protocol === 'file:') throw new Error('Open the portal at http://localhost:4000/portal.html while the Express server is running.');
    const response = await fetch(`/api${url}`, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
    const type = response.headers.get('content-type') || '';
    const payload = type.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) throw new Error(payload?.error || 'Request failed. Please try again.');
    return payload;
  }
  function toast(message, bad = false) {
    const el = $('#toast'); el.textContent = message; el.classList.toggle('bad', bad); el.classList.remove('hidden');
    clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.add('hidden'), 3800);
  }
  function openDialog(selector) {
    focusReturn = document.activeElement;
    const dialog = $(selector); dialog.classList.remove('hidden');
    dialog.querySelector('button, input, textarea, select')?.focus();
  }
  function closeDialog(selector) {
    $(selector).classList.add('hidden');
    if (focusReturn?.isConnected) focusReturn.focus();
  }
  function setBusy(form, busy, label) {
    const button = $('button[type="submit"],button:not([type])', form);
    if (!button) return;
    if (busy) { button.dataset.label = button.textContent; button.disabled = true; button.textContent = label || 'Saving…'; }
    else { button.disabled = false; if (button.dataset.label) button.textContent = button.dataset.label; }
  }
  function renderAuth(mode = 'login') {
    $('#auth-screen').classList.remove('hidden'); $('#workspace').classList.add('hidden');
    $('#identity').classList.add('hidden'); $('#nav').classList.add('hidden'); $('#logout').classList.add('hidden');
    $$('.auth-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.auth === mode));
    $('#register-fields').classList.toggle('hidden', mode !== 'register');
    $('#auth-form').elements.name.required = mode === 'register'; $('#auth-form').elements.phone.required = mode === 'register';
    $('#auth-form').elements.password.autocomplete = mode === 'register' ? 'new-password' : 'current-password';
    $('#auth-submit').innerHTML = mode === 'register' ? 'Create account <span>→</span>' : 'Sign in <span>→</span>';
    $('#auth-error').classList.add('hidden');
  }
  function switchView(view) {
    state.view = view;
    $$('.view').forEach(el => el.classList.toggle('hidden', el.id !== `view-${view}`));
    $$('.nav-link').forEach(el => el.classList.toggle('active', el.dataset.view === view));
    const titles = { overview: isAdmin() ? 'Good work starts with a clear view.' : 'Your laundry, on track.', orders: isAdmin() ? 'Every order, in one place.' : 'Your order history.', 'new-order': 'Let’s plan your next pickup.', 'manage-orders': 'Keep every order moving.', inbox: 'Every customer, heard.', profile: 'Your details, your way.', notifications: 'The latest from our team.', 'my-messages': 'The team is here to help.', services: 'Services and pricing.', settings: 'Pickup and store settings.', customers: 'Your local customer book.', audit: 'Administrative activity.' };
    $('#page-title').textContent = titles[view] || titles.overview;
    if (view === 'inbox') loadMessages();
    if (view === 'my-messages') loadMyMessages();
    if (view === 'manage-orders') loadOrders(1);
    if (view === 'profile') loadProfile();
    if (view === 'notifications') loadNotifications();
    if (view === 'services') loadServices(true);
    if (view === 'settings') loadSettings();
    if (view === 'customers') loadCustomers();
    if (view === 'audit') loadAudit();
    if (view === 'orders') loadOrders(1);
  }
  function orderCard(order, admin = false) {
    const address = esc(order.address);
    const lat = order.location?.lat, lng = order.location?.lng;
    const map = `https://www.google.com/maps/search/?api=1&query=${lat != null && lng != null ? `${encodeURIComponent(lat)},${encodeURIComponent(lng)}` : encodeURIComponent(order.address || '')}`;
    const transitionsForOrder = transitions[order.status] || [];
    const options = [order.status, ...transitionsForOrder].map(status => `<option value="${esc(status)}" ${status === order.status ? 'selected' : ''}>${esc(pretty(status))}</option>`).join('');
    const canPrice = ['picked_up', 'processing', 'ready_for_delivery', 'out_for_delivery'].includes(order.status);
    const adminTools = admin ? `<div class="order-actions"><button class="text-button" data-order-detail="${esc(order._id)}">Details</button><select class="status-select" data-status-id="${esc(order._id)}" aria-label="Update order ${esc(order.orderNumber)} status">${options}</select>${canPrice ? `<button class="text-button" data-set-final="${esc(order._id)}">${order.priceBreakdown?.finalTotal == null ? 'Set final price' : 'Edit final price'}</button>` : ''}<a class="map-link" href="${map}" target="_blank" rel="noopener noreferrer">⌖ Map</a></div>` : `<div class="order-actions"><button class="text-button" data-order-detail="${esc(order._id)}">Details / receipt</button>${['booking_received', 'pickup_scheduled', 'placed', 'confirmed'].includes(order.status) ? `<button class="text-button danger-text" data-cancel-order="${esc(order._id)}">Cancel</button>` : ''}<a class="map-link" href="${map}" target="_blank" rel="noopener noreferrer">⌖ Map</a></div>`;
    const customerLine = admin ? `<small>${esc(order.customer?.name || 'Customer')} · ${esc(order.customer?.phone || order.customer?.email || '')}</small>` : '';
    const title = admin ? `${esc(order.orderNumber)} · ${esc(order.serviceSnapshot?.name || pretty(order.service))}` : `${esc(order.serviceSnapshot?.name || pretty(order.service))} · ${esc(order.orderNumber)}`;
    const sub = admin ? `${esc(order.serviceSnapshot?.quantity ?? order.weightKg ?? '—')} ${esc(order.serviceSnapshot?.unit || 'kg')} · ${address}` : `${esc(order.serviceSnapshot?.quantity ?? order.weightKg ?? '—')} ${esc(order.serviceSnapshot?.unit || 'kg')} · ${address}`;
    const totalLine = order.priceBreakdown?.finalTotal == null ? `${money(order.priceBreakdown?.estimatedTotal ?? order.amount)} estimate` : `${money(order.priceBreakdown.finalTotal)} final price`;
    return `<article class="order-card"><div class="order-primary"><strong>${title}</strong><small>${sub}</small>${customerLine}</div><div class="order-meta"><strong>${date(order.pickupAt)}</strong><small>${totalLine} · ${esc(pretty(order.paymentStatus))}</small></div><span class="status ${esc(order.status)}">${esc(pretty(order.status))}</span>${adminTools}</article>`;
  }
  function empty(title, hint, button = '') { return `<div class="empty-state"><strong>${esc(title)}</strong>${esc(hint)}${button}</div>`; }
  function renderOrderList(target, orders, admin = false) { $(target).innerHTML = orders.length ? orders.map(order => orderCard(order, admin)).join('') : empty('No orders here yet', admin ? 'New bookings will appear in the queue.' : 'Your laundry story starts with a pickup.', admin ? '' : '<button class="button primary" data-goto="new-order" style="margin-top:14px">Book a pickup →</button>'); }
  function renderOverview(overview = null) {
    const admin = isAdmin();
    $('#welcome-card').classList.toggle('hidden', admin);
    $('.message-cta').classList.toggle('hidden', admin);
    $('#recent-title').textContent = admin ? 'Latest orders' : 'Recent orders';
    if (admin) {
      const counts = overview?.orders || {};
      const active = Object.entries(counts).filter(([status]) => !terminal(status)).reduce((sum, [, count]) => sum + count, 0);
      $('#stats-grid').innerHTML = `<article class="stat-card"><span class="stat-icon">▤</span><span>Total orders</span><strong>${overview?.totalOrders || 0}</strong><small>All bookings</small></article><article class="stat-card"><span class="stat-icon">↗</span><span>Pending pickup</span><strong>${(counts.booking_received || 0) + (counts.pickup_scheduled || 0)}</strong><small>Scheduled and awaiting collection</small></article><article class="stat-card"><span class="stat-icon">↻</span><span>In progress</span><strong>${active}</strong><small>Active service stages</small></article><article class="stat-card"><span class="stat-icon">✓</span><span>Completed</span><strong>${counts.delivered || 0}</strong><small>Delivered orders</small></article><article class="stat-card"><span class="stat-icon">×</span><span>Cancelled</span><strong>${(counts.cancelled || 0) + (counts.rejected || 0)}</strong><small>Cancelled or rejected</small></article><article class="stat-card"><span class="stat-icon">₹</span><span>Paid revenue</span><strong>${money(overview?.revenue || 0)}</strong><small>Verified paid orders only</small></article>`;
    } else {
      const active = Object.entries(state.summary).filter(([status]) => !terminal(status)).reduce((sum, [, count]) => sum + count, 0);
      const completed = state.summary.delivered || 0;
      const latest = state.orders.find(order => !terminal(order.status));
      $('#stats-grid').innerHTML = `<article class="stat-card"><span class="stat-icon">▤</span><span>Total orders</span><strong>${state.orderTotal || 0}</strong><small>Your laundry bookings</small></article><article class="stat-card"><span class="stat-icon">↻</span><span>In progress</span><strong>${active}</strong><small>We’re taking care of it</small></article><article class="stat-card"><span class="stat-icon">✓</span><span>Completed</span><strong>${completed}</strong><small>Delivered with care</small></article><article class="stat-card"><span class="stat-icon">✳</span><span>Next pickup</span><strong style="font-size:${latest ? '15px' : '20px'}">${latest ? date(latest.pickupAt).split(' at ')[0] : 'Whenever you’re ready'}</strong><small>${latest ? pretty(latest.status) : 'Book when it suits you'}</small></article>`;
    }
    renderOrderList('#recent-orders', state.orders.slice(0, 4), admin);
  }
  async function loadOrders(page = state.page) {
    const params = new URLSearchParams({ page: String(page), limit: '50' });
    if (isAdmin()) {
      if ($('#order-search').value.trim()) params.set('search', $('#order-search').value.trim());
      if ($('#order-filter').value !== 'all') params.set('status', $('#order-filter').value);
      if ($('#payment-filter').value) params.set('paymentStatus', $('#payment-filter').value);
      if ($('#service-filter').value) params.set('service', $('#service-filter').value);
      if ($('#date-from').value) params.set('from', $('#date-from').value);
      if ($('#date-to').value) params.set('to', $('#date-to').value);
      params.set('sort', $('#order-sort').value); params.set('direction', $('#order-direction').value);
    }
    const result = await api(`/orders?${params}`);
    state.orders = result.orders; state.summary = result.summary || {}; state.page = result.pagination.page; state.pages = result.pagination.pages; state.orderTotal = result.pagination.total;
    if (isAdmin()) {
      renderOrderList('#admin-orders-list', state.orders, true);
      $('#orders-page').textContent = `Page ${state.page} of ${Math.max(state.pages, 1)} · ${state.orderTotal} orders`;
      $('#orders-prev').disabled = state.page <= 1; $('#orders-next').disabled = state.page >= state.pages;
    } else {
      renderOrderList('#orders-list', state.orders, false);
      $('#customer-orders-page').textContent = `Page ${state.page} of ${Math.max(state.pages, 1)} · ${state.orderTotal} orders`;
      $('#customer-orders-prev').disabled = state.page <= 1; $('#customer-orders-next').disabled = state.page >= state.pages;
      if (state.view === 'overview') renderOverview();
    }
  }
  async function renderWorkspace(user) {
    state.user = user; $('#auth-screen').classList.add('hidden'); $('#workspace').classList.remove('hidden');
    $('#identity').classList.remove('hidden'); $('#nav').classList.remove('hidden'); $('#logout').classList.remove('hidden');
    $('#identity-name').textContent = user.name; $('#identity-role').textContent = isAdmin() ? 'Administrator' : 'Customer account'; $('#avatar').textContent = user.name.slice(0, 1).toUpperCase();
    $('#nav').classList.toggle('admin-view', isAdmin());
    $$('.admin-only').forEach(el => el.classList.toggle('hidden', !isAdmin()));
    await Promise.all([loadPublicCatalog(), loadOrders(1), loadNotifications()]);
    if (isAdmin()) {
      const overview = await api('/admin/overview'); $('#inbox-count').textContent = overview.unreadMessages || ''; renderOverview(overview);
    } else renderOverview();
    switchView('overview');
  }
  function renderServices() {
    const formSelect = $('#order-form').elements.service;
    const selected = formSelect.value;
    formSelect.innerHTML = state.services.filter(s => s.available).map(s => `<option value="${esc(s.slug)}" ${s.slug === selected ? 'selected' : ''}>${esc(s.name)} · ${money(s.price)}/${esc(s.unit)}</option>`).join('');
    const service = state.services.find(s => s.slug === formSelect.value);
    if (service) { $('#order-form').elements.quantity.min = service.minimumQuantity; $('#order-form').elements.quantity.step = service.unit === 'piece' ? '1' : '0.1'; $('#quantity-help').textContent = `Price per ${service.unit}; minimum ${service.minimumQuantity}.`; }
    const serviceFilter = $('#service-filter');
    if (serviceFilter) { const filterValue = serviceFilter.value; serviceFilter.innerHTML = `<option value="">All services</option>${state.services.map(s => `<option value="${esc(s.slug)}">${esc(s.name)}</option>`).join('')}`; serviceFilter.value = filterValue; }
    updateEstimate();
    if ($('#services-list')) $('#services-list').innerHTML = state.services.map(s => `<article class="service-row"><div><strong>${esc(s.name)} · ${money(s.price)}/${esc(s.unit)}</strong><small>${esc(s.description)} · minimum ${s.minimumQuantity} · ${s.available ? 'Available' : 'Paused'}</small></div><div class="service-admin-actions"><label>₹ <input type="number" min="0" step="0.01" value="${esc(s.price)}" data-service-price="${esc(s._id)}" aria-label="Price for ${esc(s.name)}"></label><button class="button outline" data-service-toggle="${esc(s._id)}" data-available="${s.available}">${s.available ? 'Pause' : 'Enable'}</button></div></article>`).join('');
  }
  async function loadServices(admin = false) { const result = await api(admin ? '/admin/services' : '/services'); state.services = result.services; renderServices(); }
  async function loadPublicCatalog() { const result = await api('/services'); state.services = result.services; state.settings = result.settings; renderServices(); }
  async function loadProfile() {
    const { user } = await api('/profile'); state.user = user;
    $('#profile-form').elements.name.value = user.name; $('#profile-form').elements.phone.value = user.phone;
    $('#profile-form').elements.address.value = user.addresses?.find(address => address.isDefault)?.address || user.addresses?.[0]?.address || '';
  }
  async function loadSlots(dateValue) {
    const select = $('#order-form').elements.pickupAt; select.disabled = true; select.innerHTML = '<option value="">Loading available pickup windows…</option>';
    if (!dateValue) { select.innerHTML = '<option value="">Choose a date first</option>'; return; }
    try {
      const result = await api(`/pickup-slots?date=${encodeURIComponent(dateValue)}`);
      const available = result.slots.filter(slot => slot.available);
      select.innerHTML = available.length ? `<option value="">Choose a pickup window</option>${available.map(slot => `<option value="${esc(slot.start)}">${esc(slot.label)} – ${esc(new Intl.DateTimeFormat('en-IN', { timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(slot.end)))}</option>`).join('')}` : '<option value="">No pickup windows available for this date</option>';
    } catch (error) { select.innerHTML = '<option value="">Could not load pickup windows</option>'; toast(error.message, true); }
    select.disabled = false;
  }
  function updateEstimate() {
    const form = $('#order-form'); if (!form) return;
    const service = state.services.find(s => s.slug === form.elements.service.value);
    if (!service) { $('#estimate').textContent = '—'; return; }
    const quantity = Number(form.elements.quantity.value || 0);
    const subtotal = quantity * Number(service.price);
    const total = subtotal + Number(state.settings?.deliveryFee || 0) + Math.max(0, Number(state.settings?.minimumOrderValue || 0) - subtotal);
    $('#estimate').textContent = money(total);
  }
  async function loadMessages() {
    try {
      const archived = $('#message-folder').value === 'archived';
      const { messages } = await api(`/messages?archived=${archived}`);
      $('#messages-list').innerHTML = messages.length ? messages.map(message => `<article class="message-card ${message.readAt ? '' : 'unread'}"><div class="message-head"><div><strong>${esc(message.name)} ${!message.readAt ? '<span class="status" style="margin-left:6px">New</span>' : ''}</strong><small>${esc(message.email)} ${message.phone ? `· ${esc(message.phone)}` : ''} ${message.locationName ? `· ${esc(message.locationName)}` : ''} · ${date(message.createdAt)}</small></div></div><p class="message-body">${esc(message.body)}</p>${message.reply ? `<div class="message-reply"><strong>Team reply saved · ${date(message.repliedAt)}</strong><br>${esc(message.reply)}</div>` : ''}<div class="message-tools"><textarea id="reply-${esc(message._id)}" placeholder="Write a reply (saved for the record)…"></textarea><button data-reply="${esc(message._id)}">Save reply</button>${!message.readAt ? `<button data-read="${esc(message._id)}">Mark read</button>` : ''}<button data-archive="${esc(message._id)}" data-archived="${archived}">${archived ? 'Restore' : 'Archive'}</button></div></article>`).join('') : empty('Your inbox is clear', 'Website enquiries and customer requests land here.');
    } catch (error) { toast(error.message, true); }
  }
  async function loadMyMessages() {
    try {
      const { messages } = await api('/my-messages');
      $('#my-messages-list').innerHTML = messages.length ? messages.map(message => `<article class="message-card"><div class="message-head"><div><strong>Your message</strong><small>${date(message.createdAt)}</small></div></div><p class="message-body">${esc(message.body)}</p>${message.reply ? `<div class="message-reply"><strong>Muniyasamy Laundry · ${date(message.repliedAt)}</strong><br>${esc(message.reply)}</div>` : '<div class="message-reply">Our team has received this message and will get back to you.</div>'}</article>`).join('') : empty('No messages yet', 'Send a question or special request to our laundry team.');
    } catch (error) { toast(error.message, true); }
  }
  async function loadNotifications() {
    try {
      const result = await api('/notifications'); state.notifications = result.notifications;
      $('#notification-count').textContent = result.unread || '';
      $('#notifications-list').innerHTML = result.notifications.length ? result.notifications.map(item => `<article class="notification-row ${item.readAt ? '' : 'unread'}"><div><strong>${esc(item.title)}</strong><small>${esc(item.body)} · ${date(item.createdAt)}</small></div>${item.readAt ? '' : `<button class="text-button" data-notification-read="${esc(item._id)}">Mark read</button>`}</article>`).join('') : empty('All caught up', 'Order and service updates will appear here.');
    } catch (error) { if (state.user) toast(error.message, true); }
  }
  async function loadSettings() {
    const { settings } = await api('/admin/settings'); state.settings = settings;
    for (const key of ['deliveryFee', 'minimumOrderValue', 'openHour', 'closeHour', 'slotCapacity', 'slotDurationMinutes']) $('#settings-form').elements[key].value = settings[key];
    $$('input[name="businessDays"]', $('#settings-form')).forEach(input => { input.checked = (settings.businessDays || []).includes(Number(input.value)); });
    updateEstimate();
  }
  async function loadCustomers() {
    const search = $('#customer-search').value.trim();
    const { customers } = await api(`/admin/customers?search=${encodeURIComponent(search)}`);
    $('#customers-list').innerHTML = customers.length ? customers.map(customer => `<article class="customer-row"><div><strong>${esc(customer.name)} · ${esc(customer.phone)}</strong><small>${esc(customer.email)} · ${customer.orderCount} orders${customer.lastOrder ? ` · last order ${date(customer.lastOrder)}` : ''}</small><div id="customer-history-${esc(customer._id)}" class="customer-history hidden"></div></div><div><a class="text-button" href="tel:${encodeURIComponent(customer.phone)}">Call customer</a> <button class="text-button" data-customer-orders="${esc(customer._id)}">Order history</button></div></article>`).join('') : empty('No customers match', 'Try a different name, email or phone.');
  }
  async function loadAudit() {
    const { logs } = await api('/admin/audit');
    $('#audit-list').innerHTML = logs.length ? logs.map(log => `<article class="audit-row"><div><strong>${esc(log.action)}</strong><small>${esc(log.actor?.name || 'Admin')} · ${esc(log.targetType)} ${esc(log.targetId)} · ${date(log.createdAt)} ${Object.keys(log.details || {}).length ? `· ${esc(JSON.stringify(log.details))}` : ''}</small></div></article>`).join('') : empty('No admin activity yet', 'Order and settings changes are logged here.');
  }
  function localDateTime(value) {
    const d = new Date(value); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }
  function showOrderDetail(order) {
    const breakdown = order.priceBreakdown || { subtotal: order.amount, estimatedTotal: order.amount };
    const history = (order.statusHistory || []).map(item => `<li>${esc(pretty(item.status))} · ${date(item.at)}${item.actor?.name ? ` · ${esc(item.actor.name)} (${esc(item.actorRole || item.actor.role || 'team')})` : ''}${item.note ? ` · ${esc(item.note)}` : ''}</li>`).join('');
    const editForm = !isAdmin() && ['booking_received', 'placed'].includes(order.status) ? `<form class="edit-order-form" data-edit-order="${esc(order._id)}"><h3>Edit booking before confirmation</h3><div class="form-grid"><label>Service<select name="service">${state.services.map(s => `<option value="${esc(s.slug)}" ${s.slug === order.service ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label><label>Quantity<input name="quantity" type="number" min="1" max="100" step="0.1" value="${esc(order.serviceSnapshot?.quantity ?? order.weightKg ?? 1)}" required></label><label>Pickup date & time<input name="pickupAt" type="datetime-local" value="${localDateTime(order.pickupAt)}" required></label><label class="span-2">Pickup address<textarea name="address" rows="2" required>${esc(order.address)}</textarea></label><label class="span-2">Notes<textarea name="notes" rows="2">${esc(order.notes || '')}</textarea></label><div class="span-2"><button class="button outline">Save booking changes</button></div></div></form>` : '';
    $('#order-detail').innerHTML = `<span class="eyebrow">ORDER RECEIPT · ${esc(order.orderNumber)}</span><h2 id="order-detail-title">${esc(order.serviceSnapshot?.name || pretty(order.service))}</h2><div class="order-detail-grid"><div><span>Status</span><strong>${esc(pretty(order.status))}</strong></div><div><span>Pickup time</span><strong>${date(order.pickupAt)}</strong></div><div><span>Quantity</span><strong>${esc(order.serviceSnapshot?.quantity ?? order.weightKg)} ${esc(order.serviceSnapshot?.unit || 'kg')}</strong></div><div><span>Address</span><strong>${esc(order.address)}</strong></div><div><span>Service subtotal</span><strong>${money(breakdown.subtotal)}</strong></div><div><span>Pickup fee</span><strong>${money(breakdown.deliveryFee)}</strong></div><div><span>Minimum order adjustment</span><strong>${money(breakdown.minimumAdjustment)}</strong></div><div><span>${breakdown.finalTotal == null ? 'Estimated total' : 'Final confirmed price'}</span><strong>${money(breakdown.finalTotal ?? breakdown.estimatedTotal)}</strong></div><div><span>Payment</span><strong>${esc(pretty(order.paymentStatus))}</strong></div><div><span>Notes</span><strong>${esc(order.notes || '—')}</strong></div></div><h3>Order updates</h3><ol>${history || '<li>Booking received</li>'}</ol><button class="button primary" data-print-order="${esc(order._id)}">Print receipt</button>${editForm}`;
    openDialog('#order-modal');
  }
  async function printReceipt(orderId) {
    const { order } = await api(`/orders/${orderId}`);
    const popup = window.open('', '_blank', 'width=720,height=800');
    if (!popup) return toast('Allow pop-ups to print your receipt.', true);
    popup.opener = null;
    const breakdown = order.priceBreakdown || {};
    popup.document.write(`<!doctype html><html><head><title>Receipt ${esc(order.orderNumber)}</title><meta name="viewport" content="width=device-width"><style>body{font:15px Arial;color:#18344d;max-width:680px;margin:40px auto;padding:0 24px}h1{font-size:24px}table{width:100%;border-collapse:collapse;margin:24px 0}td{padding:11px 5px;border-bottom:1px solid #ddd}td:last-child{text-align:right}.total{font-weight:bold;font-size:19px}.muted{color:#6c7d8a;font-size:12px}</style></head><body><h1>Muniyasamy Laundry</h1><p class="muted">Order receipt · ${esc(order.orderNumber)} · ${date(order.createdAt)}</p><p><b>${esc(order.serviceSnapshot?.name || order.service)}</b><br>${esc(order.address)}<br>Pickup: ${date(order.pickupAt)}</p><table><tr><td>${esc(order.serviceSnapshot?.quantity)} ${esc(order.serviceSnapshot?.unit)} · ${money(order.serviceSnapshot?.unitPrice)}/${esc(order.serviceSnapshot?.unit)}</td><td>${money(breakdown.subtotal)}</td></tr><tr><td>Pickup fee</td><td>${money(breakdown.deliveryFee)}</td></tr><tr><td>Minimum order adjustment</td><td>${money(breakdown.minimumAdjustment)}</td></tr><tr class="total"><td>${breakdown.finalTotal == null ? 'Estimated total' : 'Final confirmed price'}</td><td>${money(breakdown.finalTotal ?? breakdown.estimatedTotal)}</td></tr></table><p class="muted">${breakdown.finalTotal == null ? 'Estimate only. Final price is confirmed after weighing.' : 'Final price confirmed by the laundry team.'} Payment status: ${esc(pretty(order.paymentStatus))}.</p></body></html>`);
    popup.document.close(); setTimeout(() => { if (!popup.closed) popup.print(); }, 200);
  }

  $$('.auth-tab').forEach(tab => tab.addEventListener('click', () => renderAuth(tab.dataset.auth)));
  $('#auth-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget; $('#auth-error').classList.add('hidden'); setBusy(form, true, 'Signing in…');
    const mode = $('.auth-tab.active').dataset.auth, body = Object.fromEntries(new FormData(form).entries());
    try { const result = await api(`/auth/${mode === 'register' ? 'register' : 'login'}`, { method: 'POST', body: JSON.stringify(body) }); form.reset(); await renderWorkspace(result.user); }
    catch (error) { $('#auth-error').textContent = error.message; $('#auth-error').classList.remove('hidden'); }
    finally { setBusy(form, false); }
  });
  $('#logout').addEventListener('click', async () => { await api('/auth/logout', { method: 'POST', body: '{}' }).catch(() => {}); state.user = null; renderAuth(); });
  $('#nav').addEventListener('click', event => { const button = event.target.closest('[data-view]'); if (button) switchView(button.dataset.view); });
  document.addEventListener('click', async event => {
    const goto = event.target.closest('[data-goto]'); if (goto) switchView(goto.dataset.goto);
    if (event.target.closest('[data-open-message]')) openDialog('#message-modal');
    if (event.target.closest('[data-close-message]') || event.target.id === 'message-modal') closeDialog('#message-modal');
    if (event.target.closest('[data-close-order]') || event.target.id === 'order-modal') closeDialog('#order-modal');
    const detail = event.target.closest('[data-order-detail]');
    if (detail) { try { showOrderDetail((await api(`/orders/${detail.dataset.orderDetail}`)).order); } catch (error) { toast(error.message, true); } }
    const finalPrice = event.target.closest('[data-set-final]');
    if (finalPrice) {
      const order = state.orders.find(item => item._id === finalPrice.dataset.setFinal);
      const suggested = order.priceBreakdown?.finalTotal ?? order.priceBreakdown?.estimatedTotal ?? order.amount;
      const amount = window.prompt(`Final amount for ${order.orderNumber} (INR):`, String(suggested)); if (amount === null) return;
      const reason = window.prompt('Weighing or price adjustment note (required):'); if (!reason?.trim()) return toast('A short price note is required.', true);
      try { await api(`/orders/${order._id}/quote`, { method: 'PATCH', body: JSON.stringify({ finalTotal: Number(amount), reason }) }); await loadOrders(state.page); toast('Final price saved and customer notified.'); }
      catch (error) { toast(error.message, true); }
    }
    const cancel = event.target.closest('[data-cancel-order]');
    if (cancel) {
      const reason = window.prompt('Optional cancellation reason:', 'Changed plans'); if (reason === null) return;
      if (!window.confirm('Cancel this pickup request?')) return;
      try { await api(`/orders/${cancel.dataset.cancelOrder}/cancel`, { method: 'PATCH', body: JSON.stringify({ reason }) }); await loadOrders(1); toast('Order cancelled.'); }
      catch (error) { toast(error.message, true); }
    }
    const print = event.target.closest('[data-print-order]'); if (print) { try { await printReceipt(print.dataset.printOrder); } catch (error) { toast(error.message, true); } }
    const read = event.target.closest('[data-notification-read]');
    if (read) { try { await api(`/notifications/${read.dataset.notificationRead}/read`, { method: 'PATCH', body: '{}' }); await loadNotifications(); } catch (error) { toast(error.message, true); } }
    const archive = event.target.closest('[data-archive]');
    if (archive) { try { await api(`/messages/${archive.dataset.archive}`, { method: 'PATCH', body: JSON.stringify({ archived: archive.dataset.archived !== 'true', read: true }) }); await loadMessages(); toast('Inbox updated.'); } catch (error) { toast(error.message, true); } }
    const toggleService = event.target.closest('[data-service-toggle]');
    if (toggleService) { try { await api(`/admin/services/${toggleService.dataset.serviceToggle}`, { method: 'PATCH', body: JSON.stringify({ available: toggleService.dataset.available !== 'true' }) }); await loadServices(true); toast('Service availability updated.'); } catch (error) { toast(error.message, true); } }
    const customerOrders = event.target.closest('[data-customer-orders]');
    if (customerOrders) {
      const target = $(`#customer-history-${CSS.escape(customerOrders.dataset.customerOrders)}`);
      if (!target.classList.contains('hidden')) { target.classList.add('hidden'); return; }
      try { const result = await api(`/admin/customers/${customerOrders.dataset.customerOrders}/orders`); target.innerHTML = result.orders.length ? result.orders.map(order => `<div class="customer-order-line"><strong>${esc(order.orderNumber)} · ${esc(order.serviceSnapshot?.name || pretty(order.service))}</strong><small>${esc(pretty(order.status))} · ${date(order.pickupAt)} · ${money(order.priceBreakdown?.finalTotal ?? order.amount)}</small></div>`).join('') : '<small>No order history yet.</small>'; target.classList.remove('hidden'); }
      catch (error) { toast(error.message, true); }
    }
  });

  const orderSearch = $('#order-search');
  let searchTimer;
  [orderSearch, $('#order-filter'), $('#payment-filter'), $('#service-filter'), $('#date-from'), $('#date-to'), $('#order-sort'), $('#order-direction')].forEach(el => el.addEventListener(el === orderSearch ? 'input' : 'change', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => loadOrders(1).catch(error => toast(error.message, true)), 250); }));
  $('#orders-prev').addEventListener('click', () => loadOrders(Math.max(1, state.page - 1)).catch(error => toast(error.message, true)));
  $('#orders-next').addEventListener('click', () => loadOrders(Math.min(state.pages, state.page + 1)).catch(error => toast(error.message, true)));
  $('#customer-orders-prev').addEventListener('click', () => loadOrders(Math.max(1, state.page - 1)).catch(error => toast(error.message, true)));
  $('#customer-orders-next').addEventListener('click', () => loadOrders(Math.min(state.pages, state.page + 1)).catch(error => toast(error.message, true)));
  $('#export-orders').addEventListener('click', async () => {
    try {
      const params = new URLSearchParams({ status: $('#order-filter').value, service: $('#service-filter').value, paymentStatus: $('#payment-filter').value, from: $('#date-from').value, to: $('#date-to').value, search: $('#order-search').value, limit: '5000' });
      const response = await fetch(`/api/admin/orders.csv?${params}`, { credentials: 'same-origin' });
      if (!response.ok) throw new Error((await response.json()).error || 'Export failed.');
      const url = URL.createObjectURL(await response.blob()), link = document.createElement('a'); link.href = url; link.download = 'muniyasamy-orders.csv'; link.click(); URL.revokeObjectURL(url);
    } catch (error) { toast(error.message, true); }
  });
  $('#admin-orders-list').addEventListener('change', async event => {
    const select = event.target.closest('[data-status-id]'); if (!select) return;
    const target = select.value, order = state.orders.find(item => item._id === select.dataset.statusId);
    if (['cancelled', 'rejected'].includes(target)) {
      const reason = window.prompt(`Reason for ${target}:`); if (!reason?.trim()) { select.value = order.status; toast('A reason is required.', true); return; }
      if (!window.confirm(`Confirm ${target} for ${order.orderNumber}?`)) { select.value = order.status; return; }
      select.dataset.reason = reason;
    }
    try { await api(`/orders/${select.dataset.statusId}/status`, { method: 'PATCH', body: JSON.stringify({ status: target, reason: select.dataset.reason || '' }) }); await loadOrders(state.page); const overview = await api('/admin/overview'); renderOverview(overview); toast('Order status updated.'); }
    catch (error) { select.value = order.status; toast(error.message, true); }
  });
  $('#message-folder').addEventListener('change', loadMessages);
  $('#messages-list').addEventListener('click', async event => {
    const read = event.target.closest('[data-read]'), reply = event.target.closest('[data-reply]');
    try {
      if (read) await api(`/messages/${read.dataset.read}`, { method: 'PATCH', body: JSON.stringify({ read: true }) });
      if (reply) { const value = $(`#reply-${CSS.escape(reply.dataset.reply)}`).value.trim(); if (!value) return toast('Write a reply before saving.', true); await api(`/messages/${reply.dataset.reply}`, { method: 'PATCH', body: JSON.stringify({ reply: value, read: true }) }); }
      await loadMessages(); const overview = await api('/admin/overview'); $('#inbox-count').textContent = overview.unreadMessages || ''; toast('Inbox updated.');
    } catch (error) { toast(error.message, true); }
  });
  $('#message-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget; setBusy(form, true, 'Sending…');
    try { await api('/messages', { method: 'POST', body: JSON.stringify({ name: state.user.name, email: state.user.email, phone: state.user.phone, message: new FormData(form).get('message') }) }); form.reset(); closeDialog('#message-modal'); toast('Message sent to the laundry team.'); if (state.view === 'my-messages') await loadMyMessages(); }
    catch (error) { toast(error.message, true); } finally { setBusy(form, false); }
  });
  $('#profile-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget; setBusy(form, true);
    const values = new FormData(form);
    try {
      const addresses = values.get('address').trim() ? [{ label: 'Home', address: values.get('address').trim(), location: state.location, isDefault: true }] : [];
      const { user } = await api('/profile', { method: 'PATCH', body: JSON.stringify({ name: values.get('name'), phone: values.get('phone'), addresses }) });
      state.user = user; $('#identity-name').textContent = user.name; $('#avatar').textContent = user.name[0].toUpperCase(); state.location = null; toast('Profile saved.');
    } catch (error) { toast(error.message, true); } finally { setBusy(form, false); }
  });
  $('#locate-profile').addEventListener('click', () => {
    if (!navigator.geolocation) return toast('Location is not available in this browser.', true);
    const button = $('#locate-profile'); button.disabled = true;
    navigator.geolocation.getCurrentPosition(position => { state.location = { lat: position.coords.latitude, lng: position.coords.longitude }; $('#profile-location-label').textContent = `Coordinates attached · ${state.location.lat.toFixed(4)}, ${state.location.lng.toFixed(4)}`; button.disabled = false; }, () => { button.disabled = false; toast('Could not read location. Check browser location permission.', true); }, { enableHighAccuracy: true, timeout: 10000 });
  });
  $('#order-detail').addEventListener('submit', async event => {
    const form = event.target.closest('[data-edit-order]'); if (!form) return;
    event.preventDefault(); setBusy(form, true, 'Saving…');
    const values = Object.fromEntries(new FormData(form)); values.quantity = Number(values.quantity);
      try { await api(`/orders/${form.dataset.editOrder}`, { method: 'PUT', body: JSON.stringify(values) }); closeDialog('#order-modal'); await loadOrders(state.page); toast('Booking updated.'); }
    catch (error) { toast(error.message, true); } finally { setBusy(form, false); }
  });
  $('#order-detail').addEventListener('change', event => {
    const service = event.target.closest('select[name="service"]'); if (!service) return;
    const selected = state.services.find(item => item.slug === service.value);
    const quantity = $('input[name="quantity"]', service.form);
    if (selected && quantity) { quantity.step = selected.unit === 'piece' ? '1' : '0.1'; quantity.min = String(selected.minimumQuantity); }
  });
  $('#service-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget; setBusy(form, true);
    try { await api('/admin/services', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) }); form.reset(); await loadServices(true); toast('Service added.'); }
    catch (error) { toast(error.message, true); } finally { setBusy(form, false); }
  });
  $('#services-list').addEventListener('change', async event => {
    const input = event.target.closest('[data-service-price]'); if (!input) return;
    try { await api(`/admin/services/${input.dataset.servicePrice}`, { method: 'PATCH', body: JSON.stringify({ price: Number(input.value) }) }); await loadServices(true); toast('New price saved. Past quotes are unchanged.'); }
    catch (error) { toast(error.message, true); await loadServices(true); }
  });
  $('#settings-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget; setBusy(form, true);
    const body = Object.fromEntries(new FormData(form));
    for (const key of Object.keys(body)) body[key] = Number(body[key]);
    body.businessDays = $$('input[name="businessDays"]:checked', form).map(input => Number(input.value));
    try { const { settings } = await api('/admin/settings', { method: 'PATCH', body: JSON.stringify(body) }); state.settings = settings; updateEstimate(); toast('Business settings saved.'); }
    catch (error) { toast(error.message, true); } finally { setBusy(form, false); }
  });
  let customerSearchTimer;
  $('#customer-search').addEventListener('input', () => { clearTimeout(customerSearchTimer); customerSearchTimer = setTimeout(() => loadCustomers().catch(error => toast(error.message, true)), 250); });
  $('#order-form').elements.pickupDate.min = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  $('#order-form').elements.pickupDate.addEventListener('change', event => loadSlots(event.target.value));
  $('#order-form').addEventListener('input', updateEstimate); $('#order-form').addEventListener('change', updateEstimate);
  $('#order-form').elements.service.addEventListener('change', () => { const selected = state.services.find(s => s.slug === $('#order-form').elements.service.value); if (selected) $('#order-form').elements.quantity.step = selected.unit === 'piece' ? '1' : '0.1'; });
  $('#locate-me').addEventListener('click', () => {
    if (!navigator.geolocation) return toast('Location is not available in this browser.', true);
    const button = $('#locate-me'); button.disabled = true;
    navigator.geolocation.getCurrentPosition(position => { state.location = { lat: position.coords.latitude, lng: position.coords.longitude }; $('#location-label').textContent = `Location attached · ${state.location.lat.toFixed(4)}, ${state.location.lng.toFixed(4)}`; button.disabled = false; }, () => { button.disabled = false; toast('Could not read location. Check browser location permission.', true); }, { enableHighAccuracy: true, timeout: 10000 });
  });
  $('#order-form').addEventListener('submit', async event => {
    event.preventDefault(); setBusy(event.currentTarget, true, 'Placing request…');
    const form = event.currentTarget, values = new FormData(form);
    const body = { service: values.get('service'), quantity: Number(values.get('quantity')), pickupAt: values.get('pickupAt'), address: values.get('address'), notes: values.get('notes'), location: state.location, clientRequestId: state.requestId };
    try {
      const { order } = await api('/orders', { method: 'POST', headers: { 'Idempotency-Key': state.requestId }, body: JSON.stringify(body) });
      state.requestId = crypto.randomUUID(); state.location = null; form.reset(); $('#location-label').textContent = 'Optional · helps our pickup team find you'; $('#order-form').elements.pickupAt.innerHTML = '<option value="">Choose a date first</option>'; $('#order-form').elements.pickupAt.disabled = true;
      await loadOrders(1); toast(`Pickup request ${order.orderNumber} received.`); switchView('orders');
    } catch (error) { toast(error.message, true); } finally { setBusy(form, false); }
  });
  document.addEventListener('keydown', event => {
    const dialog = !$('#message-modal').classList.contains('hidden') ? $('#message-modal') : !$('#order-modal').classList.contains('hidden') ? $('#order-modal') : null;
    if (event.key === 'Escape' && dialog) { closeDialog(`#${dialog.id}`); return; }
    if (event.key === 'Tab' && dialog) {
      const focusable = $$('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href]', dialog).filter(el => el.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });

  api('/auth/me').then(({ user }) => renderWorkspace(user)).catch(() => renderAuth());
  setInterval(async () => {
    if (!state.user || document.hidden) return;
    try {
      await loadNotifications();
      if (state.view === 'manage-orders' || state.view === 'orders' || state.view === 'overview') await loadOrders(state.page);
      if (isAdmin()) { const overview = await api('/admin/overview'); $('#inbox-count').textContent = overview.unreadMessages || ''; if (state.view === 'overview') renderOverview(overview); }
    } catch { /* A temporary network failure should not interrupt the current view. */ }
  }, 20000);
})();
