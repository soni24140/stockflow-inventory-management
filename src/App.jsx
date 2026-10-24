import { useCallback, useEffect, useMemo, useState } from 'react';

const money = value => value == null ? '—' : new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const initial = value => (value || '?').trim().slice(0, 1).toUpperCase();

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}

function useEscape(onEscape, enabled) {
  useEffect(() => {
    if (!enabled) return undefined;
    const listener = event => { if (event.key === 'Escape') onEscape(); };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [onEscape, enabled]);
}

function AuthScreen({ onSignedIn }) {
  const [mode, setMode] = useState('login');
  const [values, setValues] = useState({ email: '', password: '', confirmPassword: '', organization: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const signup = mode === 'signup';
  const update = event => setValues(current => ({ ...current, [event.target.name]: event.target.value }));
  const toggleMode = () => {
    setMode(current => current === 'signup' ? 'login' : 'signup');
    setValues({ email: '', password: '', confirmPassword: '', organization: '' });
    setError('');
  };
  async function submit(event) {
    event.preventDefault();
    setError('');
    if (signup && values.password !== values.confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const { confirmPassword, ...payload } = values;
      const result = await api(signup ? '/signup' : '/login', { method: 'POST', body: JSON.stringify(payload) });
      const me = await api('/me');
      onSignedIn(result.user, me.settings?.defaultThreshold ?? 5);
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setBusy(false);
    }
  }

  return <section className="auth-screen">
    <div className="auth-art"><div className="auth-art-top"><span className="brand-mark light">S</span><span>StockFlow</span></div><div className="auth-art-copy"><p className="eyebrow">A clearer view of your stock</p><h1>Everything in<br />its right place.</h1><p>Know what you have, what you need, and what’s next.</p></div><div className="auth-orbit orbit-one" /><div className="auth-orbit orbit-two" /><div className="auth-bottom-note">INVENTORY, IN CONTROL <span>✳</span></div></div>
    <div className="auth-panel"><div className="auth-mobile-brand"><span className="brand-mark">S</span> StockFlow</div><div className="auth-box"><div className="auth-heading"><p className="eyebrow">{signup ? 'GET STARTED' : 'WELCOME BACK'}</p><h2>{signup ? 'Make it yours.' : 'Good to see you.'}</h2><p>{signup ? 'Set up your workspace and get things moving.' : 'Sign in to pick up where you left off.'}</p></div>
      <form className="form-stack" onSubmit={submit}>
        {signup && <label>Organization name<input name="organization" autoComplete="organization" placeholder="e.g. Acme Supply Co." value={values.organization} onChange={update} required maxLength={100} /></label>}
        <label>Email address<input name="email" type="email" autoComplete="email" placeholder="you@company.com" value={values.email} onChange={update} required maxLength={254} /></label>
        <label>Password<input name="password" type="password" autoComplete={signup ? 'new-password' : 'current-password'} placeholder="At least 8 characters" value={values.password} onChange={update} required minLength={8} maxLength={256} /></label>
        {signup && <label>Confirm password<input name="confirmPassword" type="password" autoComplete="new-password" placeholder="Enter your password again" value={values.confirmPassword} onChange={update} required minLength={8} maxLength={256} /></label>}
        {error && <div className="form-error" role="alert">{error}</div>}
        <button className="button button-primary button-wide" type="submit" disabled={busy}>{busy ? 'Please wait…' : signup ? 'Create workspace' : 'Sign in'} <span>→</span></button>
      </form><p className="auth-switch"><span>{signup ? 'Already have an account?' : 'New to StockFlow?'}</span> <button className="text-button" type="button" onClick={toggleMode}>{signup ? 'Sign in' : 'Create an account'}</button></p><p className="auth-footnote">By continuing, you agree to keep your inventory in good order.</p></div></div>
  </section>;
}

function Sidebar({ user, view, productCount, onNavigate, onLogout }) {
  const links = [['dashboard', '▦', 'Overview'], ['products', '▤', 'Products'], ['settings', '⚙', 'Settings']];
  return <aside className="sidebar">
    <a className="brand" href="#dashboard" onClick={event => { event.preventDefault(); onNavigate('dashboard'); }}><span className="brand-mark">S</span><span>stockflow<span className="brand-period">.</span></span></a>
    <div className="workspace-switch"><span className="org-avatar">{initial(user.organization)}</span><span className="workspace-text"><strong>{user.organization}</strong><small>Workspace</small></span><span className="chevron">⌄</span></div>
    <p className="nav-label">WORKSPACE</p><nav className="main-nav">{links.slice(0, 2).map(([key, icon, label]) => <button key={key} onClick={() => onNavigate(key)} className={`nav-item ${view === key ? 'active' : ''}`}><span className="nav-icon">{icon}</span>{label}{key === 'products' && <span className="nav-count">{productCount || ''}</span>}</button>)}</nav>
    <p className="nav-label nav-label-lower">PREFERENCES</p><nav><button onClick={() => onNavigate('settings')} className={`nav-item ${view === 'settings' ? 'active' : ''}`}><span className="nav-icon">⚙</span>Settings</button></nav>
    <div className="sidebar-bottom"><div className="help-card"><div className="help-icon">✳</div><strong>Keep things in stock.</strong><p>Set a low stock threshold in settings to stay ahead.</p><button onClick={() => onNavigate('settings')} className="text-button">Explore settings <span>→</span></button></div><div className="profile-row"><span className="profile-avatar">{initial(user.email)}</span><span className="profile-copy"><strong>{user.email}</strong><small>Owner</small></span><button onClick={onLogout} className="icon-button logout-button" aria-label="Sign out" title="Sign out">↗</button></div></div>
  </aside>;
}

function PageHeading({ kicker, title, subtitle, action }) {
  return <div className="page-heading"><div><div className="page-kicker">{kicker}</div><h1>{title}</h1><p>{subtitle}</p></div>{action && <div className="heading-actions">{action}</div>}</div>;
}
function EmptyState({ title, copy, action, short = false }) {
  return <div className={`empty-state ${short ? 'empty-short' : ''}`}><div className="empty-illustration">✳</div><strong>{title}</strong><p>{copy}</p>{action}</div>;
}
function StatCard({ label, value, icon, foot, amber = false }) {
  return <article className="stat-card"><div className="stat-top"><span>{label}</span><span className={`stat-icon ${amber ? 'amber' : ''}`}>{icon}</span></div><div className="stat-value">{value}</div><div className="stat-foot">{foot}</div></article>;
}

function Dashboard({ threshold, onNavigate, onAdd, refreshKey }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    api('/dashboard').then(value => { if (active) { setData(value); setError(''); } }).catch(reason => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [refreshKey]);
  const loading = !data && !error;
  return <>
    <PageHeading kicker="YOUR INVENTORY, AT A GLANCE" title="Overview" subtitle="Here’s what’s happening with your stock today." action={<button className="button button-primary button-small" onClick={onAdd}>＋ &nbsp;Add product</button>} />
    <div className="stats-grid"><StatCard label="Total products" value={loading ? <span className="skeleton skeleton-52" /> : data.totalProducts} icon="▤" foot="In your catalog" /><StatCard label="Units in stock" value={loading ? <span className="skeleton skeleton-64" /> : data.totalUnits} icon="▦" foot="Across all products" /><StatCard label="Low stock items" value={loading ? <span className="skeleton skeleton-45" /> : data.lowStockCount} icon="⚑" foot="Need your attention" amber /></div>
    <section className="panel"><div className="panel-heading"><div className="low-stock-header"><span className="low-stock-pip">⚑</span><div><div className="panel-title">Low stock items</div><div className="panel-subtitle">Products at or below their stock threshold</div></div></div><button className="text-button" onClick={() => onNavigate('products')}>All products →</button></div>
      {error ? <EmptyState title="Couldn’t load inventory" copy={error} short /> : loading ? <div className="empty-state"><span className="skeleton skeleton-center" /></div> : data.lowStock.length ? <div className="table-wrap"><table><thead><tr><th>Product</th><th>SKU</th><th>In stock</th><th>Threshold</th></tr></thead><tbody>{data.lowStock.map(product => <tr key={product.id}><td className="product-name-cell">{product.name}</td><td className="sku-cell">{product.sku}</td><td className="quantity-low">{product.quantity}</td><td>{product.low_stock_threshold ?? threshold} units</td></tr>)}</tbody></table></div> : <EmptyState title="Looking good!" copy="Nothing is running low right now. Your shelves are in good shape." short action={<button className="button button-secondary button-small" onClick={() => onNavigate('products')}>Browse products</button>} />}
    </section>
  </>;
}

function ProductTable({ products, threshold, onAdd, onEdit, onDelete }) {
  if (!products.length) return <EmptyState title="Your catalog starts here" copy="Add your first product to start keeping track of your inventory." action={<button className="button button-primary button-small" onClick={onAdd}>＋ &nbsp;Add your first product</button>} />;
  return <><div className="table-wrap"><table className="products-table"><thead><tr><th>Product</th><th>SKU</th><th>In stock</th><th>Threshold</th><th>Cost price</th><th>Selling price</th><th /></tr></thead><tbody>{products.map(product => {
    const low = product.quantity <= (product.low_stock_threshold ?? threshold);
    return <tr key={product.id}><td><div className="product-name-cell">{product.name}</div>{product.description && <div className="panel-subtitle">{product.description}</div>}</td><td className="sku-cell">{product.sku}</td><td><span className={`stock-chip ${low ? 'low' : 'ok'}`}><span className="chip-dot" />{product.quantity} {low ? 'low' : 'in stock'}</span></td><td>{product.low_stock_threshold ?? `Default (${threshold})`}</td><td>{money(product.cost_price)}</td><td>{money(product.selling_price)}</td><td className="row-actions"><button onClick={() => onEdit(product)}>Edit</button><button onClick={() => onDelete(product)}>Delete</button></td></tr>;
  })}</tbody></table></div><div className="table-count">Showing {products.length} product{products.length === 1 ? '' : 's'}</div></>;
}

function Products({ threshold, onAdd, onEdit, onDelete, refreshKey }) {
  const [products, setProducts] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setLoading(true);
    api('/products').then(data => { if (active) { setProducts(data.products); setError(''); } }).catch(reason => { if (active) setError(reason.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refreshKey]);
  const visible = useMemo(() => products.filter(product => `${product.name} ${product.sku}`.toLowerCase().includes(query.toLowerCase())), [products, query]);
  return <>
    <PageHeading kicker="YOUR CATALOG" title="Products" subtitle="Manage the items you keep in stock." action={<button className="button button-primary button-small" onClick={onAdd}>＋ &nbsp;Add product</button>} />
    <div className="product-toolbar"><span className="page-kicker">{loading ? 'LOADING PRODUCTS' : `${products.length} PRODUCT${products.length === 1 ? '' : 'S'}`}</span><div className="search-wrap"><input className="search-input" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search by product or SKU..." aria-label="Search products" /></div></div>
    <section className="panel table-panel">{error ? <EmptyState title="Couldn’t load products" copy={error} /> : loading ? <div className="empty-state"><span className="skeleton skeleton-center" /></div> : visible.length ? <ProductTable products={visible} threshold={threshold} onAdd={onAdd} onEdit={onEdit} onDelete={onDelete} /> : products.length ? <EmptyState title="No matches found" copy="Try another name or SKU." /> : <ProductTable products={[]} threshold={threshold} onAdd={onAdd} onEdit={onEdit} onDelete={onDelete} />}</section>
  </>;
}

function Settings({ threshold, onSave, notify }) {
  const [value, setValue] = useState(String(threshold));
  const [busy, setBusy] = useState(false);
  useEffect(() => setValue(String(threshold)), [threshold]);
  async function submit(event) {
    event.preventDefault(); setBusy(true);
    try { const result = await api('/settings', { method: 'PUT', body: JSON.stringify({ defaultThreshold: Number(value) }) }); onSave(result.defaultThreshold); notify('Settings saved.'); }
    catch (error) { notify(error.message, true); }
    finally { setBusy(false); }
  }
  return <>
    <PageHeading kicker="MAKE STOCKFLOW YOURS" title="Settings" subtitle="Manage the defaults for your workspace." />
    <div className="settings-layout"><section className="settings-card"><h3>Inventory preferences</h3><p>Choose how StockFlow flags items that are running low.</p><form onSubmit={submit}><div className="settings-field"><label htmlFor="default-threshold">Default low stock threshold</label><input id="default-threshold" className="field-control" type="number" min="0" max="100000000" step="1" value={value} onChange={event => setValue(event.target.value)} required /><div className="settings-note"><strong>How it works</strong><br />Products with a custom threshold use their own value. Products without one use this default. Items are flagged when their quantity is at or below the threshold.</div></div><div className="settings-submit"><button className="button button-primary button-small" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button></div></form></section><aside className="settings-aside"><div className="settings-aside-icon">⚑</div><h3>Your inventory signal</h3><p>Low stock items show up on your Overview so you can spot what needs attention at a glance.</p><div className="settings-divider" /><div className="current-setting">{threshold}<small> units by default</small></div></aside></div>
  </>;
}

const emptyProduct = { name: '', sku: '', description: '', quantity: 0, cost_price: '', selling_price: '', low_stock_threshold: '' };

function ProductModal({ product, onClose, onSave, notify }) {
  const [values, setValues] = useState(product ? {
    name: product.name, sku: product.sku, description: product.description || '', quantity: String(product.quantity),
    cost_price: product.cost_price ?? '', selling_price: product.selling_price ?? '', low_stock_threshold: product.low_stock_threshold ?? '',
  } : emptyProduct);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const update = event => setValues(current => ({ ...current, [event.target.name]: event.target.value }));
  useEscape(onClose, true);
  async function submit(event) {
    event.preventDefault(); setError(''); setBusy(true);
    const payload = {
      ...values,
      quantity: Number(values.quantity),
      low_stock_threshold: values.low_stock_threshold === '' ? null : Number(values.low_stock_threshold),
      cost_price: values.cost_price === '' ? null : Number(values.cost_price),
      selling_price: values.selling_price === '' ? null : Number(values.selling_price),
    };
    try {
      await api(product ? `/products/${product.id}` : '/products', { method: product ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      onSave(); onClose(); notify(product ? 'Product updated.' : 'Product added.');
    } catch (submitError) { setError(submitError.message); }
    finally { setBusy(false); }
  }
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="product-modal-title"><div className="modal-header"><div><h2 id="product-modal-title">{product ? 'Edit product' : 'Add a product'}</h2><p>{product ? 'Update the details for this product.' : 'Add an item to your inventory.'}</p></div><button className="modal-close" type="button" onClick={onClose} aria-label="Close">×</button></div><form onSubmit={submit}><div className="modal-body"><div className="modal-form-grid">
    <label>Product name<input name="name" maxLength="120" required placeholder="e.g. Ceramic coffee mug" value={values.name} onChange={update} /></label>
    <label>SKU<input name="sku" maxLength="64" required placeholder="e.g. MUG-001" value={values.sku} onChange={update} /></label>
    <label>Quantity on hand<input name="quantity" type="number" min="0" max="100000000" step="1" required value={values.quantity} onChange={update} /></label>
    <label>Low stock threshold <span className="optional">optional</span><input name="low_stock_threshold" type="number" min="0" max="100000000" step="1" placeholder="Use workspace default" value={values.low_stock_threshold} onChange={update} /></label>
    <label>Cost price <span className="optional">optional</span><input name="cost_price" type="number" min="0" max="1000000000" step="0.01" placeholder="0.00" value={values.cost_price} onChange={update} /></label>
    <label>Selling price <span className="optional">optional</span><input name="selling_price" type="number" min="0" max="1000000000" step="0.01" placeholder="0.00" value={values.selling_price} onChange={update} /></label>
    <label className="full">Description <span className="optional">optional</span><textarea name="description" maxLength="1000" placeholder="A short note about this product" value={values.description} onChange={update} /></label>
  </div>{error && <div className="modal-error modal-error-spaced" role="alert">{error}</div>}</div><div className="modal-footer"><button className="button button-secondary button-small" type="button" onClick={onClose}>Cancel</button><button className="button button-primary button-small" type="submit" disabled={busy}>{busy ? 'Saving…' : product ? 'Save changes' : 'Add product'}</button></div></form></section></div>;
}

function DeleteModal({ product, onClose, onDelete }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEscape(onClose, true);
  async function confirm() {
    setBusy(true);
    try { await api(`/products/${product.id}`, { method: 'DELETE' }); onDelete(); onClose(); }
    catch (deleteError) { setError(deleteError.message); setBusy(false); }
  }
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="delete-modal-title"><div className="modal-header"><div><h2 id="delete-modal-title">Delete product?</h2><p>This will remove the item from your inventory.</p></div><button className="modal-close" onClick={onClose} aria-label="Close">×</button></div><div className="modal-body"><p className="confirm-copy">Are you sure you want to delete <strong>{product.name}</strong> ({product.sku})? This cannot be undone.</p>{error && <div className="modal-error" role="alert">{error}</div>}</div><div className="modal-footer"><button className="button button-secondary button-small" onClick={onClose}>Cancel</button><button className="button button-danger button-small" onClick={confirm} disabled={busy}>{busy ? 'Deleting…' : 'Delete product'}</button></div></section></div>;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [threshold, setThreshold] = useState(5);
  const [view, setView] = useState('dashboard');
  const [productCount, setProductCount] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);
  const [today] = useState(() => new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date()));
  const notify = useCallback((message, isError = false) => setToast({ message, isError, key: Date.now() }), []);
  const refresh = useCallback(() => setRefreshKey(key => key + 1), []);
  const closeModal = useCallback(() => setModal(null), []);

  useEffect(() => {
    let active = true;
    api('/me').then(data => {
      if (active && data.user) { setUser(data.user); setThreshold(data.settings.defaultThreshold); }
    }).catch(() => {}).finally(() => { if (active) document.getElementById('loading')?.classList.add('hidden'); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    let active = true;
    api('/dashboard').then(data => { if (active) setProductCount(data.totalProducts); }).catch(() => {});
    return () => { active = false; };
  }, [user, refreshKey]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function logout() {
    try { await api('/logout', { method: 'POST', body: '{}' }); }
    finally { setUser(null); setView('dashboard'); setThreshold(5); }
  }

  if (!user) return <><div id="loading" className="loading-screen"><span className="brand-mark">S</span><span>StockFlow</span></div><AuthScreen onSignedIn={(newUser, defaultThreshold) => { setUser(newUser); setThreshold(defaultThreshold); }} /></>;

  return <div className="app-shell">
    <Sidebar user={user} view={view} productCount={productCount} onNavigate={setView} onLogout={logout} />
    <main className="main-content"><header className="topbar"><div className="breadcrumb"><span>Workspace</span><span className="crumb-divider">/</span><strong>{({ dashboard: 'Overview', products: 'Products', settings: 'Settings' })[view]}</strong></div><div className="topbar-right"><span className="date-label">{today}</span><span className="topbar-dot" /><span className="status-label">All systems normal</span></div></header>
      {toast && <div key={toast.key} className={`toast ${toast.isError ? 'error' : ''}`} role="status">{toast.message}</div>}
      <section className="view">{view === 'dashboard' && <Dashboard threshold={threshold} onNavigate={setView} onAdd={() => setModal({ type: 'product', product: null })} refreshKey={refreshKey} />}{view === 'products' && <Products threshold={threshold} onAdd={() => setModal({ type: 'product', product: null })} onEdit={product => setModal({ type: 'product', product })} onDelete={product => setModal({ type: 'delete', product })} refreshKey={refreshKey} />}{view === 'settings' && <Settings threshold={threshold} onSave={value => { setThreshold(value); refresh(); }} notify={notify} />}</section>
    </main>
    {modal?.type === 'product' && <ProductModal key={modal.product?.id ?? 'new'} product={modal.product} onClose={closeModal} onSave={refresh} notify={notify} />}
    {modal?.type === 'delete' && <DeleteModal key={modal.product.id} product={modal.product} onClose={closeModal} onDelete={() => { refresh(); notify('Product deleted.'); }} />}
  </div>;
}
