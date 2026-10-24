const state = { user: null, threshold: 5, products: [], view: 'dashboard', query: '' };
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const formatPrice = value => value == null ? '—' : new Intl.NumberFormat(undefined, {minimumFractionDigits:2,maximumFractionDigits:2}).format(value);
const initials = value => (value || '?').trim().slice(0,1).toUpperCase();

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}
const json = body => ({ method:'POST', body:JSON.stringify(body) });
const put = body => ({ method:'PUT', body:JSON.stringify(body) });

function showAuth(signup = false) {
  $('#loading').classList.add('hidden'); $('#app').classList.add('hidden'); $('#auth-screen').classList.remove('hidden');
  $('#auth-title').textContent = signup ? 'Make it yours.' : 'Good to see you.';
  $('#auth-subtitle').textContent = signup ? 'Set up your workspace and get things moving.' : 'Sign in to pick up where you left off.';
  $('#auth-eyebrow').textContent = signup ? 'GET STARTED' : 'WELCOME BACK';
  $('#auth-submit').innerHTML = signup ? 'Create workspace <span>→</span>' : 'Sign in <span>→</span>';
  $('#auth-switch-text').textContent = signup ? 'Already have an account?' : 'New to StockFlow?';
  $('#auth-switch').textContent = signup ? 'Sign in' : 'Create an account';
  $('#org-field').classList.toggle('hidden', !signup);
  $('#confirm-password-field').classList.toggle('hidden', !signup);
  $('[name="organization"]').required = signup;
  $('[name="confirmPassword"]').required = signup;
  $('[name="password"]').autocomplete = signup ? 'new-password' : 'current-password';
  $('#auth-form').dataset.mode = signup ? 'signup' : 'login';
  $('#auth-form').reset(); $('#auth-error').classList.add('hidden');
}

function showApp() {
  $('#loading').classList.add('hidden'); $('#auth-screen').classList.add('hidden'); $('#app').classList.remove('hidden');
  $('#org-name').textContent = state.user.organization; $('#org-avatar').textContent = initials(state.user.organization);
  $('#user-email').textContent = state.user.email; $('#profile-avatar').textContent = initials(state.user.email);
  $('#today-label').textContent = new Intl.DateTimeFormat(undefined, {weekday:'short',month:'short',day:'numeric'}).format(new Date());
}

