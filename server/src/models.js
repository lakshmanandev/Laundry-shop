import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
  phone: { type: String, required: true, trim: true, maxlength: 20 },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['customer', 'admin'], default: 'customer' },
  active: { type: Boolean, default: true },
  addresses: [{ label: { type: String, trim: true, maxlength: 40 }, address: { type: String, trim: true, maxlength: 300 }, location: { lat: Number, lng: Number }, isDefault: { type: Boolean, default: false } }]
}, { timestamps: true });

const serviceSchema = new mongoose.Schema({
  slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  description: { type: String, trim: true, maxlength: 300, default: '' },
  unit: { type: String, enum: ['kg', 'piece'], required: true },
  price: { type: Number, required: true, min: 0 },
  minimumQuantity: { type: Number, required: true, min: 1, default: 1 },
  available: { type: Boolean, default: true }
}, { timestamps: true });

const statusHistorySchema = new mongoose.Schema({
  status: { type: String, required: true }, at: { type: Date, default: Date.now },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, actorRole: { type: String, enum: ['customer', 'admin', 'system'] }, note: { type: String, trim: true, maxlength: 300, default: '' }
}, { _id: false });

const orderSchema = new mongoose.Schema({
  orderNumber: { type: String, required: true, unique: true, index: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  service: { type: String, required: true, trim: true, index: true },
  serviceSnapshot: { name: String, description: String, unit: { type: String, enum: ['kg', 'piece'] }, unitPrice: Number, quantity: Number, subtotal: Number },
  weightKg: { type: Number, min: 0 },
  pickupAt: { type: Date, required: true, index: true },
  address: { type: String, required: true, trim: true, maxlength: 300 },
  location: { lat: Number, lng: Number },
  notes: { type: String, trim: true, maxlength: 1000, default: '' },
  priceBreakdown: { subtotal: { type: Number, min: 0, required: true }, deliveryFee: { type: Number, min: 0, default: 0 }, minimumAdjustment: { type: Number, min: 0, default: 0 }, estimatedTotal: { type: Number, min: 0, required: true }, finalTotal: { type: Number, min: 0 } },
  amount: { type: Number, required: true, min: 0 }, // Legacy alias for estimatedTotal.
  status: { type: String, enum: ['booking_received', 'pickup_scheduled', 'picked_up', 'processing', 'ready_for_delivery', 'out_for_delivery', 'delivered', 'cancelled', 'rejected', 'placed', 'confirmed', 'ready'], default: 'booking_received', index: true },
  cancellationReason: { type: String, trim: true, maxlength: 300, default: '' },
  paymentStatus: { type: String, enum: ['unpaid', 'paid'], default: 'unpaid', index: true },
  paidAt: Date,
  pickupReservation: { type: mongoose.Schema.Types.ObjectId, ref: 'PickupReservation' },
  statusHistory: { type: [statusHistorySchema], default: [] },
  clientRequestId: { type: String, trim: true, maxlength: 80 }
}, { timestamps: true });
orderSchema.index({ customer: 1, createdAt: -1 });
orderSchema.index({ status: 1, pickupAt: 1 });
orderSchema.index({ clientRequestId: 1, customer: 1 }, { unique: true, partialFilterExpression: { clientRequestId: { $type: 'string' } } });

const messageSchema = new mongoose.Schema({
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  name: { type: String, required: true, trim: true, maxlength: 80 }, email: { type: String, required: true, lowercase: true, trim: true },
  phone: { type: String, trim: true, maxlength: 20, default: '' }, locationName: { type: String, trim: true, maxlength: 120, default: '' },
  body: { type: String, required: true, trim: true, maxlength: 2000 }, readAt: Date, archivedAt: Date,
  reply: { type: String, trim: true, maxlength: 2000, default: '' }, repliedAt: Date
}, { timestamps: true });
messageSchema.index({ archivedAt: 1, createdAt: -1 });

const notificationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, enum: ['order_update', 'message_reply', 'system'], default: 'order_update' },
  title: { type: String, required: true, maxlength: 120 }, body: { type: String, required: true, maxlength: 300 },
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' }, readAt: Date
}, { timestamps: true });
notificationSchema.index({ user: 1, createdAt: -1 });

const auditSchema = new mongoose.Schema({
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, action: { type: String, required: true, maxlength: 80 },
  targetType: { type: String, required: true, maxlength: 40 }, targetId: { type: String, required: true, maxlength: 80 },
  details: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });
auditSchema.index({ createdAt: -1 });

const settingsSchema = new mongoose.Schema({
  key: { type: String, unique: true, default: 'business' }, currency: { type: String, default: 'INR' },
  deliveryFee: { type: Number, min: 0, default: 0 }, minimumOrderValue: { type: Number, min: 0, default: 0 },
  openHour: { type: Number, min: 0, max: 23, default: 8 }, closeHour: { type: Number, min: 1, max: 24, default: 20 },
  slotCapacity: { type: Number, min: 1, max: 100, default: 8 }, slotDurationMinutes: { type: Number, min: 30, max: 240, default: 120 },
  businessDays: { type: [Number], default: [1, 2, 3, 4, 5, 6] }
}, { timestamps: true });

const pickupReservationSchema = new mongoose.Schema({
  slotKey: { type: String, required: true }, seat: { type: Number, required: true }, order: { type: mongoose.Schema.Types.ObjectId, required: true, index: true }
}, { timestamps: true });
pickupReservationSchema.index({ slotKey: 1, seat: 1 }, { unique: true });

export const User = mongoose.model('User', userSchema);
export const Service = mongoose.model('Service', serviceSchema);
export const Order = mongoose.model('Order', orderSchema);
export const Message = mongoose.model('Message', messageSchema);
export const Notification = mongoose.model('Notification', notificationSchema);
export const AuditLog = mongoose.model('AuditLog', auditSchema);
export const BusinessSettings = mongoose.model('BusinessSettings', settingsSchema);
export const PickupReservation = mongoose.model('PickupReservation', pickupReservationSchema);
