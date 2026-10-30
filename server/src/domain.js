export const ORDER_STATUSES = [
  'booking_received', 'pickup_scheduled', 'picked_up', 'processing',
  'ready_for_delivery', 'out_for_delivery', 'delivered', 'cancelled', 'rejected'
];

const transitions = {
  booking_received: ['pickup_scheduled', 'cancelled', 'rejected'],
  pickup_scheduled: ['picked_up', 'cancelled', 'rejected'],
  picked_up: ['processing'],
  processing: ['ready_for_delivery'],
  ready_for_delivery: ['out_for_delivery'],
  out_for_delivery: ['delivered'],
  delivered: [], cancelled: [], rejected: []
};
const legacy = { placed: 'booking_received', confirmed: 'pickup_scheduled', ready: 'ready_for_delivery' };

export function normalizeStatus(status) { return legacy[status] || status; }
export function canTransition(from, to) { return Boolean(transitions[normalizeStatus(from)]?.includes(to)); }

export function quoteOrder({ service, quantity, deliveryFee = 0, minimumOrderValue = 0 }) {
  const qty = Number(quantity);
  if (!service || service.available === false || !Number.isFinite(Number(service.price)) || Number(service.price) < 0) throw new Error('This service is unavailable.');
  if (!Number.isFinite(qty) || qty < Number(service.minimumQuantity || 1) || qty > 100) throw new Error('Quantity is outside the allowed range.');
  if (service.unit === 'piece' && !Number.isInteger(qty)) throw new Error('Piece-based services require a whole-number quantity.');
  const subtotal = Math.round(qty * Number(service.price) * 100) / 100;
  const fee = Math.max(0, Number(deliveryFee) || 0);
  const minimumAdjustment = Math.max(0, Number(minimumOrderValue || 0) - subtotal);
  return { subtotal, deliveryFee: fee, minimumAdjustment, estimatedTotal: Math.round((subtotal + fee + minimumAdjustment) * 100) / 100 };
}

export function customerFriendlyStatus(status) {
  const messages = {
    booking_received: 'We received your booking and will confirm the pickup shortly.',
    pickup_scheduled: 'Your pickup is scheduled. We’ll see you at the selected time.',
    picked_up: 'Your laundry has been picked up and is on its way to us.',
    processing: 'Your clothes are being carefully cleaned.',
    ready_for_delivery: 'Your laundry is ready for delivery.',
    out_for_delivery: 'Your clean laundry is on its way back to you.',
    delivered: 'Your laundry has been delivered. Thank you for choosing us!',
    cancelled: 'This order was cancelled.', rejected: 'We could not accept this booking. Please contact the laundry team.'
  };
  return messages[normalizeStatus(status)] || 'Your order status has been updated.';
}
