import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { User, Service, Order, Message, Notification, AuditLog, BusinessSettings, PickupReservation } from './models.js';
import { ORDER_STATUSES, canTransition, customerFriendlyStatus, normalizeStatus, quoteOrder } from './domain.js';
import { dispatchOrderNotifications } from './notification-adapters.js';

const app = express();
const port = Number(process.env.PORT || 4000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.');
const secret = process.env.JWT_SECRET;
if (!secret || secret.length < 32 || /change.?this|replace.?with|generate.?a.?random/i.test(secret)) throw new Error('Set a random JWT_SECRET of at least 32 characters in the environment.');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const clientDist = path.join(root, 'client', 'dist');
const developmentOrigins = process.env.NODE_ENV === 'production' ? [] : ['http://localhost:5173', 'http://127.0.0.1:5173'];
const configuredOrigins = new Set([
  ...(process.env.CLIENT_ORIGIN || `http://localhost:${port}`).split(',').map(v => v.trim()).filter(Boolean),
  ...developmentOrigins
]);
const proxyHops = process.env.TRUST_PROXY_HOPS === undefined ? 0 : Number(process.env.TRUST_PROXY_HOPS);
if (!Number.isInteger(proxyHops) || proxyHops < 0 || proxyHops > 5) throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 5.');
if (proxyHops > 0) app.set('trust proxy', proxyHops);
if (process.env.NODE_ENV === 'production') {
  if (!process.env.MONGODB_URI || /localhost|127\.0\.0\.1/i.test(process.env.MONGODB_URI)) throw new Error('Set MONGODB_URI to a reachable production database.');
  if (!process.env.CLIENT_ORIGIN || [...configuredOrigins].some(origin => { try { return new URL(origin).protocol !== 'https:' || new URL(origin).origin !== origin; } catch { return true; } })) throw new Error('Set CLIENT_ORIGIN to the exact HTTPS origin for this deployment.');
  if (process.env.TRUST_PROXY_HOPS === undefined || proxyHops < 1) throw new Error('Set TRUST_PROXY_HOPS to the verified number of HTTPS reverse-proxy hops in production.');
}
const structuredDataHashes = ['index.html', 'privacy.html', 'brunswick-east.html', 'maribyrnong.html', 'st-albans.html'].flatMap(filename => {
  const html = readFileSync(path.join(root, filename), 'utf8');
  return [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map(match => `'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`);
});

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: { directives: {
  defaultSrc: ["'self'"], baseUri: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'self'"], formAction: ["'self'"],
  scriptSrc: ["'self'", 'https://www.googletagmanager.com', ...structuredDataHashes], scriptSrcAttr: ["'none'"],
  styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'], fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
  imgSrc: ["'self'", 'data:', 'https:'], frameSrc: ['https://www.google.com', 'https://maps.google.com'],
  connectSrc: ["'self'", 'https://www.google-analytics.com', 'https://region1.google-analytics.com'],
  ...(process.env.NODE_ENV === 'production' ? { upgradeInsecureRequests: [] } : {})
} } }));
if (process.env.CLIENT_ORIGIN || process.env.NODE_ENV !== 'production') app.use(cors({ origin: [...configuredOrigins], credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] }));
app.use(express.json({ limit: '30kb', type: 'application/json' }));
app.use(express.urlencoded({ extended: false, limit: '30kb' }));
app.use((req, res, next) => { req.body ||= {}; next(); });
app.use(cookieParser());
// When a Vite production build exists, serve the React portal from the same
// origin as the API so HTTP-only session cookies keep their existing behavior.
const hasReactBuild = existsSync(path.join(clientDist, 'index.html'));
const portalScreens = new Set(['overview', 'orders', 'new-order', 'notifications', 'profile', 'my-messages', 'inbox', 'manage-orders', 'services', 'settings', 'customers', 'audit']);
if (hasReactBuild) {
  app.use('/portal', express.static(clientDist, { index: false, maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0, fallthrough: true }));
  app.get('/portal.html', (req, res) => res.redirect(308, '/portal/'));
  app.get(['/portal', '/portal/'], (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  app.get('/portal/:role/:screen?', (req, res, next) => {
    const { role, screen } = req.params;
    if (!['admin', 'customer'].includes(role) || (screen && !portalScreens.has(screen))) return next();
    return res.sendFile(path.join(clientDist, 'index.html'));
  });
}
const publicFiles = new Set(['/index.html', '/privacy.html', '/robots.txt', ...(!hasReactBuild ? ['/portal.html', '/portal.js', '/portal.css'] : [])]);
const publicStatic = express.static(root, { index: 'index.html', maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 });
app.use((req, res, next) => {
  const isPublic = req.path === '/' || publicFiles.has(req.path) || ['/assets/', '/css/', '/js/'].some(prefix => req.path.startsWith(prefix));
  return isPublic ? publicStatic(req, res, next) : next();
});

const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false });
const messageLimit = rateLimit({ windowMs: 60 * 60 * 1000, limit: 8, standardHeaders: 'draft-7', legacyHeaders: false });
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const safeUser = user => ({ id: String(user._id), name: user.name, email: user.email, phone: user.phone, role: user.role, addresses: user.addresses || [] });
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isAdmin = (req, res, next) => req.user?.role === 'admin' ? next() : res.status(403).json({ error: 'Admin access required.' });
const isObjectId = id => mongoose.isValidObjectId(id);

app.use('/api', (req, res, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const origin = req.get('origin');
    const sameOrigin = origin && `${req.protocol}://${req.get('host')}` === origin;
    if (origin && !sameOrigin && !configuredOrigins.has(origin)) return res.status(403).json({ error: 'Request origin is not allowed.' });
  }
  next();
});

