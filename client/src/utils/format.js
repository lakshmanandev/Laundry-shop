const statusNames = {
  booking_received: 'Booking received', pickup_scheduled: 'Pickup scheduled', picked_up: 'Picked up',
  processing: 'Processing', ready_for_delivery: 'Ready for delivery', out_for_delivery: 'Out for delivery',
  delivered: 'Delivered', cancelled: 'Cancelled', rejected: 'Not accepted', placed: 'Booking received',
  confirmed: 'Pickup scheduled', ready: 'Ready for delivery'
};

export const pretty = value => statusNames[value] || String(value || '').replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase());
export const date = value => value ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(value)) : '—';
export const time = value => value ? new Intl.DateTimeFormat('en-IN', { timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(value)) : '';
export const money = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value) || 0);
export const terminal = status => ['delivered', 'cancelled', 'rejected'].includes(status);
export const transitions = {
  booking_received: ['pickup_scheduled', 'cancelled', 'rejected'], pickup_scheduled: ['picked_up', 'cancelled', 'rejected'],
  picked_up: ['processing'], processing: ['ready_for_delivery'], ready_for_delivery: ['out_for_delivery'],
  out_for_delivery: ['delivered'], delivered: [], cancelled: [], rejected: [], placed: ['pickup_scheduled', 'cancelled', 'rejected'],
  confirmed: ['picked_up', 'cancelled', 'rejected'], ready: ['out_for_delivery']
};
export const mapUrl = order => {
  const { lat, lng } = order.location || {};
  const query = lat != null && lng != null ? `${lat},${lng}` : order.address || '';
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
};
export const localDateTime = value => {
  const dateValue = new Date(value);
  return new Date(dateValue.getTime() - dateValue.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
