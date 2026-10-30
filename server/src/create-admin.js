import 'dotenv/config';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { User } from './models.js';

if (!process.env.MONGODB_URI) throw new Error('Set MONGODB_URI in your environment before creating an admin.');
const rl = readline.createInterface({ input, output });
const ask = label => rl.question(label);
async function askSecret(label) {
  if (!input.isTTY || !output.isTTY) throw new Error('Run this command in an interactive terminal so the password can be entered securely.');
  output.write(label);
  input.setRawMode(true);
  input.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const onData = data => {
      const key = data.toString();
      if (key === '\u0003') { input.off('data', onData); input.setRawMode(false); reject(new Error('Cancelled.')); }
      else if (key === '\r' || key === '\n') { input.off('data', onData); input.setRawMode(false); output.write('\n'); resolve(value); }
      else if (key === '\u0008' || key === '\u007f') value = value.slice(0, -1);
      else if (key >= ' ') value += key;
    };
    input.on('data', onData);
  });
}

try {
  const name = (await ask('Admin display name: ')).trim();
  const email = (await ask('Admin email: ')).trim().toLowerCase();
  const phone = (await ask('Admin phone: ')).trim();
  const password = await askSecret('Admin password (hidden, 14+ characters): ');
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !phone || password.length < 14) throw new Error('Provide a name, valid email, phone number and password of at least 14 characters.');
  await mongoose.connect(process.env.MONGODB_URI);
  if (await User.exists({ email })) throw new Error('An account with this email already exists. No changes were made.');
  await User.create({ name, email, phone, passwordHash: await bcrypt.hash(password, 12), role: 'admin' });
  output.write('Admin account created. Keep the credentials in your approved password manager.\n');
} finally {
  rl.close();
  await mongoose.disconnect().catch(() => {});
}
