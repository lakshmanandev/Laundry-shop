import test from 'node:test';
import assert from 'node:assert/strict';
import { canTransition, customerFriendlyStatus, normalizeStatus, quoteOrder } from '../src/domain.js';
import { dispatchExternalNotification } from '../src/notification-adapters.js';

test('quote snapshots quantity pricing, delivery and minimum order adjustment', () => {
  assert.deepEqual(quoteOrder({ service: { price: 90, minimumQuantity: 1 }, quantity: 2.5, deliveryFee: 30, minimumOrderValue: 300 }), {
    subtotal: 225, deliveryFee: 30, minimumAdjustment: 75, estimatedTotal: 330
  });
});

test('quote rejects unavailable services and invalid quantities', () => {
  assert.throws(() => quoteOrder({ service: { price: 50, available: false }, quantity: 1 }), /unavailable/);
  assert.throws(() => quoteOrder({ service: { price: 50, minimumQuantity: 2 }, quantity: 1 }), /Quantity/);
  assert.throws(() => quoteOrder({ service: { price: 15, unit: 'piece' }, quantity: 1.5 }), /whole-number/);
});

test('order transitions follow the pickup and delivery workflow', () => {
  assert.equal(canTransition('booking_received', 'pickup_scheduled'), true);
  assert.equal(canTransition('processing', 'delivered'), false);
  assert.equal(canTransition('delivered', 'cancelled'), false);
  assert.equal(canTransition('placed', 'pickup_scheduled'), true);
  assert.equal(normalizeStatus('confirmed'), 'pickup_scheduled');
});

test('customer messages are supplied for every supported status', () => {
  for (const status of ['booking_received', 'pickup_scheduled', 'picked_up', 'processing', 'ready_for_delivery', 'out_for_delivery', 'delivered', 'cancelled', 'rejected']) {
    assert.ok(customerFriendlyStatus(status).length > 10);
  }
});

test('external notification adapter clearly skips when credentials are missing', async () => {
  let sent = false;
  const result = await dispatchExternalNotification('email', { to: 'customer@example.com' }, {}, async () => { sent = true; });
  assert.deepEqual(result, { state: 'not_configured' });
  assert.equal(sent, false);
});

test('external notification adapter requires HTTPS outside localhost', async () => {
  const result = await dispatchExternalNotification('sms', {}, { SMS_PROVIDER_URL: 'http://provider.example/send', SMS_PROVIDER_API_KEY: 'test' }, async () => ({ ok: true }));
  assert.deepEqual(result, { state: 'invalid_configuration' });
});

test('configured external notification adapter uses authenticated HTTPS without redirecting', async () => {
  let sent;
  const result = await dispatchExternalNotification('email', { to: 'customer@example.com', text: 'Pickup scheduled' }, {
    EMAIL_PROVIDER_URL: 'https://provider.example/notify', EMAIL_PROVIDER_API_KEY: 'unit-test-token'
  }, async (url, options) => { sent = { url: String(url), options }; return new Response('', { status: 202 }); });
  assert.deepEqual(result, { state: 'accepted' });
  assert.equal(sent.url, 'https://provider.example/notify');
  assert.equal(sent.options.redirect, 'error');
  assert.equal(sent.options.headers.authorization, 'Bearer unit-test-token');
  assert.equal(JSON.parse(sent.options.body).to, 'customer@example.com');
});
