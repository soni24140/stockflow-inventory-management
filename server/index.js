import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from './prisma.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'local-development-secret-change-before-deploying-2026');
const TOKEN_TTL = '14d';
const COOKIE_NAME = 'stockflow_session';
const emailSchema = z.string().trim().email().max(254).transform(value => value.toLowerCase());
const signupSchema = z.object({
  email: emailSchema,
  password: z.string().min(8).max(256),
  organization: z.string().trim().min(1).max(100),
});
const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(256) });
const integerSchema = (label, maximum = 100_000_000) => z.number({ message: `${label} must be a whole number.` }).int().min(0, `${label} cannot be negative.`).max(maximum, `${label} is too large.`);
const nullablePrice = z.number({ message: 'Price must be a valid amount.' }).finite().min(0).max(1_000_000_000).nullable().optional();
const productSchema = z.object({
  name: z.string().trim().min(1, 'Product name is required.').max(120),
  sku: z.string().trim().min(1, 'SKU is required.').max(64),
  description: z.string().trim().max(1000).optional().default(''),
  quantity: integerSchema('Quantity'),
  cost_price: nullablePrice,
  selling_price: nullablePrice,
  low_stock_threshold: integerSchema('Low stock threshold').nullable().optional(),
});
const settingsSchema = z.object({ defaultThreshold: integerSchema('Default low stock threshold') });

if (process.env.NODE_ENV === 'production' && !JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production.');
}
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '64kb', strict: true }));
app.use(cookieParser());

app.get('/health', async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  res.json({ status: 'ok' });
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Please try again shortly.' },
});

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw httpError(400, result.error.issues[0]?.message || 'Invalid request.');
  return result.data;
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 14 * 24 * 60 * 60 * 1000,
  };
}

function setAuthCookie(res, user) {
  const token = jwt.sign({ sub: String(user.id), organizationId: user.organizationId }, JWT_SECRET, { expiresIn: TOKEN_TTL });
  res.cookie(COOKIE_NAME, token, cookieOptions());
}

async function authenticatedUser(req, optional = false) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    if (optional) return null;
    throw httpError(401, 'Please sign in to continue.');
  }
  let claims;
  try {
    claims = jwt.verify(token, JWT_SECRET);
  } catch {
    if (optional) return null;
    throw httpError(401, 'Your session has expired. Please sign in again.');
  }
  const userId = Number(claims.sub);
  const organizationId = Number(claims.organizationId);
  if (!Number.isSafeInteger(userId) || !Number.isSafeInteger(organizationId)) {
    if (optional) return null;
    throw httpError(401, 'Please sign in to continue.');
  }
  const user = await prisma.user.findFirst({
    where: { id: userId, organizationId },
    select: { id: true, email: true, organizationId: true, organization: { select: { name: true, defaultThreshold: true } } },
  });
  if (!user) {
    if (optional) return null;
    throw httpError(401, 'Please sign in to continue.');
  }
  return user;
}

function serializeProduct(product) {
  return {
    id: product.id,
    organization_id: product.organizationId,
    name: product.name,
    sku: product.sku,
    description: product.description,
    quantity: product.quantity,
    cost_price: product.costPrice,
    selling_price: product.sellingPrice,
    low_stock_threshold: product.lowStockThreshold,
    created_at: product.createdAt,
    updated_at: product.updatedAt,
  };
}

async function requireUser(req, _res, next) {
  try {
    req.user = await authenticatedUser(req);
    next();
  } catch (error) {
    next(error);
  }
}

app.post('/api/signup', authLimiter, async (req, res) => {
  const input = parse(signupSchema, req.body);
  const passwordHash = await bcrypt.hash(input.password, 12);
  try {
    const organization = await prisma.organization.create({
      data: {
        name: input.organization,
        user: { create: { email: input.email, passwordHash } },
      },
      include: { user: true },
    });
    setAuthCookie(res, organization.user);
    res.status(201).json({ user: { email: organization.user.email, organization: organization.name } });
  } catch (error) {
    if (error.code === 'P2002') throw httpError(409, 'An account with that email already exists.');
    throw error;
  }
});

