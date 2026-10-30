import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';

const databaseName = `muniyasamy_laundry_ci_test_${process.pid}`;
process.env.MONGODB_URI = `mongodb://127.0.0.1:27017/${databaseName}`;
process.env.JWT_SECRET = 'test-only-random-session-secret-which-is-not-a-real-credential';
process.env.CLIENT_ORIGIN = '';
process.env.NODE_ENV = 'test';

test('HTTP API enforces roles, customer isolation, pricing and order workflow', async t => {
  const { app, connectDatabase } = await import('../src/server.js');
  const { User, Service, Order, Notification, AuditLog } = await import('../src/models.js');
  const mongoose = (await import('mongoose')).default;
  await connectDatabase(process.env.MONGODB_URI);
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, { cookie, ...options } = {}) => fetch(`${base}${path}`, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(options.headers || {}) } });
  const json = (method, body, extra = {}) => ({ method, body: JSON.stringify(body), ...extra });
  const cookieFrom = response => response.headers.get('set-cookie')?.split(';')[0];

  try {
    await t.test('health and public services are available without secret disclosure', async () => {
      const health = await request('/api/health').then(r => r.json());
      assert.deepEqual(health, { status: 'ok', database: 'connected' });
      const catalog = await request('/api/services').then(r => r.json());
      assert.ok(catalog.services.some(service => service.slug === 'wash-fold'));
      const home = await request('/').then(r => r.text());
      assert.match(home, /Muniyasamy Laundry/);
      assert.match(home, /Book a Pickup/);
      assert.match(home, /Fresh Clothes\./);
      assert.match(home, /More Time for Life\./);
      assert.match(home, /id="public-services"/);
      assert.match(home, /assets\/images\/muniyasamy-family-laundry\.jpg/);
      assert.match(home, /Chat on WhatsApp/);
      assert.match(home, /instagram\.com\/muniyasamy_laundry_service/);
      assert.match(home, /facebook\.com\/profile\.php\?id=61595492918724/);
      assert.match(home, /id="booking-faq"/);
      assert.doesNotMatch(home, /laundryday\.au|site1_brunswick/);
      assert.equal((await request('/brunswick-east.html')).status, 404);
      assert.equal((await request('/blog/')).status, 404);
      const privacy = await request('/privacy.html').then(r => r.text());
      assert.match(privacy, /Muniyasamy Laundry/);
      assert.doesNotMatch(privacy, /laundryday\.au|CCTV|Melbourne/);
      const policy = (await request('/').then(r => r.headers.get('content-security-policy')));
      assert.match(policy, /script-src 'self'/);
      assert.doesNotMatch(policy, /script-src[^;]*unsafe-inline/);
      const source = await request('/server/src/server.js').then(r => r.text());
      assert.doesNotMatch(source, /import express from/);
      const missing = await request('/api/no-such-route');
      assert.equal(missing.status, 404);
      assert.match(missing.headers.get('content-type'), /application\/json/);
    });

    let customer, customerCookie, secondCustomerCookie, adminCookie, order;
    await t.test('registration creates a customer and blocks malformed credentials', async () => {
      const invalid = await request('/api/auth/register', json('POST', { name: 'A', email: 'bad', phone: '123', password: 'short' }));
      assert.equal(invalid.status, 400);
      const response = await request('/api/auth/register', json('POST', { name: 'Test Customer', email: 'laundry-test@example.invalid', phone: '+919999999999', password: 'local-test-password-123' }));
      assert.equal(response.status, 201);
      customerCookie = cookieFrom(response);
      customer = (await response.json()).user;
      assert.equal(customer.role, 'customer');
      assert.ok(customerCookie);
      const profile = await request('/api/profile', { cookie: customerCookie, ...json('PATCH', { name: 'Test Customer Updated', phone: '+919999999998', addresses: [{ label: 'Home', address: 'Saved address, Madurai', location: { lat: 9.93, lng: 78.12 }, isDefault: true }] }) });
      assert.equal(profile.status, 200);
      const savedProfile = (await profile.json()).user;
      assert.equal(savedProfile.addresses[0].location.lat, 9.93);
    });

    await t.test('customer cannot access admin routes and a foreign origin is blocked', async () => {
      const admin = await request('/api/admin/overview', { cookie: customerCookie });
      assert.equal(admin.status, 403);
      const csrf = await request('/api/profile', { cookie: customerCookie, ...json('PATCH', { name: 'Changed' }, { headers: { Origin: 'https://attacker.invalid' } }) });
      assert.equal(csrf.status, 403);
    });

    await t.test('booking stores a server quote and idempotency prevents duplicate orders', async () => {
      let slot;
      const local = new Date(Date.now() + 330 * 60000);
      for (let dayOffset = 1; dayOffset <= 10 && !slot; dayOffset++) {
        const d = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + dayOffset));
        const dateString = d.toISOString().slice(0, 10);
        const slots = await request(`/api/pickup-slots?date=${dateString}`).then(r => r.json());
        slot = slots.slots?.find(item => item.available);
      }
      assert.ok(slot, 'a future business pickup slot should be available');
      const key = 'test-request-once-123456';
      const payload = { service: 'wash-fold', quantity: 2, pickupAt: slot.start, address: 'Test Road, Madurai', notes: 'Integration test' };
      const first = await request('/api/orders', { cookie: customerCookie, ...json('POST', payload, { headers: { 'Idempotency-Key': key } }) });
      assert.equal(first.status, 201);
      order = (await first.json()).order;
      assert.equal(order.priceBreakdown.subtotal, 180);
      assert.equal(order.priceBreakdown.estimatedTotal, 180);
      const retry = await request('/api/orders', { cookie: customerCookie, ...json('POST', payload, { headers: { 'Idempotency-Key': key } }) });
      assert.equal(retry.status, 200);
      assert.equal((await retry.json()).order._id, order._id);
    });

    await t.test('customer data is isolated, and customer cancellation is permitted before pickup', async () => {
      const second = await request('/api/auth/register', json('POST', { name: 'Other Customer', email: 'other-test@example.invalid', phone: '+918888888888', password: 'other-test-password-123' }));
      secondCustomerCookie = cookieFrom(second);
      const forbidden = await request(`/api/orders/${order._id}`, { cookie: secondCustomerCookie });
      assert.equal(forbidden.status, 404);
      const cancelled = await request(`/api/orders/${order._id}/cancel`, { cookie: customerCookie, ...json('PATCH', { reason: 'Test cancellation' }) });
      assert.equal(cancelled.status, 200);
      assert.equal((await cancelled.json()).order.status, 'cancelled');
    });

    await t.test('admin status workflow is validated and actions are audited', async () => {
      const admin = await User.create({ name: 'Integration Admin', email: 'admin-test@example.invalid', phone: '+917777777777', passwordHash: await bcrypt.hash('admin-test-password-123', 4), role: 'admin' });
      const login = await request('/api/auth/login', json('POST', { email: admin.email, password: 'admin-test-password-123' }));
      assert.equal(login.status, 200); adminCookie = cookieFrom(login);
      const freshPayload = { service: 'wash-fold', quantity: 1, pickupAt: new Date(Date.now() + 2 * 86400000).toISOString(), address: 'Test Road, Madurai' };
      // Pick a slot from the real slot service instead of relying on a fixed business day/time.
      const local = new Date(Date.now() + 330 * 60000); let freshSlot;
      for (let dayOffset = 1; dayOffset <= 10 && !freshSlot; dayOffset++) {
        const d = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + dayOffset));
        const options = await request(`/api/pickup-slots?date=${d.toISOString().slice(0, 10)}`).then(r => r.json());
        freshSlot = options.slots?.find(item => item.available);
      }
      freshPayload.pickupAt = freshSlot.start;
      const created = await request('/api/orders', { cookie: customerCookie, ...json('POST', freshPayload) });
      assert.equal(created.status, 201);
      const target = (await created.json()).order;
      const service = await Service.findOne({ slug: 'wash-fold' });
      const updatePrice = await request(`/api/admin/services/${service._id}`, { cookie: adminCookie, ...json('PATCH', { price: 999 }) });
      assert.equal(updatePrice.status, 200);
      const oldQuote = await request(`/api/orders/${order._id}`, { cookie: customerCookie }).then(r => r.json());
      assert.equal(oldQuote.order.priceBreakdown.estimatedTotal, 180);
      await Service.updateOne({ _id: service._id }, { $set: { price: 90 } });
      const skipped = await request(`/api/orders/${target._id}/status`, { cookie: adminCookie, ...json('PATCH', { status: 'processing' }) });
      assert.equal(skipped.status, 409);
      for (const status of ['pickup_scheduled', 'picked_up', 'processing', 'ready_for_delivery', 'out_for_delivery', 'delivered']) {
        const response = await request(`/api/orders/${target._id}/status`, { cookie: adminCookie, ...json('PATCH', { status }) });
        assert.equal(response.status, 200, `transition to ${status}`);
      }
      await Order.updateOne({ _id: target._id }, { $set: { paymentStatus: 'paid', 'priceBreakdown.finalTotal': 99 } });
      const overview = await request('/api/admin/overview', { cookie: adminCookie }).then(r => r.json());
      assert.equal(overview.revenue, 99);
      assert.equal(overview.totalOrders, 2);
      assert.equal(typeof overview.ordersToday, 'number');
      assert.equal(typeof overview.upcomingPickups, 'number');
      assert.ok(await Notification.countDocuments({ user: customer.id }));
      assert.ok(await AuditLog.countDocuments({ actor: admin._id, action: 'order.status_changed' }));
      const paidEndpoint = await request(`/api/orders/${target._id}/payment`, { cookie: adminCookie, ...json('PATCH', { paymentStatus: 'paid' }) });
      assert.equal(paidEndpoint.status, 400);
    });

    await t.test('pickup capacity remains safe when two requests race for the last seat', async () => {
      const settings = await request('/api/admin/settings', { cookie: adminCookie }).then(r => r.json());
      const saved = await request('/api/admin/settings', { cookie: adminCookie, ...json('PATCH', { slotCapacity: 1 }) });
      assert.equal(saved.status, 200);
      const local = new Date(Date.now() + 330 * 60000); let slot;
      for (let dayOffset = 1; dayOffset <= 10 && !slot; dayOffset++) {
        const d = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + dayOffset));
        const options = await request(`/api/pickup-slots?date=${d.toISOString().slice(0, 10)}`).then(r => r.json());
        slot = options.slots?.find(item => item.available);
      }
      const payload = { service: 'wash-fold', quantity: 1, pickupAt: slot.start, address: 'Concurrent booking test, Madurai' };
      const responses = await Promise.all([
        request('/api/orders', { cookie: customerCookie, ...json('POST', { ...payload, clientRequestId: 'race-seat-request-0001' }) }),
        request('/api/orders', { cookie: customerCookie, ...json('POST', { ...payload, clientRequestId: 'race-seat-request-0002' }) })
      ]);
      assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);
      await request('/api/admin/settings', { cookie: adminCookie, ...json('PATCH', { slotCapacity: settings.settings.slotCapacity || 8 }) });
    });

    await t.test('website contact messages reach the admin inbox and can be archived', async () => {
      const sent = await request('/api/messages', json('POST', { name: 'Walk-in Customer', email: 'walk-in@example.invalid', message: 'Do you offer steam ironing?' }));
      assert.equal(sent.status, 201);
      const inbox = await request('/api/messages', { cookie: adminCookie }).then(r => r.json());
      const message = inbox.messages.find(item => item.email === 'walk-in@example.invalid');
      assert.ok(message);
      const saved = await request(`/api/messages/${message._id}`, { cookie: adminCookie, ...json('PATCH', { read: true, archived: true, reply: 'Yes, we do.' }) });
      assert.equal(saved.status, 200);
      const archived = await request('/api/messages?archived=true', { cookie: adminCookie }).then(r => r.json());
      assert.ok(archived.messages.some(item => String(item._id) === String(message._id)));
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