function authenticate(req, res, next) {
  const token = req.cookies.laundry_token || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  Promise.resolve().then(async () => {
    if (!token) return res.status(401).json({ error: 'Please sign in to continue.' });
    const claims = jwt.verify(token, secret);
    const user = await User.findById(claims.sub);
    if (!user || !user.active) return res.status(401).json({ error: 'Account unavailable. Please sign in again.' });
    req.user = user;
    next();
  }).catch(error => {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') return res.status(401).json({ error: 'Session expired. Please sign in again.' });
    return next(error);
  });
}
const issueSession = (res, user) => res.cookie('laundry_token', jwt.sign({ sub: String(user._id) }, secret, { expiresIn: '7d' }), {
  httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 86400000, path: '/'
});
const clearSession = res => res.clearCookie('laundry_token', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' });
const audit = (actor, action, targetType, targetId, details = {}) => AuditLog.create({ actor, action, targetType, targetId: String(targetId), details });
const notify = (user, type, title, body, order) => Notification.create({ user, type, title, body, order });
const serializeOrder = order => {
  const result = order.toObject ? order.toObject() : order;
  result.status = normalizeStatus(result.status);
  result.priceBreakdown ||= { subtotal: result.amount, deliveryFee: 0, minimumAdjustment: 0, estimatedTotal: result.amount };
  result.amount = result.priceBreakdown.estimatedTotal;
  return result;
};

app.get('/api/health', (req, res) => res.json({ status: 'ok', database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' }));

app.post('/api/auth/register', authLimit, asyncRoute(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const phone = String(req.body.phone || '').trim();
  const password = req.body.password;
  if (!name || name.length > 80 || !emailPattern.test(email) || email.length > 254 || !phone || phone.length > 20 || typeof password !== 'string' || password.length < 10 || password.length > 128) return res.status(400).json({ error: 'Enter your name, valid email, phone and a password between 10 and 128 characters.' });
  const user = await User.create({ name, email, phone, passwordHash: await bcrypt.hash(password, 12) });
  issueSession(res, user);
  return res.status(201).json({ user: safeUser(user) });
}));

app.post('/api/auth/login', authLimit, asyncRoute(async (req, res) => {
  const user = await User.findOne({ email: String(req.body.email || '').trim().toLowerCase() }).select('+passwordHash');
  if (!user || !user.active || !await bcrypt.compare(String(req.body.password || ''), user.passwordHash)) return res.status(401).json({ error: 'Email or password is incorrect.' });
  issueSession(res, user);
  return res.json({ user: safeUser(user) });
}));
app.get('/api/auth/me', authenticate, (req, res) => res.json({ user: safeUser(req.user) }));
app.post('/api/auth/logout', (req, res) => clearSession(res).json({ ok: true }));

app.get('/api/profile', authenticate, (req, res) => res.json({ user: safeUser(req.user) }));
app.patch('/api/profile', authenticate, asyncRoute(async (req, res) => {
  const update = {};
  if (req.body.name !== undefined) {
    const name = String(req.body.name).trim();
    if (!name || name.length > 80) return res.status(400).json({ error: 'Name must be between 1 and 80 characters.' });
    update.name = name;
  }
  if (req.body.phone !== undefined) {
    const phone = String(req.body.phone).trim();
    if (!phone || phone.length > 20) return res.status(400).json({ error: 'Enter a valid phone number.' });
    update.phone = phone;
  }
  if (req.body.addresses !== undefined) {
    if (!Array.isArray(req.body.addresses) || req.body.addresses.length > 10 || req.body.addresses.some(a => !a || typeof a !== 'object' || !String(a.address || '').trim() || String(a.address).length > 300)) return res.status(400).json({ error: 'Add up to 10 valid pickup addresses.' });
    update.addresses = req.body.addresses.map((a, i) => ({ label: String(a.label || 'Home').trim().slice(0, 40), address: String(a.address).trim(), location: validLocation(a.location), isDefault: Boolean(a.isDefault) || (i === 0 && !req.body.addresses.some(x => x.isDefault)) }));
  }
  const user = await User.findByIdAndUpdate(req.user._id, { $set: update }, { new: true, runValidators: true });
  return res.json({ user: safeUser(user) });
}));

const defaultServices = [
  { slug: 'wash-fold', name: 'Wash & Fold', description: 'Everyday washing, tumble dry and neatly folded.', unit: 'kg', price: 90, minimumQuantity: 1 },
  { slug: 'steam-ironing', name: 'Steam Ironing', description: 'A crisp steam press for everyday garments.', unit: 'piece', price: 25, minimumQuantity: 1 },
  { slug: 'regular-ironing', name: 'Regular Ironing', description: 'Careful traditional ironing, ready to wear.', unit: 'piece', price: 15, minimumQuantity: 1 },
  { slug: 'dry-clean', name: 'Dry Cleaning', description: 'Specialist care for delicate and occasion wear.', unit: 'piece', price: 220, minimumQuantity: 1 },
  { slug: 'wash-iron', name: 'Wash & Iron', description: 'A convenient wash followed by a clean press.', unit: 'kg', price: 130, minimumQuantity: 1 },
  { slug: 'express', name: 'Express Care', description: 'Priority processing for time-sensitive laundry.', unit: 'kg', price: 160, minimumQuantity: 1 }
];
async function ensureDefaults() {
  if (!await Service.exists({})) await Service.insertMany(defaultServices);
  await BusinessSettings.updateOne({ key: 'business' }, { $setOnInsert: { key: 'business' } }, { upsert: true });
}
async function removeOrphanedPickupReservations() {
  const orphaned = await PickupReservation.aggregate([
    { $lookup: { from: Order.collection.name, localField: 'order', foreignField: '_id', as: 'matchedOrder' } },
    { $match: { matchedOrder: { $eq: [] } } },
    { $project: { _id: 1 } }
  ]);
  if (orphaned.length) await PickupReservation.deleteMany({ _id: { $in: orphaned.map(item => item._id) } });
}
app.get('/api/services', asyncRoute(async (req, res) => {
  const [services, settings] = await Promise.all([Service.find({ available: true }).sort({ name: 1 }).lean(), BusinessSettings.findOne({ key: 'business' }).lean()]);
  return res.json({ services, settings: settings || {} });
}));
app.get('/api/admin/services', authenticate, isAdmin, asyncRoute(async (req, res) => res.json({ services: await Service.find().sort({ name: 1 }).lean() })));
app.post('/api/admin/services', authenticate, isAdmin, asyncRoute(async (req, res) => {
  const { slug, name, description, unit, price, minimumQuantity, available } = req.body;
  if (!/^[a-z0-9-]{2,50}$/.test(slug || '') || !name?.trim() || !['kg', 'piece'].includes(unit) || !Number.isFinite(+price) || +price < 0 || !Number.isFinite(+(minimumQuantity || 1)) || +(minimumQuantity || 1) < 1) return res.status(400).json({ error: 'Enter a valid service name, slug, unit, price and minimum quantity.' });
  const service = await Service.create({ slug, name, description: String(description || '').slice(0, 300), unit, price: +price, minimumQuantity: +(minimumQuantity || 1), available: available !== false });
  await audit(req.user._id, 'service.created', 'service', service._id, { slug });
  return res.status(201).json({ service });
}));
app.patch('/api/admin/services/:id', authenticate, isAdmin, asyncRoute(async (req, res) => {
  if (!isObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid service ID.' });
  const allowed = ['name', 'description', 'unit', 'price', 'minimumQuantity', 'available'];
  const update = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)));
  if ('price' in update && (!Number.isFinite(+update.price) || +update.price < 0)) return res.status(400).json({ error: 'Price must be zero or greater.' });
  if ('unit' in update && !['kg', 'piece'].includes(update.unit)) return res.status(400).json({ error: 'Unit must be kg or piece.' });
  if ('name' in update) update.name = String(update.name).trim();
  if ('description' in update) update.description = String(update.description).slice(0, 300);
  if ('price' in update) update.price = +update.price;
  if ('minimumQuantity' in update) update.minimumQuantity = +update.minimumQuantity;
  const service = await Service.findByIdAndUpdate(req.params.id, { $set: update }, { new: true, runValidators: true });
  if (!service) return res.status(404).json({ error: 'Service not found.' });
  await audit(req.user._id, 'service.updated', 'service', service._id, update);
  return res.json({ service });
}));

app.get('/api/pickup-slots', asyncRoute(async (req, res) => {
  const date = String(req.query.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Date must use YYYY-MM-DD.' });
  const settings = await BusinessSettings.findOne({ key: 'business' }).lean() || {};
  const [year, month, day] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  if (!(settings.businessDays || [1, 2, 3, 4, 5, 6]).includes(weekday)) return res.json({ slots: [] });
  const indiaOffsetMinutes = 330;
  const localMidnightUtc = Date.UTC(year, month - 1, day) - indiaOffsetMinutes * 60000;
  const openHour = settings.openHour ?? 8, closeHour = settings.closeHour ?? 20, duration = settings.slotDurationMinutes ?? 120;
  const slots = [];
  for (let minute = openHour * 60; minute + duration <= closeHour * 60; minute += duration) {
    const start = new Date(localMidnightUtc + minute * 60000);
    const end = new Date(start.getTime() + duration * 60000);
    const slotKey = start.toISOString();
    const [reserved, legacyCount] = await Promise.all([
      PickupReservation.countDocuments({ slotKey }),
      Order.countDocuments({ pickupAt: { $gte: start, $lt: end }, pickupReservation: { $exists: false }, status: { $nin: ['cancelled', 'rejected', 'delivered'] } })
    ]);
    const count = reserved + legacyCount;
    slots.push({ start: start.toISOString(), end: end.toISOString(), label: new Intl.DateTimeFormat('en-IN', { timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(start), available: count < (settings.slotCapacity || 8) && start > new Date() });
  }
  return res.json({ slots });
}));

app.get('/api/admin/settings', authenticate, isAdmin, asyncRoute(async (req, res) => res.json({ settings: await BusinessSettings.findOne({ key: 'business' }).lean() })));
app.patch('/api/admin/settings', authenticate, isAdmin, asyncRoute(async (req, res) => {
  const allowed = ['deliveryFee', 'minimumOrderValue', 'openHour', 'closeHour', 'slotCapacity', 'slotDurationMinutes', 'businessDays'];
  const update = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)));
  for (const key of ['deliveryFee', 'minimumOrderValue']) if (key in update && (!Number.isFinite(+update[key]) || +update[key] < 0)) return res.status(400).json({ error: `${key} must be zero or greater.` });
  if ('businessDays' in update && (!Array.isArray(update.businessDays) || update.businessDays.some(d => !Number.isInteger(d) || d < 0 || d > 6))) return res.status(400).json({ error: 'Business days must be weekday numbers from 0 to 6.' });
  const current = await BusinessSettings.findOne({ key: 'business' }).lean() || {};
  if (('openHour' in update || 'closeHour' in update) && Number(update.openHour ?? current.openHour ?? 8) >= Number(update.closeHour ?? current.closeHour ?? 20)) return res.status(400).json({ error: 'Closing time must be later than opening time.' });
  const settings = await BusinessSettings.findOneAndUpdate({ key: 'business' }, { $set: update }, { new: true, upsert: true, runValidators: true });
  await audit(req.user._id, 'settings.updated', 'business', settings._id, update);
  return res.json({ settings });
}));

function validLocation(location) {
  if (!location || !Number.isFinite(Number(location.lat)) || !Number.isFinite(Number(location.lng))) return undefined;
  const lat = Number(location.lat), lng = Number(location.lng);
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 ? { lat, lng } : undefined;
}
function validPickup(value) {
  const date = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? new Date(`${value}:00+05:30`) : new Date(value);
  return Number.isFinite(date.getTime()) && date > new Date(Date.now() + 60 * 60 * 1000) ? date : null;
}
function queryDate(value, endOfDay = false) {
  if (!value) return null;
  const input = /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? `${value}T${endOfDay ? '23:59:59.999' : '00:00:00'}+05:30` : value;
  const parsed = new Date(input);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}
async function buildOrderData(body, excludeOrderId) {
  const service = await Service.findOne({ slug: String(body.service || ''), available: true });
  if (!service) throw Object.assign(new Error('Choose an available laundry service.'), { status: 400 });
  const quantity = Number(body.quantity ?? body.weightKg ?? body.serviceSnapshot?.quantity);
  const settings = await BusinessSettings.findOne({ key: 'business' }).lean() || {};
  const priceBreakdown = quoteOrder({ service, quantity, deliveryFee: settings.deliveryFee || 0, minimumOrderValue: settings.minimumOrderValue || 0 });
  const pickupAt = validPickup(body.pickupAt);
  if (!pickupAt) throw Object.assign(new Error('Pickup must be scheduled at least one hour from now.'), { status: 400 });
  const now = new Date(pickupAt);
  const local = new Date(now.getTime() + 330 * 60000);
  const localDate = `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}-${String(local.getUTCDate()).padStart(2, '0')}`;
  const [year, month, day] = localDate.split('-').map(Number);
  const localMidnightUtc = Date.UTC(year, month - 1, day) - 330 * 60000;
  const localMinute = local.getUTCHours() * 60 + local.getUTCMinutes();
  const openMinute = (settings.openHour ?? 8) * 60, slotDuration = settings.slotDurationMinutes || 120;
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const startMinute = openMinute + Math.max(0, Math.floor((localMinute - openMinute) / slotDuration)) * slotDuration;
  if (!(settings.businessDays || [1, 2, 3, 4, 5, 6]).includes(weekday) || localMinute < openMinute || localMinute + slotDuration > (settings.closeHour ?? 20) * 60 || localMinute !== startMinute || now.getUTCSeconds() !== 0 || now.getUTCMilliseconds() !== 0) throw Object.assign(new Error('Select one of the available pickup windows.'), { status: 400 });
  const slotStart = new Date(localMidnightUtc + startMinute * 60000);
  const capacity = settings.slotCapacity || 8;
  const legacyFilter = { pickupAt: { $gte: slotStart, $lt: new Date(slotStart.getTime() + slotDuration * 60000) }, pickupReservation: { $exists: false }, status: { $nin: ['cancelled', 'rejected', 'delivered'] } };
  if (excludeOrderId) legacyFilter._id = { $ne: excludeOrderId };
  const legacyCount = await Order.countDocuments(legacyFilter);
  if (legacyCount >= capacity) throw Object.assign(new Error('This pickup time is full. Please select another available slot.'), { status: 409 });
  const address = String(body.address || '').trim();
  if (!address || address.length > 300) throw Object.assign(new Error('Add a pickup address of no more than 300 characters.'), { status: 400 });
  const snapshot = { name: service.name, description: service.description, unit: service.unit, unitPrice: service.price, quantity, subtotal: priceBreakdown.subtotal };
  return { service: service.slug, serviceSnapshot: snapshot, weightKg: service.unit === 'kg' ? quantity : undefined, pickupAt, address, location: validLocation(body.location), notes: String(body.notes || '').trim().slice(0, 1000), priceBreakdown, amount: priceBreakdown.estimatedTotal, _slot: { key: slotStart.toISOString(), capacity, legacyCount } };
}
async function claimPickupSlot(slotKey, capacity, orderId, legacyCount = 0) {
  for (let seat = legacyCount; seat < capacity; seat++) {
    try { return await PickupReservation.create({ slotKey, seat, order: orderId }); }
    catch (error) { if (error.code !== 11000) throw error; }
  }
  throw Object.assign(new Error('This pickup window just filled. Please choose another available time.'), { status: 409 });
}
app.post('/api/orders', authenticate, asyncRoute(async (req, res) => {
  const clientRequestId = String(req.get('Idempotency-Key') || req.body.clientRequestId || '').slice(0, 80);
  if (clientRequestId) {
    const existing = await Order.findOne({ customer: req.user._id, clientRequestId }).populate('customer', 'name email phone');
    if (existing) return res.status(200).json({ order: serializeOrder(existing), duplicate: true });
  }
  let data;
  try { data = await buildOrderData(req.body); } catch (error) { return res.status(error.status || 400).json({ error: error.message }); }
  const { _slot, ...orderData } = data;
  const orderId = new mongoose.Types.ObjectId();
  const reservation = await claimPickupSlot(_slot.key, _slot.capacity, orderId, _slot.legacyCount);
  let order;
  try {
    order = await Order.create({ ...orderData, _id: orderId, pickupReservation: reservation._id, customer: req.user._id, clientRequestId: clientRequestId || undefined, orderNumber: `ML${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`, status: 'booking_received', statusHistory: [{ status: 'booking_received', actor: req.user._id, actorRole: req.user.role, note: 'Booking submitted by customer' }] });
  } catch (error) {
    await PickupReservation.deleteOne({ _id: reservation._id });
    if (clientRequestId && error.code === 11000) {
      const duplicate = await Order.findOne({ customer: req.user._id, clientRequestId });
      if (duplicate) return res.status(200).json({ order: serializeOrder(duplicate), duplicate: true });
    }
    throw error;
  }
  await notify(req.user._id, 'order_update', 'Booking received', customerFriendlyStatus(order.status), order._id);
  await dispatchOrderNotifications({ email: req.user.email, phone: req.user.phone, orderNumber: order.orderNumber, status: order.status, message: customerFriendlyStatus(order.status) });
  return res.status(201).json({ order: serializeOrder(order) });
}));

app.get('/api/orders', authenticate, asyncRoute(async (req, res) => {
  const page = Math.max(1, Math.min(100000, parseInt(req.query.page, 10) || 1));
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 50));
  const filter = req.user.role === 'admin' ? {} : { customer: req.user._id };
  const status = String(req.query.status || '');
  if (status && status !== 'all' && !ORDER_STATUSES.includes(status) && !['placed', 'confirmed', 'ready'].includes(status)) return res.status(400).json({ error: 'Invalid order status filter.' });
  if (req.query.paymentStatus && !['paid', 'unpaid'].includes(req.query.paymentStatus)) return res.status(400).json({ error: 'Invalid payment status filter.' });
  if (status && status !== 'all') filter.status = status === 'placed' ? { $in: ['placed', 'booking_received'] } : status === 'confirmed' ? { $in: ['confirmed', 'pickup_scheduled'] } : status;
  if (req.query.service) filter.service = String(req.query.service);
  if (req.query.paymentStatus) filter.paymentStatus = req.query.paymentStatus;
  if (req.query.from || req.query.to) {
    filter.pickupAt = {};
    const from = queryDate(req.query.from), to = queryDate(req.query.to, true);
    if (req.query.from && !from || req.query.to && !to || from && to && from > to) return res.status(400).json({ error: 'Enter a valid date range.' });
    if (from) filter.pickupAt.$gte = from;
    if (to) filter.pickupAt.$lte = to;
  }
  const search = String(req.query.search || '').trim().slice(0, 100);
  if (req.user.role === 'admin' && search) {
    const safe = new RegExp(escapeRegex(search), 'i');
    const customerIds = await User.find({ role: 'customer', $or: [{ name: safe }, { phone: safe }, { email: safe }] }).distinct('_id');
    filter.$or = [{ orderNumber: safe }, { customer: { $in: customerIds } }];
  }
  const sortFields = { pickupAt: 'pickupAt', createdAt: 'createdAt', amount: 'amount', status: 'status' };
  const sortField = sortFields[req.query.sort] || 'createdAt';
  const sortDirection = req.query.direction === 'asc' ? 1 : -1;
  const [orders, total, statusSummary] = await Promise.all([
    Order.find(filter).populate('customer', 'name email phone').populate('statusHistory.actor', 'name role').sort({ [sortField]: sortDirection, _id: -1 }).skip((page - 1) * limit).limit(limit),
    Order.countDocuments(filter),
    Order.aggregate([{ $match: req.user.role === 'admin' ? {} : { customer: req.user._id } }, { $group: { _id: '$status', count: { $sum: 1 } } }])
  ]);
  return res.json({ orders: orders.map(serializeOrder), summary: Object.fromEntries(statusSummary.map(x => [normalizeStatus(x._id), x.count])), pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
}));
app.get('/api/orders/:id', authenticate, asyncRoute(async (req, res) => {
  if (!isObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid order ID.' });
  const order = await Order.findById(req.params.id).populate('customer', 'name email phone').populate('statusHistory.actor', 'name role');
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  if (req.user.role !== 'admin' && String(order.customer._id) !== String(req.user._id)) return res.status(404).json({ error: 'Order not found.' });
  return res.json({ order: serializeOrder(order) });
}));
app.put('/api/orders/:id', authenticate, asyncRoute(async (req, res) => {
  if (!isObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid order ID.' });
  const order = await Order.findOne({ _id: req.params.id, customer: req.user._id });
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  if (normalizeStatus(order.status) !== 'booking_received') return res.status(409).json({ error: 'Only a booking awaiting confirmation can be changed.' });
  let data;
  try { data = await buildOrderData({ ...order.toObject(), ...req.body }, order._id); } catch (error) { return res.status(error.status || 400).json({ error: error.message }); }
  const { _slot, ...orderData } = data;
  const currentReservation = order.pickupReservation ? await PickupReservation.findById(order.pickupReservation) : null;
  let replacement;
  if (!currentReservation || currentReservation.slotKey !== _slot.key) replacement = await claimPickupSlot(_slot.key, _slot.capacity, order._id);
  const priorReservationId = currentReservation?._id;
  Object.assign(order, orderData, replacement ? { pickupReservation: replacement._id } : {});
  try { await order.save(); } catch (error) { if (replacement) await PickupReservation.deleteOne({ _id: replacement._id }); throw error; }
  if (replacement && priorReservationId) await PickupReservation.deleteOne({ _id: priorReservationId });
  await audit(req.user._id, 'order.updated', 'order', order._id, { customerEdit: true });
  return res.json({ order: serializeOrder(order) });
}));
async function changeOrderStatus({ order, status, reason, actor, actorRole }) {
  const prior = normalizeStatus(order.status);
  if (!canTransition(prior, status)) throw Object.assign(new Error(`Cannot move an order from ${prior.replaceAll('_', ' ')} to ${status.replaceAll('_', ' ')}.`), { status: 409 });
  if (['cancelled', 'rejected'].includes(status) && !String(reason || '').trim()) throw Object.assign(new Error('A reason is required to cancel or reject an order.'), { status: 400 });
  order.status = status;
  if (['cancelled', 'rejected'].includes(status)) order.cancellationReason = String(reason).trim().slice(0, 300);
  order.statusHistory.push({ status, actor, actorRole, note: String(reason || '').trim().slice(0, 300) });
  await order.save();
  if (['cancelled', 'rejected'].includes(status) && order.pickupReservation) await PickupReservation.deleteOne({ _id: order.pickupReservation });
  await notify(order.customer, 'order_update', `Order ${order.orderNumber} · ${status.replaceAll('_', ' ')}`, customerFriendlyStatus(status), order._id);
  const recipient = await User.findById(order.customer).select('email phone');
  if (recipient) await dispatchOrderNotifications({ email: recipient.email, phone: recipient.phone, orderNumber: order.orderNumber, status, message: customerFriendlyStatus(status) });
  return { prior, order };
}
app.patch('/api/orders/:id/cancel', authenticate, asyncRoute(async (req, res) => {
  if (!isObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid order ID.' });
  const order = await Order.findOne({ _id: req.params.id, customer: req.user._id });
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  const result = await changeOrderStatus({ order, status: 'cancelled', reason: req.body.reason || 'Cancelled by customer', actor: req.user._id, actorRole: 'customer' });
  await audit(req.user._id, 'order.cancelled', 'order', order._id, { priorStatus: result.prior, reason: order.cancellationReason });
  return res.json({ order: serializeOrder(order) });
}));
app.patch('/api/orders/:id/status', authenticate, isAdmin, asyncRoute(async (req, res) => {
  if (!isObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid order ID.' });
  if (!ORDER_STATUSES.includes(req.body.status)) return res.status(400).json({ error: 'Choose a valid order status.' });
  const order = await Order.findById(req.params.id).populate('customer', 'name email phone');
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  const result = await changeOrderStatus({ order, status: req.body.status, reason: req.body.reason || req.body.note, actor: req.user._id, actorRole: 'admin' });
  await audit(req.user._id, 'order.status_changed', 'order', order._id, { from: result.prior, to: req.body.status, reason: order.cancellationReason || '' });
  return res.json({ order: serializeOrder(order) });
}));
app.patch('/api/orders/:id/quote', authenticate, isAdmin, asyncRoute(async (req, res) => {
  if (!isObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid order ID.' });
  const finalTotal = Number(req.body.finalTotal);
  const reason = String(req.body.reason || '').trim();
  if (!Number.isFinite(finalTotal) || finalTotal < 0 || finalTotal > 1000000 || reason.length < 3 || reason.length > 300) return res.status(400).json({ error: 'Enter a valid final amount and a short weighing/adjustment note.' });
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  if (['booking_received', 'pickup_scheduled', 'placed', 'confirmed', 'cancelled', 'rejected'].includes(order.status)) return res.status(409).json({ error: 'Set the final price after the laundry has been picked up.' });
  order.priceBreakdown.finalTotal = Math.round(finalTotal * 100) / 100;
  await order.save();
  await notify(order.customer, 'order_update', `Final price ready · ${order.orderNumber}`, `The final price for your laundry is ${new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(finalTotal)}. ${reason}`, order._id);
  const recipient = await User.findById(order.customer).select('email phone');
  if (recipient) await dispatchOrderNotifications({ email: recipient.email, phone: recipient.phone, orderNumber: order.orderNumber, status: order.status, message: `Final price: ${new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(finalTotal)}. ${reason}` });
  await audit(req.user._id, 'order.final_price_set', 'order', order._id, { finalTotal, reason });
  return res.json({ order: serializeOrder(order) });
}));
app.patch('/api/orders/:id/payment', authenticate, isAdmin, asyncRoute(async (req, res) => {
  if (!isObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid order ID.' });
  if (req.body.paymentStatus !== 'unpaid') return res.status(400).json({ error: 'Payments cannot be marked paid without a configured verified payment integration.' });
  const order = await Order.findByIdAndUpdate(req.params.id, { $set: { paymentStatus: 'unpaid' }, $unset: { paidAt: 1 } }, { new: true });
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  await audit(req.user._id, 'order.payment_reset', 'order', order._id);
  return res.json({ order: serializeOrder(order) });
}));

app.get('/api/notifications', authenticate, asyncRoute(async (req, res) => {
  const [items, unread] = await Promise.all([Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50).lean(), Notification.countDocuments({ user: req.user._id, readAt: null })]);
  return res.json({ notifications: items, unread });
}));
app.patch('/api/notifications/:id/read', authenticate, asyncRoute(async (req, res) => {
  if (!isObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid notification ID.' });
  const notification = await Notification.findOneAndUpdate({ _id: req.params.id, user: req.user._id, readAt: null }, { $set: { readAt: new Date() } }, { new: true });
  if (!notification) return res.status(404).json({ error: 'Notification not found.' });
  return res.json({ notification });
}));

app.post('/api/messages', messageLimit, asyncRoute(async (req, res) => {
  if (String(req.body._honey || '').trim()) return res.status(400).json({ error: 'Message could not be accepted.' });
  const name = String(req.body.name || '').trim(), email = String(req.body.email || '').trim().toLowerCase(), body = String(req.body.message || '').trim();
  if (!name || name.length > 80 || !emailPattern.test(email) || body.length < 1 || body.length > 2000) return res.status(400).json({ error: 'Name, valid email and a message of up to 2,000 characters are required.' });
  let customer;
  if (req.cookies.laundry_token) {
    try { customer = jwt.verify(req.cookies.laundry_token, secret).sub; } catch { /* Public enquiries do not require an account. */ }
  }
  const record = await Message.create({ customer, name, email, phone: String(req.body.phone || '').slice(0, 20), locationName: String(req.body.location || '').slice(0, 120), body });
  if (req.is('application/x-www-form-urlencoded') && req.accepts('html')) return res.status(201).type('html').send('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Message received · Muniyasamy Laundry</title><body style="font:16px system-ui;max-width:560px;margin:12vh auto;padding:24px;color:#18344d"><h1>Thanks, we received your message.</h1><p>The Muniyasamy Laundry team will follow up using the contact details you provided.</p><a href="/#contact">Return to Muniyasamy Laundry</a></body></html>');
  return res.status(201).json({ message: 'Message sent to the laundry team.', id: record._id });
}));
app.get('/api/messages', authenticate, isAdmin, asyncRoute(async (req, res) => {
  const filter = req.query.archived === 'true' ? { archivedAt: { $ne: null } } : { archivedAt: null };
  if (req.query.read === 'false') filter.readAt = null;
  if (req.query.read === 'true') filter.readAt = { $ne: null };
  const messages = await Message.find(filter).populate('customer', 'name email phone').sort({ createdAt: -1 }).limit(200);
  return res.json({ messages });
}));
app.get('/api/my-messages', authenticate, asyncRoute(async (req, res) => {
  const messages = await Message.find({ customer: req.user._id }).sort({ createdAt: -1 }).limit(100).lean();
  return res.json({ messages });
}));
app.patch('/api/messages/:id', authenticate, isAdmin, asyncRoute(async (req, res) => {
  if (!isObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid message ID.' });
  const update = {};
  if (req.body.read === true) update.readAt = new Date();
  if (req.body.archived === true) update.archivedAt = new Date();
  if (req.body.archived === false) update.archivedAt = null;
  if (typeof req.body.reply === 'string') {
    const reply = req.body.reply.trim();
    if (!reply || reply.length > 2000) return res.status(400).json({ error: 'Reply must be between 1 and 2,000 characters.' });
    update.reply = reply; update.repliedAt = new Date();
  }
  const message = await Message.findByIdAndUpdate(req.params.id, { $set: update }, { new: true, runValidators: true });
  if (!message) return res.status(404).json({ error: 'Message not found.' });
  if (update.reply) {
    if (message.customer) await notify(message.customer, 'message_reply', 'The laundry team replied', `Reply: ${update.reply}`);
    await dispatchOrderNotifications({ email: message.email, phone: message.phone, orderNumber: 'Customer care', status: 'message_reply', message: update.reply });
  }
  await audit(req.user._id, 'message.updated', 'message', message._id, Object.keys(update));
  return res.json({ message });
}));

app.get('/api/admin/overview', authenticate, isAdmin, asyncRoute(async (req, res) => {
  const now = new Date();
  const indiaNow = new Date(now.getTime() + 330 * 60000);
  const startOfIndiaDay = new Date(Date.UTC(indiaNow.getUTCFullYear(), indiaNow.getUTCMonth(), indiaNow.getUTCDate()) - 330 * 60000);
  const endOfIndiaDay = new Date(startOfIndiaDay.getTime() + 24 * 60 * 60 * 1000);
  const [orders, totalOrders, unreadMessages, customers, revenue, ordersToday, upcomingPickups] = await Promise.all([
    Order.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Order.countDocuments(),
    Message.countDocuments({ readAt: null, archivedAt: null }),
    User.countDocuments({ role: 'customer' }),
    Order.aggregate([{ $match: { paymentStatus: 'paid' } }, { $group: { _id: null, total: { $sum: { $ifNull: ['$priceBreakdown.finalTotal', '$amount'] } } } }]),
    Order.countDocuments({ createdAt: { $gte: startOfIndiaDay, $lt: endOfIndiaDay } }),
    Order.countDocuments({ pickupAt: { $gte: now }, status: { $nin: ['cancelled', 'rejected', 'delivered'] } })
  ]);
  return res.json({ orders: Object.fromEntries(orders.map(x => [normalizeStatus(x._id), x.count])), totalOrders, unreadMessages, customers, revenue: revenue[0]?.total || 0, ordersToday, upcomingPickups });
}));
app.get('/api/admin/orders.csv', authenticate, isAdmin, asyncRoute(async (req, res) => {
  const limit = Math.min(10000, Math.max(1, parseInt(req.query.limit, 10) || 5000));
  const filter = {};
  if (req.query.status && req.query.status !== 'all' && ORDER_STATUSES.includes(req.query.status)) filter.status = req.query.status;
  if (req.query.service) filter.service = req.query.service;
  if (req.query.paymentStatus && ['paid', 'unpaid'].includes(req.query.paymentStatus)) filter.paymentStatus = req.query.paymentStatus;
  if (req.query.from || req.query.to) {
    filter.pickupAt = {};
    const from = queryDate(req.query.from), to = queryDate(req.query.to, true);
    if (from) filter.pickupAt.$gte = from;
    if (to) filter.pickupAt.$lte = to;
  }
  const search = String(req.query.search || '').trim().slice(0, 100);
  if (search) { const regex = new RegExp(escapeRegex(search), 'i'); const customerIds = await User.find({ role: 'customer', $or: [{ name: regex }, { phone: regex }, { email: regex }] }).distinct('_id'); filter.$or = [{ orderNumber: regex }, { customer: { $in: customerIds } }]; }
  const orders = await Order.find(filter).populate('customer', 'name email phone').sort({ createdAt: -1 }).limit(limit).lean();
  const cell = value => {
    const safe = String(value ?? '').replace(/^[\s\u0000-\u001f]*([=+@]|-)/, "'$1");
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const rows = [['order_id', 'customer', 'phone', 'service', 'quantity', 'unit', 'pickup_at', 'status', 'payment_status', 'estimated_total'], ...orders.map(o => [o.orderNumber, o.customer?.name, o.customer?.phone, o.serviceSnapshot?.name || o.service, o.serviceSnapshot?.quantity ?? o.weightKg, o.serviceSnapshot?.unit || 'kg', o.pickupAt?.toISOString(), normalizeStatus(o.status), o.paymentStatus, o.priceBreakdown?.estimatedTotal ?? o.amount])];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', 'attachment; filename="muniyasamy-orders.csv"');
  return res.send(rows.map(row => row.map(cell).join(',')).join('\r\n'));
}));
app.get('/api/admin/customers', authenticate, isAdmin, asyncRoute(async (req, res) => {
  const search = String(req.query.search || '').trim().slice(0, 100);
  const filter = { role: 'customer' };
  if (search) { const regex = new RegExp(escapeRegex(search), 'i'); filter.$or = [{ name: regex }, { email: regex }, { phone: regex }]; }
  const customers = await User.find(filter).select('name email phone createdAt').sort({ createdAt: -1 }).limit(100).lean();
  const ids = customers.map(c => c._id);
  const counts = await Order.aggregate([{ $match: { customer: { $in: ids } } }, { $group: { _id: '$customer', count: { $sum: 1 }, lastOrder: { $max: '$createdAt' } } }]);
  const byId = new Map(counts.map(x => [String(x._id), x]));
  return res.json({ customers: customers.map(c => ({ ...c, orderCount: byId.get(String(c._id))?.count || 0, lastOrder: byId.get(String(c._id))?.lastOrder || null })) });
}));
app.get('/api/admin/customers/:id/orders', authenticate, isAdmin, asyncRoute(async (req, res) => {
  if (!isObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid customer ID.' });
  const customer = await User.findOne({ _id: req.params.id, role: 'customer' }).select('name email phone');
  if (!customer) return res.status(404).json({ error: 'Customer not found.' });
  const orders = await Order.find({ customer: customer._id }).sort({ createdAt: -1 }).limit(100).lean();
  return res.json({ customer, orders: orders.map(serializeOrder) });
}));
app.get('/api/admin/audit', authenticate, isAdmin, asyncRoute(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const logs = await AuditLog.find().populate('actor', 'name email').sort({ createdAt: -1 }).skip((page - 1) * 50).limit(50).lean();
  return res.json({ logs, page });
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
app.use('/api', (err, req, res, next) => {
  const status = err.status || (err.code === 11000 ? 409 : err.name === 'CastError' ? 400 : err.name === 'ValidationError' ? 400 : 500);
  if (status >= 500) console.error(JSON.stringify({ level: 'error', event: 'api_error', method: req.method, path: req.path, name: err.name || 'Error', code: err.code || 'INTERNAL' }));
  const message = err.code === 11000 ? 'That record already exists.' : err.name === 'CastError' ? 'Invalid record ID.' : err.name === 'ValidationError' ? 'Some submitted fields are invalid.' : err.type === 'entity.parse.failed' ? 'Malformed JSON request.' : status >= 500 ? 'Something went wrong. Please try again.' : err.message;
  return res.status(status).json({ error: message });
});
app.use((req, res) => res.status(404).type('text/plain').send('Not found.'));
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error(JSON.stringify({ level: 'error', event: 'request_error', method: req.method, path: req.path, name: err.name || 'Error' }));
  return res.status(err.status && err.status < 500 ? err.status : 500).type('text/plain').send(err.status && err.status < 500 ? err.message : 'Something went wrong. Please try again.');
});

export async function connectDatabase(uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/muniyasamy_laundry') {
  await mongoose.connect(uri);
  await Promise.all([User.init(), Service.init(), Order.init(), Message.init(), Notification.init(), AuditLog.init(), BusinessSettings.init(), PickupReservation.init()]);
  await ensureDefaults();
  await removeOrphanedPickupReservations();
  return mongoose.connection;
}
export async function start() {
  if (!process.env.MONGODB_URI) throw new Error('Set MONGODB_URI in the environment before starting the server.');
  await connectDatabase();
  const server = app.listen(port, process.env.HOST || '0.0.0.0', () => console.log(`Laundry platform listening on port ${port}`));
  let stopping = false;
  const shutdown = signal => {
    if (stopping) return;
    stopping = true;
    console.log(JSON.stringify({ level: 'info', event: 'shutdown_started', signal }));
    const timeout = setTimeout(() => process.exit(1), 10000);
    timeout.unref();
    server.close(async error => {
      try { await mongoose.disconnect(); } catch { /* process is already stopping */ }
      if (error) { console.error(JSON.stringify({ level: 'error', event: 'shutdown_failed', name: error.name })); process.exitCode = 1; }
      clearTimeout(timeout);
    });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  start().catch(error => { console.error(JSON.stringify({ level: 'error', event: 'startup_failed', name: error.name })); process.exit(1); });
}
export { app };