function setView(view) {
  state.view = view;
  $$('.view').forEach(el => el.classList.add('hidden'));
  $(`#view-${view}`).classList.remove('hidden');
  $$('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === view));
  $('#breadcrumb-view').textContent = ({dashboard:'Overview',products:'Products',settings:'Settings'})[view];
  if (view === 'dashboard') loadDashboard();
  if (view === 'products') loadProducts();
  if (view === 'settings') renderSettings();
}

function statCard(label, value, icon, foot, amber = false) {
  return `<article class="stat-card"><div class="stat-top"><span>${label}</span><span class="stat-icon ${amber?'amber':''}">${icon}</span></div><div class="stat-value">${value}</div><div class="stat-foot">${foot}</div></article>`;
}
function emptyState(title, copy, action = '') {
  return `<div class="empty-state"><div class="empty-illustration">✳</div><strong>${title}</strong><p>${copy}</p>${action}</div>`;
}
function lowRow(product) {
  const threshold = product.low_stock_threshold ?? state.threshold;
  return `<tr><td class="product-name-cell">${escapeHtml(product.name)}</td><td class="sku-cell">${escapeHtml(product.sku)}</td><td class="quantity-low">${product.quantity}</td><td>${threshold} units</td></tr>`;
}
async function loadDashboard() {
  const el = $('#view-dashboard');
  el.innerHTML = `<div class="page-heading"><div><div class="page-kicker">YOUR INVENTORY, AT A GLANCE</div><h1>Overview</h1><p>Here’s what’s happening with your stock today.</p></div><div class="heading-actions"><button class="button button-primary button-small" data-action="add-product">＋ &nbsp;Add product</button></div></div><div class="stats-grid">${statCard('Total products','<span class="skeleton skeleton-52"></span>','▤','In your catalog')}${statCard('Units in stock','<span class="skeleton skeleton-64"></span>','▦','Across all products')}${statCard('Low stock items','<span class="skeleton skeleton-45"></span>','⚑','Need your attention',true)}</div><section class="panel"><div class="panel-heading"><div class="low-stock-header"><span class="low-stock-pip">⚑</span><div><div class="panel-title">Low stock items</div><div class="panel-subtitle">Products at or below their stock threshold</div></div></div><button class="text-button" data-view="products">All products →</button></div><div id="low-stock-table"></div></section>`;
  try {
    const [dashboard, me] = await Promise.all([api('/dashboard'), api('/me')]);
    state.threshold = me.settings.defaultThreshold;
    const cards = $$('.stat-value', el);
    cards[0].textContent = dashboard.totalProducts; cards[1].textContent = dashboard.totalUnits; cards[2].textContent = dashboard.lowStockCount;
    $('#nav-product-count').textContent = dashboard.totalProducts || '';
    const target = $('#low-stock-table');
    target.innerHTML = dashboard.lowStock.length ? `<div class="table-wrap"><table><thead><tr><th>Product</th><th>SKU</th><th>In stock</th><th>Threshold</th></tr></thead><tbody>${dashboard.lowStock.map(lowRow).join('')}</tbody></table></div>` : emptyState('Looking good!', 'Nothing is running low right now. Your shelves are in good shape.', '<button class="button button-secondary button-small" data-view="products">Browse products</button>');
  } catch (error) { toast(error.message, true); }
}

async function loadProducts() {
  const el = $('#view-products');
  el.innerHTML = `<div class="page-heading"><div><div class="page-kicker">YOUR CATALOG</div><h1>Products</h1><p>Manage the items you keep in stock.</p></div><div class="heading-actions"><button class="button button-primary button-small" data-action="add-product">＋ &nbsp;Add product</button></div></div><div class="product-toolbar"><span class="page-kicker" id="product-count-label">LOADING PRODUCTS</span><div class="search-wrap"><input class="search-input" id="product-search" placeholder="Search by product or SKU..." aria-label="Search products"></div></div><section class="panel table-panel" id="products-panel"><div class="empty-state"><div class="skeleton skeleton-center"></div></div></section>`;
  try { state.products = (await api('/products')).products; $('#nav-product-count').textContent = state.products.length || ''; renderProductTable(); }
  catch (error) { toast(error.message, true); }
}
function renderProductTable() {
  const query = state.query.toLowerCase();
  const visible = state.products.filter(p => `${p.name} ${p.sku}`.toLowerCase().includes(query));
  $('#product-count-label').textContent = `${state.products.length} ${state.products.length === 1 ? 'PRODUCT' : 'PRODUCTS'}`;
  const panel = $('#products-panel');
  if (!visible.length) {
    panel.innerHTML = state.products.length ? emptyState('No matches found', 'Try another name or SKU.') : emptyState('Your catalog starts here', 'Add your first product to start keeping track of your inventory.', '<button class="button button-primary button-small" data-action="add-product">＋ &nbsp;Add your first product</button>');
    return;
  }
  panel.innerHTML = `<div class="table-wrap"><table class="products-table"><thead><tr><th>Product</th><th>SKU</th><th>In stock</th><th>Threshold</th><th>Cost price</th><th>Selling price</th><th></th></tr></thead><tbody>${visible.map(p => { const low = p.quantity <= (p.low_stock_threshold ?? state.threshold); return `<tr><td><div class="product-name-cell">${escapeHtml(p.name)}</div>${p.description?`<div class="panel-subtitle">${escapeHtml(p.description)}</div>`:''}</td><td class="sku-cell">${escapeHtml(p.sku)}</td><td><span class="stock-chip ${low?'low':'ok'}"><span class="chip-dot"></span>${p.quantity} ${low?'low':'in stock'}</span></td><td>${p.low_stock_threshold ?? 'Default ('+state.threshold+')'}</td><td>${formatPrice(p.cost_price)}</td><td>${formatPrice(p.selling_price)}</td><td class="row-actions"><button data-action="edit-product" data-id="${p.id}">Edit</button><button data-action="delete-product" data-id="${p.id}">Delete</button></td></tr>`; }).join('')}</tbody></table></div><div class="table-count">Showing ${visible.length} of ${state.products.length} products</div>`;
}

function renderSettings() {
  $('#view-settings').innerHTML = `<div class="page-heading"><div><div class="page-kicker">MAKE STOCKFLOW YOURS</div><h1>Settings</h1><p>Manage the defaults for your workspace.</p></div></div><div class="settings-layout"><section class="settings-card"><h3>Inventory preferences</h3><p>Choose how StockFlow flags items that are running low.</p><form id="settings-form"><div class="settings-field"><label for="default-threshold">Default low stock threshold</label><input id="default-threshold" class="field-control" type="number" min="0" max="100000000" step="1" value="${state.threshold}" required><div class="settings-note"><strong>How it works</strong><br>Products with a custom threshold use their own value. Products without one use this default. Items are flagged when their quantity is at or below the threshold.</div></div><div class="settings-submit"><button class="button button-primary button-small" type="submit">Save changes</button></div></form></section><aside class="settings-aside"><div class="settings-aside-icon">⚑</div><h3>Your inventory signal</h3><p>Low stock items show up on your Overview so you can spot what needs attention at a glance.</p><div class="settings-divider"></div><div class="current-setting" id="current-threshold">${state.threshold}<small> units by default</small></div></aside></div>`;
}

function productModal(product = null) {
  const editing = !!product;
  const p = product || {name:'',sku:'',description:'',quantity:0,cost_price:'',selling_price:'',low_stock_threshold:''};
  $('#modal-root').innerHTML = `<div class="modal-backdrop" data-action="close-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-header"><div><h2 id="modal-title">${editing?'Edit product':'Add a product'}</h2><p>${editing?'Update the details for this product.':'Add an item to your inventory.'}</p></div><button class="modal-close" type="button" data-action="close-modal" aria-label="Close">×</button></div><form id="product-form" data-id="${editing?p.id:''}"><div class="modal-body"><div class="modal-form-grid"><label>Product name<input name="name" maxlength="120" required placeholder="e.g. Ceramic coffee mug" value="${escapeHtml(p.name)}"></label><label>SKU<input name="sku" maxlength="64" required placeholder="e.g. MUG-001" value="${escapeHtml(p.sku)}"></label><label>Quantity on hand<input name="quantity" type="number" min="0" step="1" required value="${p.quantity}"></label><label>Low stock threshold <span class="optional">optional</span><input name="low_stock_threshold" type="number" min="0" step="1" placeholder="Use workspace default" value="${p.low_stock_threshold ?? ''}"></label><label>Cost price <span class="optional">optional</span><input name="cost_price" type="number" min="0" step="0.01" placeholder="0.00" value="${p.cost_price ?? ''}"></label><label>Selling price <span class="optional">optional</span><input name="selling_price" type="number" min="0" step="0.01" placeholder="0.00" value="${p.selling_price ?? ''}"></label><label class="full">Description <span class="optional">optional</span><textarea name="description" maxlength="1000" placeholder="A short note about this product">${escapeHtml(p.description)}</textarea></label></div><div class="modal-error hidden modal-error-spaced" id="product-error" role="alert"></div></div><div class="modal-footer"><button class="button button-secondary button-small" type="button" data-action="close-modal">Cancel</button><button class="button button-primary button-small" type="submit">${editing?'Save changes':'Add product'}</button></div></form></section></div>`;
  $('[name="name"]', $('#product-form')).focus();
}
function confirmDelete(product) {
  $('#modal-root').innerHTML = `<div class="modal-backdrop" data-action="close-backdrop"><section class="modal" role="dialog" aria-modal="true"><div class="modal-header"><div><h2>Delete product?</h2><p>This will remove the item from your inventory.</p></div><button class="modal-close" data-action="close-modal" aria-label="Close">×</button></div><div class="modal-body"><p class="confirm-copy">Are you sure you want to delete <strong>${escapeHtml(product.name)}</strong> (${escapeHtml(product.sku)})? This cannot be undone.</p><div id="delete-error" class="modal-error hidden"></div></div><div class="modal-footer"><button class="button button-secondary button-small" data-action="close-modal">Cancel</button><button class="button button-danger button-small" data-action="confirm-delete" data-id="${product.id}">Delete product</button></div></section></div>`;
}
function closeModal() { $('#modal-root').innerHTML = ''; }
let toastTimer;
function toast(message, error = false) {
  const el = $('#toast'); el.textContent = message; el.classList.toggle('error', error); el.classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.add('hidden'), 3200);
}

