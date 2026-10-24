import test from 'node:test';
import assert from 'node:assert/strict';
import { app, prisma } from './index.js';

test('auth, tenant isolation, product CRUD, dashboard, and settings', async () => {
  await prisma.product.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organization.deleteMany();
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function request(path, { cookie, ...options } = {}) {
    const response = await fetch(`${base}${path}`, {
      ...options,
      headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...(options.headers || {}) },
    });
    const body = await response.json();
    return { response, body, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  const json = value => JSON.stringify(value);
  try {
    const unauthorized = await request('/products');
    assert.equal(unauthorized.response.status, 401);

    const signup = await request('/signup', { method: 'POST', body: json({ email: 'owner@example.com', password: 'correct horse battery staple', organization: 'Acme' }) });
    assert.equal(signup.response.status, 201);
    assert.ok(signup.cookie);
    const cookie = signup.cookie;
    assert.deepEqual((await request('/me', { cookie })).body.user, { email: 'owner@example.com', organization: 'Acme' });

    const created = await request('/products', { cookie, method: 'POST', body: json({ name: 'Widget', sku: 'W-1', quantity: 4, low_stock_threshold: 3, cost_price: 2.5, selling_price: 5 }) });
    assert.equal(created.response.status, 201);
    const id = created.body.product.id;
    const duplicate = await request('/products', { cookie, method: 'POST', body: json({ name: 'Other', sku: 'W-1', quantity: 1 }) });
    assert.equal(duplicate.response.status, 409);
    const invalid = await request('/products', { cookie, method: 'POST', body: json({ name: 'Invalid', sku: 'I-1', quantity: -1 }) });
    assert.equal(invalid.response.status, 400);

    const dashboard = await request('/dashboard', { cookie });
    assert.equal(dashboard.body.totalProducts, 1);
    assert.equal(dashboard.body.totalUnits, 4);
    assert.equal(dashboard.body.lowStockCount, 0);

    const updated = await request(`/products/${id}`, { cookie, method: 'PUT', body: json({ name: 'Widget Plus', sku: 'W-1', quantity: 2, low_stock_threshold: 3 }) });
    assert.equal(updated.response.status, 200);
    assert.equal(updated.body.product.name, 'Widget Plus');
    assert.equal((await request('/dashboard', { cookie })).body.lowStockCount, 1);

    const settings = await request('/settings', { cookie, method: 'PUT', body: json({ defaultThreshold: 9 }) });
    assert.equal(settings.body.defaultThreshold, 9);
    const duplicateSignup = await request('/signup', { method: 'POST', body: json({ email: 'owner@example.com', password: 'correct horse battery staple', organization: 'Again' }) });
    assert.equal(duplicateSignup.response.status, 409);

    const otherSignup = await request('/signup', { method: 'POST', body: json({ email: 'other@example.com', password: 'another correct horse', organization: 'Other Co' }) });
    assert.equal(otherSignup.response.status, 201);
    assert.equal((await request(`/products/${id}`, { cookie: otherSignup.cookie, method: 'DELETE' })).response.status, 404);
    const login = await request('/login', { method: 'POST', body: json({ email: 'owner@example.com', password: 'correct horse battery staple' }) });
    assert.equal(login.response.status, 200);
    assert.equal((await request('/login', { method: 'POST', body: json({ email: 'owner@example.com', password: 'wrong password' }) })).response.status, 401);
    assert.equal((await request(`/products/${id}`, { cookie, method: 'DELETE' })).response.status, 200);
    assert.equal((await request(`/products/${id}`, { cookie, method: 'DELETE' })).response.status, 404);
    assert.equal((await request('/logout', { cookie, method: 'POST', body: '{}' })).response.status, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await prisma.$disconnect();
  }
});