app.post('/api/login', authLimiter, async (req, res) => {
  const input = parse(loginSchema, req.body);
  const user = await prisma.user.findUnique({ where: { email: input.email }, include: { organization: true } });
  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
    throw httpError(401, 'Email or password is incorrect.');
  }
  setAuthCookie(res, user);
  res.json({ user: { email: user.email, organization: user.organization.name } });
});

app.post('/api/logout', (_req, res) => {
  res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
  res.json({ ok: true });
});

app.get('/api/me', async (req, res) => {
  const user = await authenticatedUser(req, true);
  if (!user) return res.json({ user: null });
  res.json({
    user: { email: user.email, organization: user.organization.name },
    settings: { defaultThreshold: user.organization.defaultThreshold },
  });
});

app.get('/api/dashboard', requireUser, async (req, res) => {
  const products = await prisma.product.findMany({ where: { organizationId: req.user.organizationId } });
  const lowStock = products
    .filter(product => product.quantity <= (product.lowStockThreshold ?? req.user.organization.defaultThreshold))
    .sort((a, b) => a.quantity - b.quantity || a.name.localeCompare(b.name))
    .map(serializeProduct);
  res.json({
    totalProducts: products.length,
    totalUnits: products.reduce((sum, product) => sum + product.quantity, 0),
    lowStockCount: lowStock.length,
    lowStock: lowStock.slice(0, 8),
  });
});

app.get('/api/products', requireUser, async (req, res) => {
  const products = await prisma.product.findMany({
    where: { organizationId: req.user.organizationId },
    orderBy: { name: 'asc' },
  });
  res.json({ products: products.map(serializeProduct) });
});

app.post('/api/products', requireUser, async (req, res) => {
  const input = parse(productSchema, req.body);
  try {
    const product = await prisma.product.create({
      data: {
        organizationId: req.user.organizationId,
        name: input.name,
        sku: input.sku,
        description: input.description,
        quantity: input.quantity,
        costPrice: input.cost_price ?? null,
        sellingPrice: input.selling_price ?? null,
        lowStockThreshold: input.low_stock_threshold ?? null,
      },
    });
    res.status(201).json({ product: serializeProduct(product) });
  } catch (error) {
    if (error.code === 'P2002') throw httpError(409, 'That SKU is already in use in this organization.');
    throw error;
  }
});

app.put('/api/products/:id', requireUser, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) throw httpError(400, 'Invalid product id.');
  const input = parse(productSchema, req.body);
  const data = {
    name: input.name,
    sku: input.sku,
    description: input.description,
    quantity: input.quantity,
    costPrice: input.cost_price ?? null,
    sellingPrice: input.selling_price ?? null,
    lowStockThreshold: input.low_stock_threshold ?? null,
  };
  const result = await prisma.product.updateMany({ where: { id, organizationId: req.user.organizationId }, data });
  if (!result.count) throw httpError(404, 'Product not found.');
  const product = await prisma.product.findFirst({ where: { id, organizationId: req.user.organizationId } });
  res.json({ product: serializeProduct(product) });
});

app.delete('/api/products/:id', requireUser, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) throw httpError(400, 'Invalid product id.');
  const result = await prisma.product.deleteMany({ where: { id, organizationId: req.user.organizationId } });
  if (!result.count) throw httpError(404, 'Product not found.');
  res.json({ ok: true });
});

app.put('/api/settings', requireUser, async (req, res) => {
  const { defaultThreshold } = parse(settingsSchema, req.body);
  await prisma.organization.update({ where: { id: req.user.organizationId }, data: { defaultThreshold } });
  res.json({ defaultThreshold });
});

app.use('/api', (_req, _res, next) => next(httpError(404, 'Not found.')));

const distDir = path.resolve(currentDir, '../dist');
app.use(express.static(distDir, { index: false, fallthrough: true }));
app.get('*splat', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next(httpError(404, 'Not found.'));
  res.sendFile(path.join(distDir, 'index.html'), error => { if (error) next(error); });
});

app.use((error, _req, res, _next) => {
  if (res.headersSent) return;
  const status = Number.isInteger(error.status) ? error.status : 500;
  if (status >= 500) console.error(error);
  res.status(status).json({ error: status === 500 ? 'An unexpected server error occurred.' : error.message });
});

export { app, prisma };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  app.listen(port, '0.0.0.0', () => console.log(`StockFlow listening on port ${port}`));
}