$('#auth-switch').addEventListener('click', () => showAuth($('#auth-form').dataset.mode !== 'signup'));
$('#auth-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form));
  const endpoint = form.dataset.mode === 'signup' ? '/signup' : '/login';
  if (form.dataset.mode === 'signup' && values.password !== values.confirmPassword) {
    $('#auth-error').textContent = 'Passwords do not match.'; $('#auth-error').classList.remove('hidden'); return;
  }
  delete values.confirmPassword;
  try { const result = await api(endpoint, json(values)); state.user = result.user; state.threshold = result.settings?.defaultThreshold ?? 5; showApp(); setView('dashboard'); }
  catch (error) { $('#auth-error').textContent = error.message; $('#auth-error').classList.remove('hidden'); }
});
$('#logout').addEventListener('click', async () => { try { await api('/logout', json({})); } finally { state.user = null; showAuth(false); } });

document.addEventListener('click', async event => {
  const view = event.target.closest('[data-view]');
  if (view) { event.preventDefault(); setView(view.dataset.view); return; }
  const action = event.target.closest('[data-action]'); if (!action) return;
  if (action.dataset.action === 'add-product') productModal();
  if (action.dataset.action === 'edit-product') { const p = state.products.find(item => item.id === Number(action.dataset.id)); if (p) productModal(p); }
  if (action.dataset.action === 'delete-product') { const p = state.products.find(item => item.id === Number(action.dataset.id)); if (p) confirmDelete(p); }
  if (action.dataset.action === 'close-modal' || (action.dataset.action === 'close-backdrop' && event.target === action)) closeModal();
  if (action.dataset.action === 'confirm-delete') {
    action.disabled = true;
    try { await api(`/products/${action.dataset.id}`, {method:'DELETE'}); closeModal(); toast('Product deleted.'); loadProducts(); }
    catch (error) { const el = $('#delete-error'); el.textContent = error.message; el.classList.remove('hidden'); action.disabled = false; }
  }
});

document.addEventListener('input', event => { if (event.target.id === 'product-search') { state.query = event.target.value; renderProductTable(); } });
document.addEventListener('submit', async event => {
  if (event.target.id === 'product-form') {
    event.preventDefault(); const form = event.target; const values = Object.fromEntries(new FormData(form));
    values.quantity = Number(values.quantity); values.low_stock_threshold = values.low_stock_threshold === '' ? null : Number(values.low_stock_threshold);
    values.cost_price = values.cost_price === '' ? null : Number(values.cost_price); values.selling_price = values.selling_price === '' ? null : Number(values.selling_price);
    const button = $('button[type="submit"]', form); button.disabled = true;
    try { await api(form.dataset.id ? `/products/${form.dataset.id}` : '/products', form.dataset.id ? put(values) : json(values)); closeModal(); toast(form.dataset.id ? 'Product updated.' : 'Product added.'); loadProducts(); }
    catch (error) { const target = $('#product-error'); target.textContent = error.message; target.classList.remove('hidden'); button.disabled = false; }
  }
  if (event.target.id === 'settings-form') {
    event.preventDefault(); const input = $('#default-threshold');
    try { const result = await api('/settings', put({defaultThreshold:Number(input.value)})); state.threshold = result.defaultThreshold; $('#current-threshold').innerHTML = `${state.threshold}<small> units by default</small>`; toast('Settings saved.'); }
    catch (error) { toast(error.message, true); }
  }
});

document.addEventListener('keydown', event => { if (event.key === 'Escape') closeModal(); });

(async function init() {
  try {
    const result = await api('/me');
    if (result.user) { state.user = result.user; state.threshold = result.settings.defaultThreshold; showApp(); setView('dashboard'); }
    else showAuth(false);
  } catch { showAuth(false); }
})();
