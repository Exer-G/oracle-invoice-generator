// Oracle Invoice Generator - Exergy Designs
// Standalone static app with localStorage persistence

// ============ STATE ============
const STORAGE_KEYS = {
    invoices: 'oracle_invoices',
    clients: 'oracle_clients',
    payments: 'oracle_payments',
    settings: 'oracle_settings'
};

let state = {
    invoices: [],
    clients: [],
    payments: [],
    settings: {
        company: 'Exergy Designs',
        email: 'shuaib@exergydesigns.com',
        phone: '+27725739937',
        address: '',
        prefix: 'EXD',
        currency: 'USD',
        exchangeRate: 18.50,
        paymentTerms: '3 days',
        paymentMethod: 'yoco',
        // Bank Details
        bankName: 'Standard Bank',
        bankAccountNum: '10195499563',
        bankBranchCode: '051001',
        bankSwift: 'SBZAZAJJ',
        bankAccountHolder: 'Exergy Designs',
        // Wise Details
        wiseEmail: 'shuaib@exergydesigns.com',
        wiseAccountHolder: 'Shuaib Badat',
        wiseCurrency: 'USD',
        wiseIban: '',
        wiseRoutingNum: '',
        wiseAccountNum: '',
        wiseSwift: '',
        // Yoco
        yocoEnabled: true
    }
};

let editingInvoiceId = null;
let editingClientId = null;
let currentFilter = 'all';

// ============ SUPABASE ============
const SUPABASE_URL = 'https://uaivaspunoceuzxkukmh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVhaXZhc3B1bm9jZXV6eGt1a21oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkxMTc2MDEsImV4cCI6MjA4NDY5MzYwMX0.yasfPMw3fRyOawYXLNTtZhpxutFCBd70f1Cot3AVcFc';

let supabaseClient = null;
let currentUser = null;
let isSyncing = false;
let lastSyncTime = null;

function initSupabase() {
    if (typeof window.supabase === 'undefined') {
        console.warn('[Supabase] SDK not loaded');
        return;
    }
    try {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        supabaseClient.auth.onAuthStateChange((event, session) => {
            console.log('[Auth]', event);
            if (session?.user) {
                currentUser = session.user;
                showApp();
                updateUserUI();
                // Auto-sync on login
                if (event === 'SIGNED_IN') {
                    setTimeout(() => syncAll(), 500);
                }
            } else {
                currentUser = null;
                updateUserUI();
                // Don't force login overlay if user previously skipped
                if (!localStorage.getItem('oracle_skip_login')) {
                    showLogin();
                }
            }
        });

        // Handle OAuth redirect
        if (window.location.hash?.includes('access_token') || window.location.search?.includes('code=')) {
            setTimeout(() => {
                history.replaceState(null, '', window.location.pathname);
            }, 1000);
        }
    } catch (err) {
        console.error('[Supabase] Init failed:', err);
    }
}

async function signInWithGoogle() {
    if (!supabaseClient) { toast('Supabase not ready', 'error'); return; }
    const btn = document.getElementById('googleSignInBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Signing in...'; }
    try {
        const { error } = await supabaseClient.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: 'https://oracle-invoicer-exd.netlify.app/'
            }
        });
        if (error) throw error;
    } catch (err) {
        toast('Sign-in failed: ' + err.message, 'error');
        if (btn) { btn.disabled = false; btn.innerHTML = 'Sign in with Google'; }
    }
}

async function signOut() {
    if (!supabaseClient) return;
    try {
        await supabaseClient.auth.signOut();
        currentUser = null;
        localStorage.removeItem('oracle_skip_login');
        updateUserUI();
        showLogin();
        toast('Signed out');
    } catch (err) {
        toast('Sign-out error: ' + err.message, 'error');
    }
}

function skipLogin() {
    localStorage.setItem('oracle_skip_login', '1');
    showApp();
}

function showLogin() {
    document.getElementById('loginOverlay')?.classList.remove('hidden');
}

function showApp() {
    document.getElementById('loginOverlay')?.classList.add('hidden');
}

function updateUserUI() {
    const avatarEl = document.getElementById('userAvatar');
    const nameEl = document.getElementById('userName');
    const emailEl = document.getElementById('userEmail');
    const logoutBtn = document.getElementById('logoutBtn');
    const syncText = document.getElementById('syncStatusText');

    if (currentUser) {
        const name = currentUser.user_metadata?.full_name || currentUser.email?.split('@')[0] || 'User';
        const initials = name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        if (avatarEl) avatarEl.textContent = initials;
        if (nameEl) nameEl.textContent = name;
        if (emailEl) emailEl.textContent = currentUser.email || '';
        if (logoutBtn) logoutBtn.style.display = 'block';
        if (syncText) syncText.textContent = lastSyncTime ? `Synced ${timeAgo(lastSyncTime)}` : 'Not synced yet';
        // Show sync buttons
        document.querySelectorAll('.sync-btn').forEach(b => b.style.display = 'flex');
    } else {
        if (avatarEl) avatarEl.textContent = '?';
        if (nameEl) nameEl.textContent = 'Not signed in';
        if (emailEl) emailEl.textContent = 'Sign in to sync';
        if (logoutBtn) logoutBtn.style.display = 'none';
        if (syncText) syncText.textContent = 'Not synced';
        document.querySelectorAll('.sync-btn').forEach(b => b.style.display = 'none');
    }
}

function timeAgo(date) {
    const secs = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
    if (secs < 60) return 'just now';
    if (secs < 3600) return Math.floor(secs / 60) + 'm ago';
    if (secs < 86400) return Math.floor(secs / 3600) + 'h ago';
    return Math.floor(secs / 86400) + 'd ago';
}

function injectSyncButtons() {
    document.querySelectorAll('.header-right').forEach(header => {
        if (header.querySelector('.sync-btn')) return;
        const btn = document.createElement('button');
        btn.className = 'sync-btn';
        btn.style.display = currentUser ? 'flex' : 'none';
        btn.onclick = () => syncAll();
        btn.innerHTML = `<svg class="sync-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg><span class="sync-label">Sync</span>`;
        header.insertBefore(btn, header.firstChild);
    });
}

// ============ SYNC ENGINE ============
function parseToISODate(dateStr) {
    if (!dateStr) return new Date().toISOString().split('T')[0];
    if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return dateStr.split('T')[0];
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
    return new Date().toISOString().split('T')[0];
}

function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

// ID mapping: local numeric IDs → Supabase UUIDs
function getIdMap() {
    try { return JSON.parse(localStorage.getItem('oracle_id_map') || '{}'); } catch { return {}; }
}
function saveIdMap(map) {
    localStorage.setItem('oracle_id_map', JSON.stringify(map));
}

function setSyncStatus(status) {
    const btns = document.querySelectorAll('.sync-btn');
    btns.forEach(btn => {
        btn.className = 'sync-btn' + (status ? ' ' + status : '');
        const label = btn.querySelector('.sync-label');
        if (label) {
            if (status === 'syncing') label.textContent = 'Syncing...';
            else if (status === 'synced') label.textContent = 'Synced';
            else if (status === 'error') label.textContent = 'Error';
            else label.textContent = 'Sync';
        }
    });
    if (status === 'synced' || status === 'error') {
        setTimeout(() => setSyncStatus(''), 3000);
    }
}

async function syncAll() {
    if (!supabaseClient || !currentUser || isSyncing) return;
    isSyncing = true;
    setSyncStatus('syncing');
    const counts = { pushed: 0, pulled: 0 };

    try {
        // Sync clients first (invoices reference them)
        await syncClientsToCloud(counts);
        await syncClientsFromCloud(counts);

        // Sync invoices
        await syncInvoicesToCloud(counts);
        await syncInvoicesFromCloud(counts);

        // Sync upwork data
        await syncUpworkToCloud(counts);
        await syncUpworkFromCloud(counts);

        // Sync settings
        await syncSettingsToCloud();
        await syncSettingsFromCloud();

        lastSyncTime = new Date().toISOString();
        localStorage.setItem('oracle_last_sync', lastSyncTime);
        setSyncStatus('synced');
        updateUserUI();

        // Re-render current page
        document.querySelector('.page.active')?.id && showPage(document.querySelector('.page.active').id.replace('page-', ''));

        toast(`Synced: ${counts.pushed} pushed, ${counts.pulled} pulled`, 'success');
    } catch (err) {
        console.error('[Sync] Error:', err);
        setSyncStatus('error');
        toast('Sync failed: ' + err.message, 'error');
    } finally {
        isSyncing = false;
    }
}

// --- CLIENT SYNC ---
async function syncClientsToCloud(counts) {
    const idMap = getIdMap();
    const batch = [];

    for (const client of state.clients) {
        const localKey = 'client_' + (client.id || client.name);
        const uuid = idMap[localKey] || generateUUID();
        idMap[localKey] = uuid;

        batch.push({
            id: uuid,
            user_id: currentUser.id,
            name: client.name || '',
            company: client.company || '',
            email: client.email || '',
            phone: client.phone || '',
            address: client.address || '',
            vat_number: client.vat || '',
            currency: 'USD',
            metadata: { source: client.source || 'direct', localId: client.id },
            updated_at: client.updatedAt || client.createdAt || new Date().toISOString()
        });
    }

    if (batch.length > 0) {
        const { error } = await supabaseClient.from('clients').upsert(batch, { onConflict: 'id' });
        if (error) console.warn('[Sync] Client batch push error:', error.message, error.details);
        else counts.pushed += batch.length;
    }
    saveIdMap(idMap);
}

async function syncClientsFromCloud(counts) {
    const { data, error } = await supabaseClient
        .from('clients')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('updated_at', { ascending: false });

    if (error) { console.warn('[Sync] Client pull error:', error.message); return; }
    if (!data?.length) return;

    const idMap = getIdMap();
    const reverseMap = {};
    Object.entries(idMap).forEach(([k, v]) => { if (k.startsWith('client_')) reverseMap[v] = k; });

    data.forEach(remote => {
        const localKey = reverseMap[remote.id];
        const existing = localKey
            ? state.clients.find(c => 'client_' + (c.id || c.name) === localKey)
            : state.clients.find(c => c.name === remote.name);

        if (existing) {
            const remoteTime = new Date(remote.updated_at).getTime();
            const localTime = new Date(existing.updatedAt || existing.createdAt || 0).getTime();
            if (remoteTime > localTime) {
                existing.name = remote.name;
                existing.company = remote.company || '';
                existing.email = remote.email || '';
                existing.phone = remote.phone || '';
                existing.address = remote.address || '';
                existing.vat = remote.vat_number || '';
                existing.updatedAt = remote.updated_at;
                existing.source = remote.metadata?.source || existing.source;
                counts.pulled++;
            }
        } else {
            const newClient = {
                id: remote.metadata?.localId || Date.now() + Math.random() * 1000,
                name: remote.name,
                company: remote.company || '',
                email: remote.email || '',
                phone: remote.phone || '',
                address: remote.address || '',
                vat: remote.vat_number || '',
                source: remote.metadata?.source || 'direct',
                createdAt: remote.created_at,
                updatedAt: remote.updated_at
            };
            state.clients.push(newClient);
            const newKey = 'client_' + newClient.id;
            idMap[newKey] = remote.id;
            counts.pulled++;
        }
    });

    saveIdMap(idMap);
    saveState('clients');
}

// --- INVOICE SYNC ---
function resolveClientUUID(clientName) {
    const idMap = getIdMap();
    const client = state.clients.find(c => c.name === clientName);
    if (client) {
        const key = 'client_' + (client.id || client.name);
        return idMap[key] || null;
    }
    return null;
}

async function syncInvoicesToCloud(counts) {
    const idMap = getIdMap();
    const batch = [];

    for (const inv of state.invoices) {
        const localKey = 'invoice_' + (inv.id || inv.invoiceNumber);
        const uuid = idMap[localKey] || generateUUID();
        idMap[localKey] = uuid;

        const clientUUID = resolveClientUUID(inv.client?.name);

        batch.push({
            id: uuid,
            user_id: currentUser.id,
            client_id: clientUUID,
            invoice_number: inv.invoiceNumber || '',
            date: parseToISODate(inv.date),
            due_date: inv.dueDate || null,
            status: inv.status || 'pending',
            currency: inv.currency || 'USD',
            exchange_rate: parseFloat(inv.exchangeRate) || 1,
            subtotal: parseFloat(inv.subtotal) || 0,
            total: parseFloat(inv.subtotal) || 0,
            zar_total: parseFloat(inv.zarTotal) || 0,
            line_items: inv.lineItems || [],
            remarks: inv.remarks || '',
            payment_method: inv.paymentMethod || null,
            payment_link: inv.paymentLink || null,
            paid_at: inv.paidAt || null,
            metadata: {
                localId: inv.id,
                paymentTerms: inv.paymentTerms,
                clientName: inv.client?.name,
                clientCompany: inv.client?.company
            },
            updated_at: inv.updatedAt || inv.createdAt || new Date().toISOString()
        });
    }

    // Batch upsert in chunks of 50
    for (let i = 0; i < batch.length; i += 50) {
        const chunk = batch.slice(i, i + 50);
        const { error } = await supabaseClient.from('invoices').upsert(chunk, { onConflict: 'id' });
        if (error) console.warn('[Sync] Invoice batch push error:', error.message, error.details);
        else counts.pushed += chunk.length;
    }
    saveIdMap(idMap);
}

async function syncInvoicesFromCloud(counts) {
    const { data, error } = await supabaseClient
        .from('invoices')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('updated_at', { ascending: false });

    if (error) { console.warn('[Sync] Invoice pull error:', error.message); return; }
    if (!data?.length) return;

    const idMap = getIdMap();
    const reverseMap = {};
    Object.entries(idMap).forEach(([k, v]) => { if (k.startsWith('invoice_')) reverseMap[v] = k; });

    data.forEach(remote => {
        const localKey = reverseMap[remote.id];
        const existing = localKey
            ? state.invoices.find(i => 'invoice_' + (i.id || i.invoiceNumber) === localKey)
            : state.invoices.find(i => i.invoiceNumber === remote.invoice_number);

        if (existing) {
            const remoteTime = new Date(remote.updated_at).getTime();
            const localTime = new Date(existing.updatedAt || existing.createdAt || 0).getTime();
            if (remoteTime > localTime) {
                existing.invoiceNumber = remote.invoice_number;
                existing.date = remote.date;
                existing.dueDate = remote.due_date;
                existing.status = remote.status;
                existing.currency = remote.currency;
                existing.exchangeRate = remote.exchange_rate;
                existing.subtotal = remote.subtotal;
                existing.zarTotal = remote.zar_total;
                existing.lineItems = remote.line_items || [];
                existing.remarks = remote.remarks;
                existing.paymentMethod = remote.payment_method;
                existing.paymentLink = remote.payment_link;
                existing.paidAt = remote.paid_at;
                existing.paymentTerms = remote.metadata?.paymentTerms || existing.paymentTerms;
                if (remote.metadata?.clientName) {
                    existing.client = {
                        name: remote.metadata.clientName,
                        company: remote.metadata.clientCompany || ''
                    };
                }
                existing.updatedAt = remote.updated_at;
                counts.pulled++;
            }
        } else {
            const newInv = {
                id: remote.metadata?.localId || Date.now() + Math.random() * 1000,
                invoiceNumber: remote.invoice_number,
                date: remote.date,
                dueDate: remote.due_date,
                paymentTerms: remote.metadata?.paymentTerms || '3 days',
                client: {
                    name: remote.metadata?.clientName || 'Unknown',
                    company: remote.metadata?.clientCompany || ''
                },
                lineItems: remote.line_items || [],
                currency: remote.currency,
                exchangeRate: remote.exchange_rate,
                subtotal: remote.subtotal,
                zarTotal: remote.zar_total,
                remarks: remote.remarks,
                paymentLink: remote.payment_link,
                paymentMethod: remote.payment_method,
                status: remote.status,
                paidAt: remote.paid_at,
                createdAt: remote.created_at,
                updatedAt: remote.updated_at
            };
            state.invoices.push(newInv);
            const newKey = 'invoice_' + newInv.id;
            idMap[newKey] = remote.id;
            counts.pulled++;
        }
    });

    saveIdMap(idMap);
    saveState('invoices');
}

// --- UPWORK SYNC ---
async function syncUpworkToCloud(counts) {
    const upworkData = state.upworkData || JSON.parse(localStorage.getItem('oracle_upwork') || 'null');
    if (!upworkData?.clientEarnings) return;

    const exRate = state.settings.exchangeRate || 18.5;
    const idMap = getIdMap();
    const batch = [];

    for (const [team, info] of Object.entries(upworkData.clientEarnings)) {
        for (const tx of info.transactions) {
            const txKey = `upwork_${tx.date}_${team}_${tx.amount}`;
            const uuid = idMap[txKey] || generateUUID();
            idMap[txKey] = uuid;

            const amount = parseFloat(tx.amount) || 0;
            batch.push({
                id: uuid,
                user_id: currentUser.id,
                date: parseToISODate(tx.date || upworkData.importedAt),
                description: `${tx.txType || 'Upwork'}: ${team}${tx.desc ? ' — ' + tx.desc : ''}`,
                amount: parseFloat((Math.abs(amount) * exRate).toFixed(2)),
                source: 'upwork',
                type: amount >= 0 ? 'income' : 'expense',
                category: tx.txType || 'Upwork',
                currency: 'ZAR',
                original_amount: parseFloat(Math.abs(amount).toFixed(2)),
                original_currency: 'USD',
                notes: null,
                metadata: { team, hours: tx.hours, txType: tx.txType, importedAt: upworkData.importedAt },
                updated_at: upworkData.importedAt || new Date().toISOString()
            });
        }
    }

    // Batch upsert in chunks of 50
    for (let i = 0; i < batch.length; i += 50) {
        const chunk = batch.slice(i, i + 50);
        const { error } = await supabaseClient.from('transactions').upsert(chunk, { onConflict: 'id' });
        if (error) {
            console.warn('[Sync] Upwork batch error:', error.message, error.details);
        } else {
            counts.pushed += chunk.length;
        }
    }
    saveIdMap(idMap);
}

async function syncUpworkFromCloud(counts) {
    const { data, error } = await supabaseClient
        .from('transactions')
        .select('*')
        .eq('user_id', currentUser.id)
        .eq('source', 'upwork')
        .order('date', { ascending: false });

    if (error || !data?.length) return;

    // Rebuild upwork data from cloud transactions
    const clientEarnings = {};
    let totalGross = 0, totalFees = 0, totalVat = 0;

    data.forEach(tx => {
        const team = tx.metadata?.team || 'Unknown';
        const txType = tx.metadata?.txType || tx.category || 'Hourly';
        const amount = tx.original_amount || 0;
        const type = tx.type;

        if (txType === 'Service Fee') { totalFees += amount; return; }
        if (txType === 'VAT') { totalVat += amount; return; }

        if (!clientEarnings[team]) {
            clientEarnings[team] = { total: 0, transactions: [], totalHours: 0 };
        }

        clientEarnings[team].total += amount;
        clientEarnings[team].transactions.push({
            date: tx.date,
            desc: tx.description?.replace(`${txType}: ${team}`, '').replace(' — ', '').trim() || '',
            amount: type === 'expense' ? -amount : amount,
            hours: tx.metadata?.hours || '',
            txType
        });

        const hoursMatch = (tx.metadata?.hours || '').match(/([\d.]+)\s*hours/i);
        if (hoursMatch) clientEarnings[team].totalHours += parseFloat(hoursMatch[1]);
        totalGross += amount;
        counts.pulled++;
    });

    if (Object.keys(clientEarnings).length > 0) {
        state.upworkData = {
            clientEarnings,
            totalGross,
            totalFees,
            totalVat,
            totalNet: totalGross - totalFees - totalVat,
            importedAt: data[0]?.metadata?.importedAt || new Date().toISOString(),
            rowCount: data.length,
            earningCount: data.filter(t => t.type === 'income').length
        };
        localStorage.setItem('oracle_upwork', JSON.stringify(state.upworkData));
    }
}

// --- SETTINGS SYNC ---
async function syncSettingsToCloud() {
    const s = state.settings;
    const row = {
        user_id: currentUser.id,
        invoice_prefix: s.prefix || 'EXD',
        default_currency: s.currency || 'USD',
        default_exchange_rate: s.exchangeRate || 18.5,
        default_payment_terms: parseInt(s.paymentTerms) || 3,
        business_name: s.company || 'Exergy Designs',
        business_email: s.email || '',
        business_phone: s.phone || '',
        business_address: s.address || '',
        business_bank_details: JSON.stringify({
            bankName: s.bankName, bankAccountNum: s.bankAccountNum,
            bankBranchCode: s.bankBranchCode, bankSwift: s.bankSwift,
            bankAccountHolder: s.bankAccountHolder
        }),
        preferences: {
            paymentMethod: s.paymentMethod,
            wiseEmail: s.wiseEmail, wiseAccountHolder: s.wiseAccountHolder,
            wiseCurrency: s.wiseCurrency, wiseIban: s.wiseIban,
            wiseRoutingNum: s.wiseRoutingNum, wiseAccountNum: s.wiseAccountNum,
            wiseSwift: s.wiseSwift, yocoEnabled: s.yocoEnabled
        },
        updated_at: new Date().toISOString()
    };

    const { error } = await supabaseClient.from('user_settings').upsert(row, { onConflict: 'user_id' });
    if (error) console.warn('[Sync] Settings push error:', error.message);
}

async function syncSettingsFromCloud() {
    const { data, error } = await supabaseClient
        .from('user_settings')
        .select('*')
        .eq('user_id', currentUser.id)
        .single();

    if (error || !data) return;

    let bank = {};
    try { bank = JSON.parse(data.business_bank_details || '{}'); } catch {}
    const prefs = data.preferences || {};

    state.settings = {
        ...state.settings,
        company: data.business_name || state.settings.company,
        email: data.business_email || state.settings.email,
        phone: data.business_phone || state.settings.phone,
        address: data.business_address || state.settings.address,
        prefix: data.invoice_prefix || state.settings.prefix,
        currency: data.default_currency || state.settings.currency,
        exchangeRate: data.default_exchange_rate || state.settings.exchangeRate,
        paymentTerms: String(data.default_payment_terms || 3) + ' days',
        bankName: bank.bankName || state.settings.bankName,
        bankAccountNum: bank.bankAccountNum || state.settings.bankAccountNum,
        bankBranchCode: bank.bankBranchCode || state.settings.bankBranchCode,
        bankSwift: bank.bankSwift || state.settings.bankSwift,
        bankAccountHolder: bank.bankAccountHolder || state.settings.bankAccountHolder,
        paymentMethod: prefs.paymentMethod || state.settings.paymentMethod,
        wiseEmail: prefs.wiseEmail || state.settings.wiseEmail,
        wiseAccountHolder: prefs.wiseAccountHolder || state.settings.wiseAccountHolder,
        wiseCurrency: prefs.wiseCurrency || state.settings.wiseCurrency,
        wiseIban: prefs.wiseIban || state.settings.wiseIban,
        wiseRoutingNum: prefs.wiseRoutingNum || state.settings.wiseRoutingNum,
        wiseAccountNum: prefs.wiseAccountNum || state.settings.wiseAccountNum,
        wiseSwift: prefs.wiseSwift || state.settings.wiseSwift,
        yocoEnabled: prefs.yocoEnabled !== undefined ? prefs.yocoEnabled : state.settings.yocoEnabled
    };

    saveState('settings');
    loadSettings();
}

// Auto-sync individual entity after local save
async function autoSync(entityType) {
    if (!supabaseClient || !currentUser || isSyncing) return;
    try {
        const counts = { pushed: 0, pulled: 0 };
        if (entityType === 'clients') await syncClientsToCloud(counts);
        else if (entityType === 'invoices') await syncInvoicesToCloud(counts);
        else if (entityType === 'settings') await syncSettingsToCloud();
        if (counts.pushed > 0) {
            lastSyncTime = new Date().toISOString();
            localStorage.setItem('oracle_last_sync', lastSyncTime);
            updateUserUI();
        }
    } catch (err) {
        console.warn('[AutoSync]', entityType, err.message);
    }
}

// ============ PERSISTENCE ============
function loadState() {
    try {
        for (const [key, storageKey] of Object.entries(STORAGE_KEYS)) {
            const raw = localStorage.getItem(storageKey);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (key === 'settings') {
                    state.settings = { ...state.settings, ...parsed };
                } else {
                    state[key] = parsed;
                }
            }
        }
    } catch (e) {
        console.error('Error loading state:', e);
    }
}

function saveState(key) {
    try {
        if (key) {
            localStorage.setItem(STORAGE_KEYS[key], JSON.stringify(state[key]));
            // Auto-sync to Supabase
            autoSync(key);
        } else {
            for (const [k, sk] of Object.entries(STORAGE_KEYS)) {
                localStorage.setItem(sk, JSON.stringify(state[k]));
            }
        }
    } catch (e) {
        console.error('Error saving state:', e);
    }
}

// ============ NAVIGATION ============
function showPage(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

    const pageEl = document.getElementById(`page-${page}`);
    const navEl = document.querySelector(`.nav-item[data-page="${page}"]`);
    if (pageEl) pageEl.classList.add('active');
    if (navEl) navEl.classList.add('active');

    // Close mobile sidebar
    document.querySelector('.sidebar')?.classList.remove('open');

    // Refresh content
    if (page === 'dashboard') renderDashboard();
    if (page === 'invoices') renderInvoices();
    if (page === 'clients') renderClients();
    if (page === 'payments') renderPayments();
    if (page === 'upwork') renderUpworkSummary();
    if (page === 'transactions') renderTransactions();
    if (page === 'analyser') renderAnalyser();
}

function toggleSidebar() {
    document.querySelector('.sidebar').classList.toggle('open');
}

// ============ TOAST ============
function toast(msg, type = '') {
    const container = document.getElementById('toastContainer');
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = msg;
    container.appendChild(t);
    setTimeout(() => t.remove(), 3000);
}

// ============ YOCO INTEGRATION ============
async function createYocoPaymentLink(zarAmount, invoiceNumber, clientName) {
    try {
        const response = await fetch('/.netlify/functions/yoco-checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                amount: zarAmount,
                currency: 'ZAR',
                invoiceNumber: invoiceNumber,
                clientName: clientName
            })
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || `HTTP ${response.status}`);
        }

        const data = await response.json();
        return data.paymentUrl;
    } catch (err) {
        console.error('Yoco checkout error:', err);
        toast('Failed to generate Yoco link: ' + err.message, 'error');
        return null;
    }
}

async function syncYocoPayments() {
    try {
        toast('Syncing Yoco payments...');
        const response = await fetch('/.netlify/functions/yoco-payments?limit=50');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();

        let synced = 0;
        if (data && Array.isArray(data)) {
            data.forEach(payment => {
                if (payment.status === 'succeeded' && payment.metadata?.invoiceNumber) {
                    const inv = state.invoices.find(i => i.invoiceNumber === payment.metadata.invoiceNumber);
                    if (inv && inv.status !== 'paid') {
                        inv.status = 'paid';
                        inv.paidAt = payment.createdDate || new Date().toISOString();
                        inv.updatedAt = new Date().toISOString();
                        synced++;
                    }
                }
            });
        }

        if (synced > 0) {
            saveState('invoices');
            renderInvoices();
            renderDashboard();
        }
        toast(`Yoco sync complete: ${synced} payments updated`, 'success');
    } catch (err) {
        console.error('Yoco sync error:', err);
        toast('Yoco sync failed: ' + err.message, 'error');
    }
}

// Check URL for payment callbacks
function checkPaymentCallback() {
    const params = new URLSearchParams(window.location.search);
    const paymentStatus = params.get('payment');
    const invoiceNum = params.get('invoice');

    if (paymentStatus && invoiceNum) {
        if (paymentStatus === 'success') {
            const inv = state.invoices.find(i => i.invoiceNumber === invoiceNum);
            if (inv && inv.status !== 'paid') {
                inv.status = 'paid';
                inv.paidAt = new Date().toISOString();
                inv.updatedAt = new Date().toISOString();
                saveState('invoices');
            }
            toast(`Payment received for ${invoiceNum}!`, 'success');
        } else if (paymentStatus === 'cancelled') {
            toast(`Payment cancelled for ${invoiceNum}`, 'error');
        } else if (paymentStatus === 'failed') {
            toast(`Payment failed for ${invoiceNum}`, 'error');
        }
        // Clean URL
        window.history.replaceState({}, '', window.location.pathname);
    }
}

// ============ LIVE EXCHANGE RATE ============
async function fetchLiveExchangeRate(from = 'USD', to = 'ZAR') {
    try {
        // Using free exchangerate-api
        const response = await fetch(`https://api.exchangerate-api.com/v4/latest/${from}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const rate = data.rates?.[to];
        if (rate) {
            return rate;
        }
        throw new Error('Rate not found');
    } catch (err) {
        console.warn('Exchange rate fetch failed, trying fallback:', err.message);
        try {
            // Fallback: open.er-api.com
            const resp2 = await fetch(`https://open.er-api.com/v6/latest/${from}`);
            const data2 = await resp2.json();
            return data2.rates?.[to] || null;
        } catch {
            return null;
        }
    }
}

async function updateExchangeRate() {
    const currency = document.getElementById('invCurrency')?.value || state.settings.currency;
    if (currency === 'ZAR') {
        document.getElementById('invExRate').value = 1;
        recalcInvoice();
        return;
    }

    toast('Fetching live exchange rate...');
    const rate = await fetchLiveExchangeRate(currency, 'ZAR');
    if (rate) {
        document.getElementById('invExRate').value = rate.toFixed(2);
        recalcInvoice();
        toast(`Live rate: 1 ${currency} = R ${rate.toFixed(2)}`, 'success');
    } else {
        toast('Could not fetch live rate, using saved default', 'error');
    }
}

async function refreshSettingsExchangeRate() {
    const currency = document.getElementById('settCurrency')?.value || 'USD';
    if (currency === 'ZAR') {
        document.getElementById('settExRate').value = 1;
        return;
    }
    toast('Fetching live rate...');
    const rate = await fetchLiveExchangeRate(currency, 'ZAR');
    if (rate) {
        document.getElementById('settExRate').value = rate.toFixed(2);
        toast(`Updated: 1 ${currency} = R ${rate.toFixed(2)}`, 'success');
    } else {
        toast('Failed to fetch rate', 'error');
    }
}

// ============ UPWORK CSV IMPORT ============
function parseUpworkCSV(csvText) {
    // Parse CSV handling quoted fields with commas
    const lines = [];
    let current = '';
    let inQuote = false;

    for (let i = 0; i < csvText.length; i++) {
        const ch = csvText[i];
        if (ch === '"') {
            inQuote = !inQuote;
            current += ch;
        } else if (ch === '\n' && !inQuote) {
            lines.push(current.trim());
            current = '';
        } else {
            current += ch;
        }
    }
    if (current.trim()) lines.push(current.trim());

    if (lines.length < 2) return [];

    // Parse header
    const headerFields = parseCSVLine(lines[0]);

    // Parse rows
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        if (!lines[i]) continue;
        const fields = parseCSVLine(lines[i]);
        const row = {};
        headerFields.forEach((h, idx) => {
            row[h.trim()] = (fields[idx] || '').trim();
        });
        rows.push(row);
    }
    return rows;
}

function parseCSVLine(line) {
    const fields = [];
    let current = '';
    let inQuote = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            inQuote = !inQuote;
        } else if (ch === ',' && !inQuote) {
            fields.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    fields.push(current);
    return fields;
}

function importUpworkCSV(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const rows = parseUpworkCSV(e.target.result);

            // Filter for earnings only (Hourly, Fixed-Price, Bonus) — exclude fees/VAT/withdrawals
            const earningTypes = ['Hourly', 'Fixed-Price', 'Bonus'];
            const earnings = rows.filter(r => earningTypes.includes(r['Transaction type']));

            // Group by client
            const clientEarnings = {};
            earnings.forEach(r => {
                const client = r['Client team'] || 'Unknown';
                const amount = parseFloat((r['Amount $'] || '0').replace(/,/g, ''));
                const date = r['Date'] || '';
                const desc = r['Transaction summary'] || r['Description 1'] || '';
                const hours = r['Description 2'] || '';
                const txType = r['Transaction type'];

                if (!clientEarnings[client]) {
                    clientEarnings[client] = {
                        total: 0,
                        transactions: [],
                        totalHours: 0
                    };
                }

                clientEarnings[client].total += amount;
                clientEarnings[client].transactions.push({ date, desc, amount, hours, txType });

                // Extract hours if available
                const hoursMatch = hours.match(/([\d.]+)\s*hours/i);
                if (hoursMatch) {
                    clientEarnings[client].totalHours += parseFloat(hoursMatch[1]);
                }
            });

            // Also gather fees and VAT
            const fees = rows.filter(r => r['Transaction type'] === 'Service Fee');
            const vat = rows.filter(r => r['Transaction type'] === 'VAT');
            const totalFees = fees.reduce((s, r) => s + parseFloat((r['Amount $'] || '0').replace(/,/g, '')), 0);
            const totalVat = vat.reduce((s, r) => s + parseFloat((r['Amount $'] || '0').replace(/,/g, '')), 0);

            // Store in state
            state.upworkData = {
                clientEarnings,
                totalGross: Object.values(clientEarnings).reduce((s, c) => s + c.total, 0),
                totalFees: Math.abs(totalFees),
                totalVat: Math.abs(totalVat),
                totalNet: Object.values(clientEarnings).reduce((s, c) => s + c.total, 0) + totalFees + totalVat,
                importedAt: new Date().toISOString(),
                rowCount: rows.length,
                earningCount: earnings.length
            };

            localStorage.setItem('oracle_upwork', JSON.stringify(state.upworkData));

            // Ensure a single "Upwork" client exists (don't create per-team clients)
            if (!state.clients.find(c => c.name === 'Upwork' || c.company === 'Upwork')) {
                state.clients.push({
                    id: Date.now() + Math.random() * 1000,
                    name: 'Upwork',
                    company: 'Upwork',
                    email: '',
                    phone: '',
                    address: '',
                    vat: '',
                    source: 'upwork',
                    createdAt: new Date().toISOString()
                });
                saveState('clients');
            }

            // Render results
            renderUpworkSummary();
            toast(`Imported ${earnings.length} Upwork earnings across ${Object.keys(clientEarnings).length} clients`, 'success');
        } catch (err) {
            console.error('Upwork CSV parse error:', err);
            toast('Error parsing Upwork CSV: ' + err.message, 'error');
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

function renderUpworkSummary() {
    const data = state.upworkData || JSON.parse(localStorage.getItem('oracle_upwork') || 'null');
    if (!data) return;

    const container = document.getElementById('upworkSummary');
    if (!container) return;

    const clients = Object.entries(data.clientEarnings).sort((a, b) => b[1].total - a[1].total);
    const maxEarning = clients[0]?.[1]?.total || 1;

    container.innerHTML = `
        <div class="stats-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:20px;">
            <div class="stat-card">
                <div class="stat-header"><span class="stat-label">Gross Earnings</span></div>
                <div class="stat-value" style="font-size:22px;">$${data.totalGross.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}</div>
            </div>
            <div class="stat-card">
                <div class="stat-header"><span class="stat-label">Upwork Fees</span></div>
                <div class="stat-value" style="font-size:22px;color:var(--danger);">-$${data.totalFees.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}</div>
            </div>
            <div class="stat-card">
                <div class="stat-header"><span class="stat-label">VAT</span></div>
                <div class="stat-value" style="font-size:22px;color:var(--warning);">-$${data.totalVat.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}</div>
            </div>
            <div class="stat-card">
                <div class="stat-header"><span class="stat-label">Net Earnings</span></div>
                <div class="stat-value" style="font-size:22px;color:var(--success);">$${data.totalNet.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}</div>
            </div>
        </div>
        <div class="card">
            <div class="card-header">
                <div class="card-title">Earnings by Client (${clients.length} clients, ${data.earningCount} transactions)</div>
            </div>
            <div class="card-body">
                ${clients.map(([name, info]) => `
                    <div class="revenue-item">
                        <div class="revenue-name" style="min-width:140px;">${name}</div>
                        <div class="revenue-bar-wrap"><div class="revenue-bar" style="width:${(info.total / maxEarning * 100)}%;background:var(--success);"></div></div>
                        <div class="revenue-amount" style="min-width:120px;">$${info.total.toLocaleString('en-US', {minimumFractionDigits:2})} · ${info.totalHours.toFixed(1)}h</div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

// ============ HELPERS ============
function generateInvoiceNumber() {
    const prefix = state.settings.prefix || 'EXD';
    const year = new Date().getFullYear();
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `${prefix}-${year}-${rand}`;
}

function formatCurrency(amount, currency = 'USD') {
    if (currency === 'ZAR') return `R ${Number(amount).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (currency === 'EUR') return `€${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (currency === 'GBP') return `£${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    return `$${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function getClientInvoices(clientName) {
    return state.invoices.filter(inv => inv.client?.name === clientName);
}

// ============ DASHBOARD ============
function renderDashboard() {
    const total = state.invoices.reduce((s, i) => s + (i.zarTotal || 0), 0);
    const paid = state.invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.zarTotal || 0), 0);
    const pending = state.invoices.filter(i => i.status === 'pending').reduce((s, i) => s + (i.zarTotal || 0), 0);

    document.getElementById('dashboardStats').innerHTML = `
        <div class="stat-card">
            <div class="stat-header">
                <span class="stat-label">Total Revenue</span>
                <div class="stat-icon"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg></div>
            </div>
            <div class="stat-value">R ${Math.round(total).toLocaleString()}</div>
            <div class="stat-change positive">${state.invoices.length} invoices</div>
        </div>
        <div class="stat-card">
            <div class="stat-header">
                <span class="stat-label">Paid</span>
                <div class="stat-icon" style="background:rgba(34,197,94,0.1);color:var(--success);"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg></div>
            </div>
            <div class="stat-value">R ${Math.round(paid).toLocaleString()}</div>
            <div class="stat-change positive">${state.invoices.filter(i => i.status === 'paid').length} paid</div>
        </div>
        <div class="stat-card">
            <div class="stat-header">
                <span class="stat-label">Outstanding</span>
                <div class="stat-icon" style="background:rgba(245,158,11,0.1);color:var(--warning);"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg></div>
            </div>
            <div class="stat-value">R ${Math.round(pending).toLocaleString()}</div>
            <div class="stat-change negative">${state.invoices.filter(i => i.status === 'pending').length} pending</div>
        </div>
        <div class="stat-card">
            <div class="stat-header">
                <span class="stat-label">Clients</span>
                <div class="stat-icon"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"></path></svg></div>
            </div>
            <div class="stat-value">${state.clients.length}</div>
            <div class="stat-change positive">active</div>
        </div>
    `;

    // Recent invoices
    const recent = [...state.invoices].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 6);
    document.getElementById('recentInvoices').innerHTML = recent.length ? recent.map(inv => `
        <div class="list-item" onclick="editInvoice('${inv.id}')">
            <div class="list-icon ${inv.status === 'paid' ? 'income' : 'pending'}">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
            </div>
            <div class="list-info">
                <div class="list-title">${inv.invoiceNumber} — ${inv.client?.name || 'Unknown'}</div>
                <div class="list-meta">${formatDate(inv.date)} · ${inv.lineItems?.length || 0} items</div>
            </div>
            <span class="list-amount ${inv.status === 'paid' ? 'positive' : ''}">${formatCurrency(inv.subtotal, inv.currency)}</span>
            <span class="invoice-status ${inv.status}">${inv.status}</span>
        </div>
    `).join('') : '<div class="empty-state"><p>No invoices yet. Create your first invoice!</p></div>';

    // Revenue by client
    const clientRevMap = {};
    state.invoices.forEach(inv => {
        const name = inv.client?.name || 'Unknown';
        clientRevMap[name] = (clientRevMap[name] || 0) + (inv.zarTotal || 0);
    });
    const sorted = Object.entries(clientRevMap).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const maxRev = sorted[0]?.[1] || 1;

    document.getElementById('clientRevenue').innerHTML = sorted.length ? sorted.map(([name, amount]) => `
        <div class="revenue-item">
            <div class="revenue-name">${name.split(' ')[0]}</div>
            <div class="revenue-bar-wrap"><div class="revenue-bar" style="width:${(amount / maxRev * 100)}%"></div></div>
            <div class="revenue-amount">R ${Math.round(amount).toLocaleString()}</div>
        </div>
    `).join('') : '<div class="empty-state"><p>No revenue data yet.</p></div>';

    // Update badges
    document.getElementById('invoicesBadge').textContent = state.invoices.length;
    document.getElementById('clientsBadge').textContent = state.clients.length;
}

// ============ INVOICES ============
function renderInvoices() {
    let filtered = [...state.invoices];
    if (currentFilter !== 'all') filtered = filtered.filter(i => i.status === currentFilter);
    filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    document.getElementById('invoicesList').innerHTML = filtered.length ? filtered.map(inv => `
        <div class="list-item" onclick="editInvoice('${inv.id}')">
            <div class="list-icon ${inv.status === 'paid' ? 'income' : 'pending'}">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
            </div>
            <div class="list-info">
                <div class="list-title">${inv.invoiceNumber} — ${inv.client?.company || inv.client?.name || 'Unknown'}</div>
                <div class="list-meta">${inv.client?.name || ''} · ${formatDate(inv.date)} · ${inv.currency} · ${inv.paymentMethod || ''}</div>
            </div>
            <span class="list-amount ${inv.status === 'paid' ? 'positive' : ''}">${formatCurrency(inv.subtotal, inv.currency)}</span>
            <span class="invoice-status ${inv.status}">${inv.status}</span>
            <div class="list-actions">
                <button class="list-action" title="Preview" onclick="event.stopPropagation(); previewInvoiceById('${inv.id}')">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>
                </button>
                <button class="list-action" title="${inv.status === 'paid' ? 'Mark Pending' : 'Mark Paid'}" onclick="event.stopPropagation(); togglePaid('${inv.id}')">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                </button>
                <button class="list-action" title="Delete" onclick="event.stopPropagation(); deleteInvoice('${inv.id}')">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                </button>
            </div>
        </div>
    `).join('') : '<div class="empty-state"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg><p>No invoices found. Click "New Invoice" to get started.</p></div>';
}

function filterInvoices(filter) {
    currentFilter = filter;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === filter));
    renderInvoices();
}

function openNewInvoice() {
    editingInvoiceId = null;
    document.getElementById('invoiceModalTitle').textContent = 'New Invoice';
    document.getElementById('invNumber').value = generateInvoiceNumber();
    document.getElementById('invDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('invTerms').value = state.settings.paymentTerms;
    document.getElementById('invCurrency').value = state.settings.currency;
    document.getElementById('invExRate').value = state.settings.exchangeRate;
    document.getElementById('invPayMethod').value = state.settings.paymentMethod;
    document.getElementById('invPayLink').value = '';
    document.getElementById('invRemarks').value = '';

    populateClientDropdown();
    document.getElementById('invClient').value = '';

    // Reset line items with one empty row
    document.getElementById('lineItems').innerHTML = '';
    addLineItem();

    recalcInvoice();
    openModal('invoiceModal', 'invoiceModalOverlay');

    // Auto-fetch live exchange rate for new invoices
    updateExchangeRate();
}

function editInvoice(id) {
    const inv = state.invoices.find(i => String(i.id) === String(id));
    if (!inv) return;

    editingInvoiceId = inv.id;
    document.getElementById('invoiceModalTitle').textContent = 'Edit Invoice';
    document.getElementById('invNumber').value = inv.invoiceNumber;
    document.getElementById('invDate').value = inv.date;
    document.getElementById('invTerms').value = inv.paymentTerms || '3 days';
    document.getElementById('invCurrency').value = inv.currency || 'USD';
    document.getElementById('invExRate').value = inv.exchangeRate || 18.50;
    document.getElementById('invPayMethod').value = inv.paymentMethod || 'yoco';
    document.getElementById('invPayLink').value = inv.paymentLink || '';
    document.getElementById('invRemarks').value = inv.remarks || '';

    populateClientDropdown();
    document.getElementById('invClient').value = inv.client?.name || '';

    // Populate line items
    document.getElementById('lineItems').innerHTML = '';
    (inv.lineItems || []).forEach(li => addLineItem(li));
    if (!inv.lineItems || inv.lineItems.length === 0) addLineItem();

    recalcInvoice();
    openModal('invoiceModal', 'invoiceModalOverlay');
}

async function saveInvoice() {
    const clientName = document.getElementById('invClient').value;
    const client = state.clients.find(c => c.name === clientName) || { name: clientName };

    const lineItems = getLineItems();
    if (lineItems.length === 0) { toast('Add at least one line item', 'error'); return; }
    if (!clientName) { toast('Select or enter a client', 'error'); return; }

    const currency = document.getElementById('invCurrency').value;
    const exchangeRate = parseFloat(document.getElementById('invExRate').value) || 1;
    const subtotal = lineItems.reduce((s, li) => s + (parseFloat(li.qty) || 0) * (parseFloat(li.unitPrice) || 0), 0);
    const zarTotal = currency === 'ZAR' ? subtotal : subtotal * exchangeRate;

    const invoice = {
        id: editingInvoiceId || Date.now(),
        invoiceNumber: document.getElementById('invNumber').value,
        date: document.getElementById('invDate').value,
        dueDate: '',
        paymentTerms: document.getElementById('invTerms').value,
        client: client,
        clientId: client.id || null,
        lineItems: lineItems,
        currency: currency,
        exchangeRate: exchangeRate,
        subtotal: subtotal,
        zarTotal: zarTotal,
        remarks: document.getElementById('invRemarks').value,
        paymentLink: document.getElementById('invPayLink').value,
        paymentMethod: document.getElementById('invPayMethod').value,
        status: editingInvoiceId ? (state.invoices.find(i => i.id === editingInvoiceId)?.status || 'pending') : 'pending',
        createdAt: editingInvoiceId ? (state.invoices.find(i => i.id === editingInvoiceId)?.createdAt || new Date().toISOString()) : new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    if (editingInvoiceId) {
        const idx = state.invoices.findIndex(i => i.id === editingInvoiceId);
        if (idx >= 0) state.invoices[idx] = invoice;
    } else {
        state.invoices.push(invoice);
    }

    saveState('invoices');
    closeInvoiceModal();

    // Auto-generate Yoco payment link if method is yoco and no link exists
    if (invoice.paymentMethod === 'yoco' && !invoice.paymentLink && invoice.zarTotal > 0 && state.settings.yocoEnabled) {
        toast('Generating Yoco payment link...', '');
        const payUrl = await createYocoPaymentLink(invoice.zarTotal, invoice.invoiceNumber, invoice.client?.name || '');
        if (payUrl) {
            invoice.paymentLink = payUrl;
            saveState('invoices');
            toast('Yoco payment link generated!', 'success');
        }
    } else {
        toast(editingInvoiceId ? 'Invoice updated' : 'Invoice created', 'success');
    }

    renderInvoices();
    renderDashboard();
}

function deleteInvoice(id) {
    if (!confirm('Delete this invoice?')) return;
    state.invoices = state.invoices.filter(i => String(i.id) !== String(id));
    saveState('invoices');
    toast('Invoice deleted');
    renderInvoices();
    renderDashboard();
}

function togglePaid(id) {
    const inv = state.invoices.find(i => String(i.id) === String(id));
    if (!inv) return;
    inv.status = inv.status === 'paid' ? 'pending' : 'paid';
    if (inv.status === 'paid') inv.paidAt = new Date().toISOString();
    inv.updatedAt = new Date().toISOString();
    saveState('invoices');
    toast(`Invoice marked as ${inv.status}`, 'success');
    renderInvoices();
    renderDashboard();
}

// ============ LINE ITEMS ============
function addLineItem(data = null) {
    const container = document.getElementById('lineItems');

    // Add header if first item
    if (container.children.length === 0) {
        const header = document.createElement('div');
        header.className = 'line-item-header';
        header.innerHTML = '<span>Description</span><span>Qty</span><span>Rate</span><span></span><span></span>';
        container.appendChild(header);
    }

    const row = document.createElement('div');
    row.className = 'line-item-row';
    const isHours = data?.isHours || false;
    row.innerHTML = `
        <input class="form-input li-desc" placeholder="Description" value="${data?.description || ''}" oninput="recalcInvoice()">
        <input class="form-input li-qty" type="number" step="0.01" placeholder="Qty" value="${data?.qty || ''}" oninput="recalcInvoice()">
        <input class="form-input li-rate" type="number" step="0.01" placeholder="Rate" value="${data?.unitPrice || ''}" oninput="recalcInvoice()">
        <button class="line-hours-toggle ${isHours ? 'active' : ''}" title="Hours" onclick="this.classList.toggle('active')">H</button>
        <button class="line-remove" onclick="this.parentElement.remove(); recalcInvoice()">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="14" height="14"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
        </button>
    `;
    container.appendChild(row);
}

function getLineItems() {
    const rows = document.querySelectorAll('.line-item-row');
    const items = [];
    rows.forEach((row, i) => {
        const desc = row.querySelector('.li-desc')?.value?.trim();
        const qty = row.querySelector('.li-qty')?.value;
        const rate = row.querySelector('.li-rate')?.value;
        const isHours = row.querySelector('.line-hours-toggle')?.classList.contains('active') || false;
        if (desc || qty || rate) {
            items.push({
                id: Date.now() + i,
                description: desc || '',
                qty: qty || '0',
                unitPrice: rate || '0',
                isHours: isHours
            });
        }
    });
    return items;
}

function recalcInvoice() {
    const items = getLineItems();
    const currency = document.getElementById('invCurrency').value;
    const exRate = parseFloat(document.getElementById('invExRate').value) || 1;
    const subtotal = items.reduce((s, li) => s + (parseFloat(li.qty) || 0) * (parseFloat(li.unitPrice) || 0), 0);
    const zarTotal = currency === 'ZAR' ? subtotal : subtotal * exRate;

    document.getElementById('invSubtotal').textContent = formatCurrency(subtotal, currency);
    document.getElementById('invZarTotal').textContent = `R ${zarTotal.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ============ CLIENTS ============
function renderClients() {
    document.getElementById('clientsGrid').innerHTML = state.clients.length ? state.clients.map(c => {
        const invs = getClientInvoices(c.name);
        const totalRev = invs.reduce((s, i) => s + (i.zarTotal || 0), 0);
        return `
            <div class="client-card" onclick="editClient('${c.id || c.name}')">
                <div class="client-card-header">
                    <div>
                        <div class="client-name">${c.name}</div>
                        <div class="client-company">${c.company || ''}</div>
                    </div>
                    <button class="list-action" title="Delete" onclick="event.stopPropagation(); deleteClient('${c.id || c.name}')">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    </button>
                </div>
                ${c.email ? `<div class="client-detail"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>${c.email}</div>` : ''}
                ${c.phone ? `<div class="client-detail"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"></path></svg>${c.phone}</div>` : ''}
                <div class="client-stats">
                    <div><div class="client-stat-label">Invoices</div><div class="client-stat-value">${invs.length}</div></div>
                    <div><div class="client-stat-label">Revenue</div><div class="client-stat-value">R ${Math.round(totalRev).toLocaleString()}</div></div>
                </div>
            </div>
        `;
    }).join('') : '<div class="empty-state" style="grid-column:1/-1;"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"></path></svg><p>No clients yet. Add your first client!</p></div>';
}

function openNewClient() {
    editingClientId = null;
    document.getElementById('clientModalTitle').textContent = 'New Client';
    document.getElementById('cliName').value = '';
    document.getElementById('cliCompany').value = '';
    document.getElementById('cliEmail').value = '';
    document.getElementById('cliPhone').value = '';
    document.getElementById('cliAddress').value = '';
    document.getElementById('cliVat').value = '';
    openModal('clientModal', 'clientModalOverlay');
}

function editClient(idOrName) {
    const client = state.clients.find(c => String(c.id) === String(idOrName) || c.name === idOrName);
    if (!client) return;

    editingClientId = client.id || client.name;
    document.getElementById('clientModalTitle').textContent = 'Edit Client';
    document.getElementById('cliName').value = client.name || '';
    document.getElementById('cliCompany').value = client.company || '';
    document.getElementById('cliEmail').value = client.email || '';
    document.getElementById('cliPhone').value = client.phone || '';
    document.getElementById('cliAddress').value = client.address || '';
    document.getElementById('cliVat').value = client.vat || '';
    openModal('clientModal', 'clientModalOverlay');
}

function saveClient() {
    const name = document.getElementById('cliName').value.trim();
    if (!name) { toast('Client name is required', 'error'); return; }

    const client = {
        id: editingClientId && editingClientId !== name ? editingClientId : Date.now(),
        name: name,
        company: document.getElementById('cliCompany').value.trim(),
        email: document.getElementById('cliEmail').value.trim(),
        phone: document.getElementById('cliPhone').value.trim(),
        address: document.getElementById('cliAddress').value.trim(),
        vat: document.getElementById('cliVat').value.trim(),
        createdAt: new Date().toISOString()
    };

    if (editingClientId) {
        const idx = state.clients.findIndex(c => String(c.id) === String(editingClientId) || c.name === editingClientId);
        if (idx >= 0) state.clients[idx] = { ...state.clients[idx], ...client };
        else state.clients.push(client);
    } else {
        state.clients.push(client);
    }

    saveState('clients');
    closeClientModal();
    toast(editingClientId ? 'Client updated' : 'Client added', 'success');
    renderClients();
    renderDashboard();
}

function deleteClient(idOrName) {
    if (!confirm('Delete this client?')) return;
    state.clients = state.clients.filter(c => String(c.id) !== String(idOrName) && c.name !== idOrName);
    saveState('clients');
    toast('Client deleted');
    renderClients();
    renderDashboard();
}

function populateClientDropdown() {
    const select = document.getElementById('invClient');
    select.innerHTML = '<option value="">Select client...</option>';
    state.clients.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.name;
        opt.textContent = `${c.name}${c.company ? ' — ' + c.company : ''}`;
        select.appendChild(opt);
    });
}

function onClientSelect() {
    // Could auto-fill client details if needed
}

// ============ PAYMENTS ============
function renderPayments() {
    const paid = state.invoices.filter(i => i.status === 'paid').sort((a, b) => new Date(b.paidAt || b.updatedAt || b.createdAt) - new Date(a.paidAt || a.updatedAt || a.createdAt));
    const pending = state.invoices.filter(i => i.status === 'pending');

    const totalPaid = paid.reduce((s, i) => s + (i.zarTotal || 0), 0);
    const totalPending = pending.reduce((s, i) => s + (i.zarTotal || 0), 0);

    document.getElementById('paymentStats').innerHTML = `
        <div class="stat-card">
            <div class="stat-header">
                <span class="stat-label">Total Received</span>
                <div class="stat-icon" style="background:rgba(34,197,94,0.1);color:var(--success);"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg></div>
            </div>
            <div class="stat-value">R ${Math.round(totalPaid).toLocaleString()}</div>
        </div>
        <div class="stat-card">
            <div class="stat-header">
                <span class="stat-label">Awaiting Payment</span>
                <div class="stat-icon" style="background:rgba(245,158,11,0.1);color:var(--warning);"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg></div>
            </div>
            <div class="stat-value">R ${Math.round(totalPending).toLocaleString()}</div>
        </div>
        <div class="stat-card">
            <div class="stat-header">
                <span class="stat-label">Collection Rate</span>
                <div class="stat-icon"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"></path></svg></div>
            </div>
            <div class="stat-value">${state.invoices.length ? Math.round(paid.length / state.invoices.length * 100) : 0}%</div>
        </div>
        <div class="stat-card">
            <div class="stat-header">
                <span class="stat-label">Avg Invoice</span>
                <div class="stat-icon"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg></div>
            </div>
            <div class="stat-value">R ${state.invoices.length ? Math.round((totalPaid + totalPending) / state.invoices.length).toLocaleString() : 0}</div>
        </div>
    `;

    document.getElementById('paymentsList').innerHTML = paid.length ? paid.map(inv => `
        <div class="list-item">
            <div class="list-icon income">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
            </div>
            <div class="list-info">
                <div class="list-title">${inv.invoiceNumber} — ${inv.client?.name || 'Unknown'}</div>
                <div class="list-meta">Paid ${formatDate(inv.paidAt || inv.updatedAt)} · ${inv.paymentMethod || 'N/A'}</div>
            </div>
            <span class="list-amount positive">${formatCurrency(inv.subtotal, inv.currency)}</span>
        </div>
    `).join('') : '<div class="empty-state"><p>No payments recorded yet.</p></div>';
}

// ============ INVOICE PREVIEW / PRINT ============
function previewInvoice() {
    const clientName = document.getElementById('invClient').value;
    const client = state.clients.find(c => c.name === clientName) || { name: clientName };
    const lineItems = getLineItems();
    const currency = document.getElementById('invCurrency').value;
    const exRate = parseFloat(document.getElementById('invExRate').value) || 1;
    const subtotal = lineItems.reduce((s, li) => s + (parseFloat(li.qty) || 0) * (parseFloat(li.unitPrice) || 0), 0);
    const zarTotal = currency === 'ZAR' ? subtotal : subtotal * exRate;

    const inv = {
        invoiceNumber: document.getElementById('invNumber').value,
        date: document.getElementById('invDate').value,
        paymentTerms: document.getElementById('invTerms').value,
        client: client,
        lineItems: lineItems,
        currency: currency,
        exchangeRate: exRate,
        subtotal: subtotal,
        zarTotal: zarTotal,
        remarks: document.getElementById('invRemarks').value,
        paymentLink: document.getElementById('invPayLink').value,
        paymentMethod: document.getElementById('invPayMethod').value
    };

    renderInvoicePrint(inv);
    openModal('previewModal', 'previewOverlay');
}

function previewInvoiceById(id) {
    const inv = state.invoices.find(i => String(i.id) === String(id));
    if (!inv) return;
    renderInvoicePrint(inv);
    openModal('previewModal', 'previewOverlay');
}

function renderInvoicePrint(inv) {
    const s = state.settings;
    document.getElementById('invoicePrintArea').innerHTML = `
        <div class="invoice-print">
            <div class="inv-header">
                <div class="inv-brand">
                    <div class="inv-brand-icon"><span>Ex</span></div>
                    <div class="inv-brand-text">
                        <h2>${s.company}</h2>
                        <p>${s.email}</p>
                    </div>
                </div>
                <div class="inv-title">
                    <h1>INVOICE</h1>
                    <div class="inv-number">${inv.invoiceNumber}</div>
                </div>
            </div>

            <div class="inv-meta">
                <div class="inv-meta-section">
                    <h4>Bill To</h4>
                    <p>
                        <strong>${inv.client?.name || '-'}</strong><br>
                        ${inv.client?.company ? inv.client.company + '<br>' : ''}
                        ${inv.client?.email ? inv.client.email + '<br>' : ''}
                        ${inv.client?.phone ? inv.client.phone + '<br>' : ''}
                        ${inv.client?.address ? inv.client.address : ''}
                    </p>
                </div>
                <div class="inv-meta-section">
                    <h4>From</h4>
                    <p>
                        <strong>${s.company}</strong><br>
                        ${s.email}<br>
                        ${s.phone}<br>
                        ${s.address || ''}
                    </p>
                </div>
            </div>

            <div class="inv-details">
                <div class="inv-detail-item"><label>Date:</label><span>${formatDate(inv.date)}</span></div>
                <div class="inv-detail-item"><label>Terms:</label><span>${inv.paymentTerms}</span></div>
                <div class="inv-detail-item"><label>Currency:</label><span>${inv.currency}</span></div>
                ${inv.currency !== 'ZAR' ? `<div class="inv-detail-item"><label>Rate:</label><span>1 ${inv.currency} = R ${inv.exchangeRate}</span></div>` : ''}
            </div>

            <table class="inv-table">
                <thead>
                    <tr>
                        <th>Description</th>
                        <th>Qty${inv.lineItems?.some(l => l.isHours) ? ' / Hrs' : ''}</th>
                        <th>Rate</th>
                        <th>Amount</th>
                    </tr>
                </thead>
                <tbody>
                    ${(inv.lineItems || []).map(li => {
                        const qty = parseFloat(li.qty) || 0;
                        const rate = parseFloat(li.unitPrice) || 0;
                        return `<tr>
                            <td>${li.description}${li.isHours ? ' <span style="color:var(--grey-400);font-size:11px;">(hrs)</span>' : ''}</td>
                            <td>${qty}</td>
                            <td>${formatCurrency(rate, inv.currency)}</td>
                            <td>${formatCurrency(qty * rate, inv.currency)}</td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>

            <div class="inv-totals">
                <div class="inv-totals-box">
                    <div class="inv-total-row">
                        <span>Subtotal</span>
                        <span>${formatCurrency(inv.subtotal, inv.currency)}</span>
                    </div>
                    ${inv.currency !== 'ZAR' ? `
                        <div class="inv-total-row">
                            <span>Exchange Rate</span>
                            <span>× ${inv.exchangeRate}</span>
                        </div>
                    ` : ''}
                    <div class="inv-total-row inv-total-final">
                        <span>${inv.currency === 'ZAR' ? 'Total' : 'ZAR Total'}</span>
                        <span>R ${(inv.zarTotal || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                </div>
            </div>

            ${inv.remarks ? `<div class="inv-footer"><p><strong>Notes:</strong> ${inv.remarks}</p></div>` : ''}

            <div class="inv-payment-info">
                <h4>Payment Information</h4>
                ${inv.paymentMethod ? `<p><strong>Method:</strong> ${inv.paymentMethod.charAt(0).toUpperCase() + inv.paymentMethod.slice(1)}</p>` : ''}
                ${inv.paymentLink ? `<p><strong>Pay online:</strong> <a href="${inv.paymentLink}" target="_blank" style="color:var(--info);text-decoration:underline;">${inv.paymentLink}</a></p>` : ''}
                ${inv.paymentMethod === 'bank' || inv.paymentMethod === 'yoco' ? `
                    <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--grey-200);">
                        <p style="margin-bottom:4px;"><strong>Bank Transfer Details:</strong></p>
                        <p>Bank: ${s.bankName || 'Standard Bank'}</p>
                        <p>Account Holder: ${s.bankAccountHolder || s.company}</p>
                        <p>Account Number: ${s.bankAccountNum || ''}</p>
                        <p>Branch Code: ${s.bankBranchCode || ''}</p>
                        <p>SWIFT: ${s.bankSwift || ''}</p>
                    </div>
                ` : ''}
                ${inv.paymentMethod === 'wise' ? `
                    <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--grey-200);">
                        <p style="margin-bottom:4px;"><strong>Wise Transfer Details:</strong></p>
                        <p>Account Holder: ${s.wiseAccountHolder || s.company}</p>
                        <p>Email: ${s.wiseEmail || s.email}</p>
                        ${s.wiseIban ? `<p>IBAN: ${s.wiseIban}</p>` : ''}
                        ${s.wiseRoutingNum ? `<p>Routing: ${s.wiseRoutingNum}</p>` : ''}
                        ${s.wiseAccountNum ? `<p>Account: ${s.wiseAccountNum}</p>` : ''}
                        ${s.wiseSwift ? `<p>SWIFT/BIC: ${s.wiseSwift}</p>` : ''}
                        <p>Currency: ${s.wiseCurrency || 'USD'}</p>
                    </div>
                ` : ''}
            </div>
        </div>
    `;
}

function printInvoice() {
    window.print();
}

// ============ SETTINGS ============
function loadSettings() {
    const s = state.settings;
    document.getElementById('settCompany').value = s.company || '';
    document.getElementById('settEmail').value = s.email || '';
    document.getElementById('settPhone').value = s.phone || '';
    document.getElementById('settAddress').value = s.address || '';
    document.getElementById('settPrefix').value = s.prefix || 'EXD';
    document.getElementById('settCurrency').value = s.currency || 'USD';
    document.getElementById('settExRate').value = s.exchangeRate || 18.50;
    document.getElementById('settTerms').value = s.paymentTerms || '3 days';
    document.getElementById('settPayMethod').value = s.paymentMethod || 'yoco';
    // Bank
    document.getElementById('settBankName').value = s.bankName || 'Standard Bank';
    document.getElementById('settBankHolder').value = s.bankAccountHolder || s.company || '';
    document.getElementById('settBankAccNum').value = s.bankAccountNum || '';
    document.getElementById('settBankBranch').value = s.bankBranchCode || '';
    document.getElementById('settBankSwift').value = s.bankSwift || '';
    // Wise
    document.getElementById('settWiseHolder').value = s.wiseAccountHolder || '';
    document.getElementById('settWiseEmail').value = s.wiseEmail || s.email || '';
    document.getElementById('settWiseIban').value = s.wiseIban || '';
    document.getElementById('settWiseCurrency').value = s.wiseCurrency || 'USD';
    document.getElementById('settWiseAccNum').value = s.wiseAccountNum || '';
    document.getElementById('settWiseRouting').value = s.wiseRoutingNum || '';
    document.getElementById('settWiseSwift').value = s.wiseSwift || '';
    // Yoco
    document.getElementById('settYocoEnabled').checked = s.yocoEnabled !== false;
}

function saveSettings() {
    state.settings = {
        company: document.getElementById('settCompany').value,
        email: document.getElementById('settEmail').value,
        phone: document.getElementById('settPhone').value,
        address: document.getElementById('settAddress').value,
        prefix: document.getElementById('settPrefix').value,
        currency: document.getElementById('settCurrency').value,
        exchangeRate: parseFloat(document.getElementById('settExRate').value) || 18.50,
        paymentTerms: document.getElementById('settTerms').value,
        paymentMethod: document.getElementById('settPayMethod').value,
        // Bank
        bankName: document.getElementById('settBankName').value,
        bankAccountHolder: document.getElementById('settBankHolder').value,
        bankAccountNum: document.getElementById('settBankAccNum').value,
        bankBranchCode: document.getElementById('settBankBranch').value,
        bankSwift: document.getElementById('settBankSwift').value,
        // Wise
        wiseAccountHolder: document.getElementById('settWiseHolder').value,
        wiseEmail: document.getElementById('settWiseEmail').value,
        wiseIban: document.getElementById('settWiseIban').value,
        wiseCurrency: document.getElementById('settWiseCurrency').value,
        wiseAccountNum: document.getElementById('settWiseAccNum').value,
        wiseRoutingNum: document.getElementById('settWiseRouting').value,
        wiseSwift: document.getElementById('settWiseSwift').value,
        // Yoco
        yocoEnabled: document.getElementById('settYocoEnabled').checked
    };
    saveState('settings');
    toast('Settings saved', 'success');
}

// ============ DATA IMPORT/EXPORT ============
function exportData() {
    const data = {
        invoices: state.invoices,
        clients: state.clients,
        payments: state.payments,
        settings: state.settings,
        exportedAt: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `oracle-invoices-export-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Data exported successfully', 'success');
}

function importData(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (data.invoices) state.invoices = data.invoices;
            if (data.clients) state.clients = data.clients;
            if (data.payments) state.payments = data.payments;
            if (data.settings) state.settings = { ...state.settings, ...data.settings };
            saveState();
            loadSettings();
            renderDashboard();
            toast('Data imported successfully', 'success');
        } catch (err) {
            toast('Invalid JSON file', 'error');
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

function importOracleData(event) {
    const files = event.target.files;
    if (!files.length) return;

    let imported = { invoices: 0, clients: 0 };

    Array.from(files).forEach(file => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);

                // Detect if it's invoices or clients
                if (Array.isArray(data)) {
                    if (data[0]?.invoiceNumber || data[0]?.lineItems) {
                        // Invoices
                        data.forEach(inv => {
                            if (!state.invoices.find(i => i.invoiceNumber === inv.invoiceNumber)) {
                                state.invoices.push(inv);
                                imported.invoices++;
                            }
                        });
                    } else if (data[0]?.name && (data[0]?.company !== undefined || data[0]?.email !== undefined || data[0]?.phone !== undefined)) {
                        // Clients
                        data.forEach(cli => {
                            if (!state.clients.find(c => c.name === cli.name)) {
                                state.clients.push(cli);
                                imported.clients++;
                            }
                        });
                    }
                }

                saveState();
                renderDashboard();
                renderClients();

                document.getElementById('syncStatus').innerHTML = `
                    <div style="padding:12px;background:rgba(34,197,94,0.1);border-radius:8px;font-size:13px;color:var(--success);">
                        Imported ${imported.invoices} invoices and ${imported.clients} clients.
                    </div>
                `;
            } catch (err) {
                toast('Error parsing file: ' + file.name, 'error');
            }
        };
        reader.readAsText(file);
    });

    event.target.value = '';
}

// ============ MODAL HELPERS ============
function openModal(modalId, overlayId) {
    document.getElementById(overlayId).classList.add('active');
    document.getElementById(modalId).classList.add('active');
}

function closeInvoiceModal() {
    document.getElementById('invoiceModalOverlay').classList.remove('active');
    document.getElementById('invoiceModal').classList.remove('active');
}

function closeClientModal() {
    document.getElementById('clientModalOverlay').classList.remove('active');
    document.getElementById('clientModal').classList.remove('active');
}

function closePreview() {
    document.getElementById('previewOverlay').classList.remove('active');
    document.getElementById('previewModal').classList.remove('active');
}

// Close modals on Escape
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeInvoiceModal();
        closeClientModal();
        closePreview();
    }
});

// ============ TRANSACTIONS ============
let currentTxFilter = 'all';

function filterTransactions(filter) {
    currentTxFilter = filter;
    document.querySelectorAll('[data-txfilter]').forEach(b => b.classList.toggle('active', b.dataset.txfilter === filter));
    renderTransactions();
}

function getAllTransactions() {
    const transactions = [];

    // Invoice-based transactions
    state.invoices.forEach(inv => {
        transactions.push({
            id: inv.id,
            date: inv.date || inv.createdAt,
            type: 'income',
            category: inv.paymentMethod === 'yoco' ? 'Yoco' : inv.paymentMethod === 'wise' ? 'Wise' : inv.paymentMethod === 'bank' ? 'Bank Transfer' : 'Invoice',
            description: `${inv.invoiceNumber} — ${inv.client?.name || 'Unknown'}`,
            client: inv.client?.name || 'Unknown',
            amount: inv.zarTotal || 0,
            currency: 'ZAR',
            originalAmount: inv.subtotal || 0,
            originalCurrency: inv.currency || 'ZAR',
            status: inv.status,
            source: 'invoice',
            paymentMethod: inv.paymentMethod
        });
    });

    // Upwork transactions
    const upworkData = state.upworkData || JSON.parse(localStorage.getItem('oracle_upwork') || 'null');
    if (upworkData?.clientEarnings) {
        Object.entries(upworkData.clientEarnings).forEach(([clientTeam, info]) => {
            info.transactions.forEach(tx => {
                const amount = parseFloat(tx.amount) || 0;
                transactions.push({
                    id: `upwork-${tx.date}-${clientTeam}-${Math.random()}`,
                    date: tx.date || upworkData.importedAt,
                    type: amount >= 0 ? 'income' : 'expense',
                    category: 'Upwork',
                    description: `${tx.txType}: ${clientTeam}${tx.desc ? ' — ' + tx.desc : ''}`,
                    client: 'Upwork',
                    team: clientTeam,
                    amount: Math.abs(amount) * (state.settings.exchangeRate || 18.5),
                    currency: 'ZAR',
                    originalAmount: Math.abs(amount),
                    originalCurrency: 'USD',
                    status: 'paid',
                    source: 'upwork',
                    txType: tx.txType
                });
            });
        });

        // Upwork fees
        if (upworkData.totalFees > 0) {
            transactions.push({
                id: 'upwork-fees',
                date: upworkData.importedAt,
                type: 'expense',
                category: 'Upwork Fees',
                description: 'Upwork Service Fees (total)',
                client: 'Upwork',
                amount: upworkData.totalFees * (state.settings.exchangeRate || 18.5),
                currency: 'ZAR',
                originalAmount: upworkData.totalFees,
                originalCurrency: 'USD',
                status: 'paid',
                source: 'upwork'
            });
        }
        if (upworkData.totalVat > 0) {
            transactions.push({
                id: 'upwork-vat',
                date: upworkData.importedAt,
                type: 'expense',
                category: 'VAT',
                description: 'Upwork VAT (total)',
                client: 'Upwork',
                amount: upworkData.totalVat * (state.settings.exchangeRate || 18.5),
                currency: 'ZAR',
                originalAmount: upworkData.totalVat,
                originalCurrency: 'USD',
                status: 'paid',
                source: 'upwork'
            });
        }
    }

    // Sort by date descending
    transactions.sort((a, b) => new Date(b.date) - new Date(a.date));
    return transactions;
}

function getFilteredTransactions() {
    let txs = getAllTransactions();

    // Type filter
    if (currentTxFilter === 'income') txs = txs.filter(t => t.type === 'income');
    else if (currentTxFilter === 'expense') txs = txs.filter(t => t.type === 'expense');
    else if (currentTxFilter === 'upwork') txs = txs.filter(t => t.source === 'upwork');

    // Period filter
    const period = document.getElementById('txPeriodFilter')?.value || 'all';
    const now = new Date();
    if (period !== 'all') {
        let cutoff;
        switch (period) {
            case 'thisMonth': cutoff = new Date(now.getFullYear(), now.getMonth(), 1); break;
            case 'lastMonth': cutoff = new Date(now.getFullYear(), now.getMonth() - 1, 1); break;
            case 'thisQuarter': cutoff = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1); break;
            case 'thisYear': cutoff = new Date(now.getFullYear(), 0, 1); break;
            case 'last6': cutoff = new Date(now.getFullYear(), now.getMonth() - 6, 1); break;
        }
        if (cutoff) txs = txs.filter(t => new Date(t.date) >= cutoff);
        if (period === 'lastMonth') {
            const endOfLast = new Date(now.getFullYear(), now.getMonth(), 0);
            txs = txs.filter(t => new Date(t.date) <= endOfLast);
        }
    }

    // Search
    const search = document.getElementById('txSearch')?.value?.toLowerCase() || '';
    if (search) {
        txs = txs.filter(t =>
            t.description.toLowerCase().includes(search) ||
            t.client.toLowerCase().includes(search) ||
            t.category.toLowerCase().includes(search)
        );
    }

    return txs;
}

function renderTransactions() {
    const txs = getFilteredTransactions();
    const allTxs = getAllTransactions();

    const totalIncome = allTxs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const totalExpenses = allTxs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    const netIncome = totalIncome - totalExpenses;
    const filteredTotal = txs.reduce((s, t) => s + (t.type === 'income' ? t.amount : -t.amount), 0);

    document.getElementById('txStats').innerHTML = `
        <div class="stat-card">
            <div class="stat-header"><span class="stat-label">Total Income</span>
                <div class="stat-icon" style="background:rgba(34,197,94,0.1);color:var(--success);"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg></div>
            </div>
            <div class="stat-value" style="font-size:22px;">R ${Math.round(totalIncome).toLocaleString()}</div>
        </div>
        <div class="stat-card">
            <div class="stat-header"><span class="stat-label">Total Expenses</span>
                <div class="stat-icon" style="background:rgba(239,68,68,0.1);color:var(--danger);"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6"></path></svg></div>
            </div>
            <div class="stat-value" style="font-size:22px;">R ${Math.round(totalExpenses).toLocaleString()}</div>
        </div>
        <div class="stat-card">
            <div class="stat-header"><span class="stat-label">Net Income</span>
                <div class="stat-icon"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg></div>
            </div>
            <div class="stat-value" style="font-size:22px;color:${netIncome >= 0 ? 'var(--success)' : 'var(--danger)'};">R ${Math.round(netIncome).toLocaleString()}</div>
        </div>
        <div class="stat-card">
            <div class="stat-header"><span class="stat-label">Transactions</span>
                <div class="stat-icon"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"></path></svg></div>
            </div>
            <div class="stat-value" style="font-size:22px;">${txs.length}</div>
            <div class="stat-change positive">${allTxs.length} total</div>
        </div>
    `;

    document.getElementById('txList').innerHTML = txs.length ? txs.map(tx => `
        <div class="list-item">
            <div class="list-icon ${tx.type === 'income' ? 'income' : 'expense'}">
                ${tx.type === 'income'
                    ? '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>'
                    : '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6"></path></svg>'
                }
            </div>
            <div class="list-info">
                <div class="list-title">${tx.description}</div>
                <div class="list-meta">${formatDate(tx.date)} · ${tx.category}${tx.originalCurrency !== 'ZAR' ? ' · ' + formatCurrency(tx.originalAmount, tx.originalCurrency) : ''}</div>
            </div>
            <span class="list-amount ${tx.type === 'income' ? 'positive' : ''}" style="${tx.type === 'expense' ? 'color:var(--danger);' : ''}">
                ${tx.type === 'expense' ? '-' : '+'}R ${Math.round(tx.amount).toLocaleString()}
            </span>
            <span class="invoice-status ${tx.status}">${tx.status}</span>
        </div>
    `).join('') : '<div class="empty-state"><p>No transactions found for the selected filters.</p></div>';
}

function exportTransactionsCSV() {
    const txs = getFilteredTransactions();
    if (!txs.length) { toast('No transactions to export', 'error'); return; }

    const header = 'Date,Type,Category,Description,Client,Amount (ZAR),Original Amount,Original Currency,Status,Source\n';
    const rows = txs.map(tx =>
        `"${tx.date}","${tx.type}","${tx.category}","${tx.description.replace(/"/g, '""')}","${tx.client}",${tx.type === 'expense' ? '-' : ''}${tx.amount.toFixed(2)},${tx.originalAmount.toFixed(2)},"${tx.originalCurrency}","${tx.status}","${tx.source}"`
    ).join('\n');

    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transactions-export-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Transactions exported', 'success');
}

// ============ ANALYSER ============
function renderAnalyser() {
    const periodMonths = document.getElementById('analyserPeriod')?.value || '12';
    const now = new Date();
    let cutoff = null;
    if (periodMonths !== 'all') {
        cutoff = new Date(now.getFullYear(), now.getMonth() - parseInt(periodMonths), 1);
    }

    const invoices = cutoff
        ? state.invoices.filter(i => new Date(i.date || i.createdAt) >= cutoff)
        : [...state.invoices];

    const allTxs = getAllTransactions().filter(t => !cutoff || new Date(t.date) >= cutoff);

    // === KPIs ===
    const totalRevenue = invoices.reduce((s, i) => s + (i.zarTotal || 0), 0);
    const paidInvoices = invoices.filter(i => i.status === 'paid');
    const totalPaid = paidInvoices.reduce((s, i) => s + (i.zarTotal || 0), 0);
    const avgInvoiceValue = invoices.length ? totalRevenue / invoices.length : 0;

    // Upwork data
    const upworkData = state.upworkData || JSON.parse(localStorage.getItem('oracle_upwork') || 'null');
    const upworkTotal = upworkData ? upworkData.totalGross * (state.settings.exchangeRate || 18.5) : 0;
    const combinedRevenue = totalRevenue + upworkTotal;

    // Monthly average
    const months = periodMonths === 'all' ? 12 : parseInt(periodMonths);
    const monthlyAvg = combinedRevenue / months;

    document.getElementById('analyserKpis').innerHTML = `
        <div class="stat-card">
            <div class="stat-header"><span class="stat-label">Total Revenue</span></div>
            <div class="stat-value" style="font-size:22px;">R ${Math.round(combinedRevenue).toLocaleString()}</div>
            <div class="stat-change positive">${invoices.length} invoices + Upwork</div>
        </div>
        <div class="stat-card">
            <div class="stat-header"><span class="stat-label">Monthly Average</span></div>
            <div class="stat-value" style="font-size:22px;">R ${Math.round(monthlyAvg).toLocaleString()}</div>
            <div class="stat-change positive">per month</div>
        </div>
        <div class="stat-card">
            <div class="stat-header"><span class="stat-label">Avg Invoice Value</span></div>
            <div class="stat-value" style="font-size:22px;">R ${Math.round(avgInvoiceValue).toLocaleString()}</div>
            <div class="stat-change positive">${invoices.length} invoices</div>
        </div>
        <div class="stat-card">
            <div class="stat-header"><span class="stat-label">Collection Rate</span></div>
            <div class="stat-value" style="font-size:22px;">${invoices.length ? Math.round(paidInvoices.length / invoices.length * 100) : 0}%</div>
            <div class="stat-change ${paidInvoices.length / (invoices.length || 1) >= 0.8 ? 'positive' : 'negative'}">${paidInvoices.length} / ${invoices.length} paid</div>
        </div>
    `;

    // === Monthly Revenue Trend (bar chart) ===
    const monthlyData = {};
    for (let m = parseInt(periodMonths === 'all' ? '12' : periodMonths) - 1; m >= 0; m--) {
        const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        monthlyData[key] = { invoice: 0, upwork: 0, label: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }) };
    }

    invoices.forEach(inv => {
        const d = new Date(inv.date || inv.createdAt);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (monthlyData[key]) monthlyData[key].invoice += (inv.zarTotal || 0);
    });

    // Add Upwork earnings to months if available
    if (upworkData?.clientEarnings) {
        const exRate = state.settings.exchangeRate || 18.5;
        Object.values(upworkData.clientEarnings).forEach(info => {
            info.transactions.forEach(tx => {
                if (tx.date) {
                    const d = new Date(tx.date);
                    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                    const amt = (parseFloat(tx.amount) || 0) * exRate;
                    if (monthlyData[key] && amt > 0) monthlyData[key].upwork += amt;
                }
            });
        });
    }

    const monthEntries = Object.values(monthlyData);
    const maxMonthly = Math.max(...monthEntries.map(m => m.invoice + m.upwork), 1);

    document.getElementById('revenueTrend').innerHTML = `
        <div class="chart-bars">
            ${monthEntries.map(m => {
                const total = m.invoice + m.upwork;
                const invPct = (m.invoice / maxMonthly * 100).toFixed(1);
                const upPct = (m.upwork / maxMonthly * 100).toFixed(1);
                return `<div class="chart-bar-col">
                    <div class="chart-bar-stack" style="height:180px;">
                        <div class="chart-bar-segment" style="height:${upPct}%;background:var(--success);opacity:0.5;" title="Upwork: R ${Math.round(m.upwork).toLocaleString()}"></div>
                        <div class="chart-bar-segment" style="height:${invPct}%;background:var(--grey-900);" title="Invoices: R ${Math.round(m.invoice).toLocaleString()}"></div>
                    </div>
                    <div class="chart-bar-label">${m.label}</div>
                    <div class="chart-bar-value">R ${total >= 1000 ? Math.round(total / 1000) + 'k' : Math.round(total)}</div>
                </div>`;
            }).join('')}
        </div>
        <div style="display:flex;gap:16px;justify-content:center;margin-top:12px;font-size:11px;color:var(--grey-500);">
            <span><span style="display:inline-block;width:10px;height:10px;background:var(--grey-900);border-radius:2px;margin-right:4px;"></span>Invoices</span>
            <span><span style="display:inline-block;width:10px;height:10px;background:var(--success);opacity:0.5;border-radius:2px;margin-right:4px;"></span>Upwork</span>
        </div>
    `;

    // === Revenue by Source ===
    const sources = {};
    invoices.forEach(inv => {
        const method = inv.paymentMethod || 'Other';
        const label = method.charAt(0).toUpperCase() + method.slice(1);
        sources[label] = (sources[label] || 0) + (inv.zarTotal || 0);
    });
    if (upworkTotal > 0) sources['Upwork'] = (sources['Upwork'] || 0) + upworkTotal;

    const sortedSources = Object.entries(sources).sort((a, b) => b[1] - a[1]);
    const maxSource = sortedSources[0]?.[1] || 1;
    const sourceColors = { 'Yoco': 'var(--info)', 'Bank': 'var(--grey-700)', 'Wise': 'var(--success)', 'Upwork': '#14A800', 'Paypal': '#003087' };

    document.getElementById('revenueBySource').innerHTML = sortedSources.length ? `
        ${sortedSources.map(([name, amount]) => {
            const pct = (amount / combinedRevenue * 100).toFixed(1);
            const color = sourceColors[name] || 'var(--grey-600)';
            return `<div class="revenue-item">
                <div class="revenue-name" style="min-width:80px;">${name}</div>
                <div class="revenue-bar-wrap"><div class="revenue-bar" style="width:${(amount / maxSource * 100)}%;background:${color};"></div></div>
                <div class="revenue-amount" style="min-width:120px;">R ${Math.round(amount).toLocaleString()} <span style="color:var(--grey-400);font-size:10px;">(${pct}%)</span></div>
            </div>`;
        }).join('')}
    ` : '<div class="empty-state"><p>No revenue data.</p></div>';

    // === Projections ===
    const monthValues = monthEntries.map(m => m.invoice + m.upwork);
    const recentMonths = monthValues.slice(-6);
    const avgRecent = recentMonths.reduce((s, v) => s + v, 0) / recentMonths.length;

    // Growth rate from first half to second half
    const firstHalf = recentMonths.slice(0, 3);
    const secondHalf = recentMonths.slice(-3);
    const firstHalfAvg = firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length || 1;
    const secondHalfAvg = secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length;
    const growthRate = ((secondHalfAvg - firstHalfAvg) / firstHalfAvg);

    // Project next 3 months
    const projections = [];
    let projected = avgRecent;
    for (let i = 1; i <= 6; i++) {
        projected = projected * (1 + growthRate / 3);
        const futureDate = new Date(now.getFullYear(), now.getMonth() + i, 1);
        projections.push({
            month: futureDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
            conservative: projected * 0.8,
            expected: projected,
            optimistic: projected * 1.2
        });
    }

    const annualProjection = avgRecent * 12 * (1 + growthRate);
    const growthPct = (growthRate * 100).toFixed(1);

    document.getElementById('projections').innerHTML = `
        <div class="stats-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:20px;">
            <div class="stat-card" style="border-color:var(--grey-200);">
                <div class="stat-header"><span class="stat-label">Growth Trend</span></div>
                <div class="stat-value" style="font-size:22px;color:${growthRate >= 0 ? 'var(--success)' : 'var(--danger)'};">${growthRate >= 0 ? '+' : ''}${growthPct}%</div>
                <div class="stat-change ${growthRate >= 0 ? 'positive' : 'negative'}">quarter-over-quarter</div>
            </div>
            <div class="stat-card" style="border-color:var(--grey-200);">
                <div class="stat-header"><span class="stat-label">Annual Projection</span></div>
                <div class="stat-value" style="font-size:22px;">R ${Math.round(annualProjection).toLocaleString()}</div>
                <div class="stat-change positive">projected annual</div>
            </div>
            <div class="stat-card" style="border-color:var(--grey-200);">
                <div class="stat-header"><span class="stat-label">Monthly Target</span></div>
                <div class="stat-value" style="font-size:22px;">R ${Math.round(avgRecent).toLocaleString()}</div>
                <div class="stat-change positive">based on recent avg</div>
            </div>
        </div>
        <div class="card" style="border:1px solid var(--grey-200);margin:0;">
            <div class="card-header"><div class="card-title" style="font-size:12px;">6-Month Forecast</div></div>
            <div class="card-body flush">
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;padding:10px 20px;font-size:10px;font-weight:600;color:var(--grey-500);text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid var(--grey-100);">
                    <span>Month</span><span style="text-align:right;">Conservative</span><span style="text-align:right;">Expected</span><span style="text-align:right;">Optimistic</span>
                </div>
                ${projections.map(p => `
                    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;padding:12px 20px;font-size:13px;border-bottom:1px solid var(--grey-100);">
                        <span style="font-weight:500;">${p.month}</span>
                        <span style="text-align:right;font-family:var(--font-mono);color:var(--grey-500);">R ${Math.round(p.conservative).toLocaleString()}</span>
                        <span style="text-align:right;font-family:var(--font-mono);font-weight:600;">R ${Math.round(p.expected).toLocaleString()}</span>
                        <span style="text-align:right;font-family:var(--font-mono);color:var(--success);">R ${Math.round(p.optimistic).toLocaleString()}</span>
                    </div>
                `).join('')}
            </div>
        </div>
    `;

    // === Client Concentration ===
    const clientRevMap = {};
    invoices.forEach(inv => {
        const name = inv.client?.name || 'Unknown';
        clientRevMap[name] = (clientRevMap[name] || 0) + (inv.zarTotal || 0);
    });
    if (upworkData?.clientEarnings) {
        const exRate = state.settings.exchangeRate || 18.5;
        Object.entries(upworkData.clientEarnings).forEach(([team, info]) => {
            const key = 'Upwork: ' + team;
            clientRevMap[key] = (clientRevMap[key] || 0) + (info.total * exRate);
        });
    }

    const sortedClients = Object.entries(clientRevMap).sort((a, b) => b[1] - a[1]);
    const topClient = sortedClients[0];
    const topClientPct = topClient ? (topClient[1] / combinedRevenue * 100).toFixed(1) : 0;
    const top3Pct = sortedClients.slice(0, 3).reduce((s, c) => s + c[1], 0) / (combinedRevenue || 1) * 100;
    const riskLevel = top3Pct > 80 ? 'High' : top3Pct > 60 ? 'Medium' : 'Low';
    const riskColor = top3Pct > 80 ? 'var(--danger)' : top3Pct > 60 ? 'var(--warning)' : 'var(--success)';

    document.getElementById('clientConcentration').innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
            <div style="width:48px;height:48px;border-radius:12px;background:${riskColor};opacity:0.15;display:flex;align-items:center;justify-content:center;">
                <div style="width:24px;height:24px;border-radius:6px;background:${riskColor};"></div>
            </div>
            <div>
                <div style="font-size:14px;font-weight:600;">Concentration Risk: <span style="color:${riskColor};">${riskLevel}</span></div>
                <div style="font-size:12px;color:var(--grey-500);">Top 3 clients = ${top3Pct.toFixed(0)}% of revenue</div>
            </div>
        </div>
        ${sortedClients.slice(0, 5).map(([name, amount], i) => {
            const pct = (amount / (combinedRevenue || 1) * 100).toFixed(1);
            return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                <span style="font-size:11px;font-weight:600;color:var(--grey-400);min-width:18px;">#${i + 1}</span>
                <span style="flex:1;font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${name}</span>
                <span style="font-family:var(--font-mono);font-size:12px;font-weight:600;">R ${Math.round(amount).toLocaleString()}</span>
                <span style="font-size:11px;color:var(--grey-500);min-width:40px;text-align:right;">${pct}%</span>
            </div>`;
        }).join('')}
    `;

    // === Payment Health ===
    const pending = state.invoices.filter(i => i.status === 'pending');
    const overdue = pending.filter(i => {
        const d = new Date(i.date);
        const terms = parseInt(i.paymentTerms) || 14;
        const due = new Date(d.getTime() + terms * 86400000);
        return now > due;
    });
    const avgDaysToPayArr = paidInvoices.filter(i => i.paidAt && i.date).map(i => {
        return (new Date(i.paidAt) - new Date(i.date)) / 86400000;
    });
    const avgDaysToPay = avgDaysToPayArr.length ? (avgDaysToPayArr.reduce((s, d) => s + d, 0) / avgDaysToPayArr.length) : 0;

    document.getElementById('paymentHealth').innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
            <div style="background:var(--grey-50);padding:16px;border-radius:8px;text-align:center;">
                <div style="font-size:24px;font-weight:700;color:var(--grey-900);font-family:var(--font-mono);">${Math.round(avgDaysToPay)}</div>
                <div style="font-size:11px;color:var(--grey-500);margin-top:4px;">Avg Days to Pay</div>
            </div>
            <div style="background:${overdue.length ? 'rgba(239,68,68,0.05)' : 'rgba(34,197,94,0.05)'};padding:16px;border-radius:8px;text-align:center;">
                <div style="font-size:24px;font-weight:700;color:${overdue.length ? 'var(--danger)' : 'var(--success)'};font-family:var(--font-mono);">${overdue.length}</div>
                <div style="font-size:11px;color:var(--grey-500);margin-top:4px;">Overdue Invoices</div>
            </div>
        </div>
        <div style="margin-top:8px;">
            <div style="font-size:12px;font-weight:500;color:var(--grey-700);margin-bottom:8px;">Outstanding Breakdown</div>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                <span style="font-size:12px;color:var(--grey-500);min-width:60px;">Pending</span>
                <div style="flex:1;height:6px;background:var(--grey-100);border-radius:3px;overflow:hidden;">
                    <div style="height:100%;background:var(--warning);border-radius:3px;width:${pending.length ? 100 : 0}%;"></div>
                </div>
                <span style="font-family:var(--font-mono);font-size:12px;font-weight:600;">${pending.length}</span>
            </div>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                <span style="font-size:12px;color:var(--grey-500);min-width:60px;">Overdue</span>
                <div style="flex:1;height:6px;background:var(--grey-100);border-radius:3px;overflow:hidden;">
                    <div style="height:100%;background:var(--danger);border-radius:3px;width:${pending.length ? (overdue.length / pending.length * 100) : 0}%;"></div>
                </div>
                <span style="font-family:var(--font-mono);font-size:12px;font-weight:600;">${overdue.length}</span>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
                <span style="font-size:12px;color:var(--grey-500);min-width:60px;">Paid</span>
                <div style="flex:1;height:6px;background:var(--grey-100);border-radius:3px;overflow:hidden;">
                    <div style="height:100%;background:var(--success);border-radius:3px;width:${state.invoices.length ? (paidInvoices.length / state.invoices.length * 100) : 0}%;"></div>
                </div>
                <span style="font-family:var(--font-mono);font-size:12px;font-weight:600;">${paidInvoices.length}</span>
            </div>
        </div>
        ${overdue.length ? `
            <div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--grey-100);">
                <div style="font-size:11px;font-weight:600;color:var(--danger);margin-bottom:6px;">OVERDUE</div>
                ${overdue.slice(0, 3).map(inv => `
                    <div style="font-size:12px;color:var(--grey-700);margin-bottom:4px;">${inv.invoiceNumber} — ${inv.client?.name} · R ${Math.round(inv.zarTotal).toLocaleString()}</div>
                `).join('')}
            </div>
        ` : ''}
    `;

    // === Invoice Velocity ===
    const monthlyInvCounts = {};
    invoices.forEach(inv => {
        const d = new Date(inv.date || inv.createdAt);
        const key = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
        monthlyInvCounts[key] = (monthlyInvCounts[key] || 0) + 1;
    });
    const velEntries = Object.entries(monthlyInvCounts).slice(-8);
    const maxVel = Math.max(...velEntries.map(e => e[1]), 1);

    document.getElementById('invoiceVelocity').innerHTML = `
        <div style="display:flex;align-items:flex-end;gap:8px;height:120px;margin-bottom:12px;">
            ${velEntries.map(([month, count]) => `
                <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;">
                    <span style="font-family:var(--font-mono);font-size:11px;font-weight:600;">${count}</span>
                    <div style="width:100%;background:var(--grey-900);border-radius:4px 4px 0 0;height:${(count / maxVel * 80) + 10}px;min-height:4px;transition:height 0.3s;"></div>
                    <span style="font-size:10px;color:var(--grey-500);white-space:nowrap;">${month}</span>
                </div>
            `).join('')}
        </div>
        <div style="border-top:1px solid var(--grey-100);padding-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div>
                <div style="font-size:11px;color:var(--grey-500);">Avg Invoices/Month</div>
                <div style="font-family:var(--font-mono);font-size:16px;font-weight:600;margin-top:4px;">${(invoices.length / months).toFixed(1)}</div>
            </div>
            <div>
                <div style="font-size:11px;color:var(--grey-500);">This Month</div>
                <div style="font-family:var(--font-mono);font-size:16px;font-weight:600;margin-top:4px;">${invoices.filter(i => {
                    const d = new Date(i.date || i.createdAt);
                    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
                }).length}</div>
            </div>
        </div>
    `;

    // === Key Insights ===
    const insights = [];

    // Growth insight
    if (growthRate > 0.1) insights.push({ type: 'positive', icon: '📈', text: `Revenue growing at ${growthPct}% quarter-over-quarter` });
    else if (growthRate < -0.1) insights.push({ type: 'negative', icon: '📉', text: `Revenue declining at ${growthPct}% — consider diversifying` });
    else insights.push({ type: 'neutral', icon: '➡️', text: 'Revenue is stable with minimal growth' });

    // Client concentration
    if (top3Pct > 80) insights.push({ type: 'negative', icon: '⚠️', text: `High client concentration: top 3 = ${top3Pct.toFixed(0)}%. Diversify revenue sources.` });
    else if (top3Pct > 60) insights.push({ type: 'neutral', icon: '📊', text: `Moderate concentration: top 3 = ${top3Pct.toFixed(0)}% of revenue` });
    else insights.push({ type: 'positive', icon: '✅', text: `Well-diversified client base (top 3 = ${top3Pct.toFixed(0)}%)` });

    // Payment health
    if (overdue.length > 0) {
        const overdueTotal = overdue.reduce((s, i) => s + (i.zarTotal || 0), 0);
        insights.push({ type: 'negative', icon: '🔴', text: `${overdue.length} overdue invoices (R ${Math.round(overdueTotal).toLocaleString()}) — follow up` });
    }
    if (avgDaysToPay > 21) insights.push({ type: 'negative', icon: '⏰', text: `Average payment takes ${Math.round(avgDaysToPay)} days — consider tighter terms` });
    else if (avgDaysToPay > 0 && avgDaysToPay <= 7) insights.push({ type: 'positive', icon: '⚡', text: `Fast payment cycle: avg ${Math.round(avgDaysToPay)} days` });

    // Upwork vs Direct
    if (upworkTotal > 0 && totalRevenue > 0) {
        const directPct = (totalRevenue / combinedRevenue * 100).toFixed(0);
        const upworkPct = (upworkTotal / combinedRevenue * 100).toFixed(0);
        insights.push({ type: 'neutral', icon: '💼', text: `Revenue mix: ${directPct}% direct invoices / ${upworkPct}% Upwork` });
    }

    // Annual projection
    insights.push({ type: 'positive', icon: '🎯', text: `Annual projection: R ${Math.round(annualProjection).toLocaleString()} at current rate` });

    const insightColors = { positive: 'var(--success)', negative: 'var(--danger)', neutral: 'var(--grey-600)' };
    const insightBgs = { positive: 'rgba(34,197,94,0.05)', negative: 'rgba(239,68,68,0.05)', neutral: 'var(--grey-50)' };

    document.getElementById('keyInsights').innerHTML = insights.map(ins => `
        <div style="display:flex;align-items:flex-start;gap:10px;padding:10px;background:${insightBgs[ins.type]};border-radius:8px;margin-bottom:8px;">
            <span style="font-size:16px;flex-shrink:0;">${ins.icon}</span>
            <span style="font-size:13px;color:${insightColors[ins.type]};line-height:1.4;">${ins.text}</span>
        </div>
    `).join('');
}

// ============ INIT ============
function init() {
    loadState();
    loadSettings();
    checkPaymentCallback();
    // Load Upwork data if exists
    const upworkRaw = localStorage.getItem('oracle_upwork');
    if (upworkRaw) {
        try { state.upworkData = JSON.parse(upworkRaw); } catch {}
    }
    // Load last sync time
    lastSyncTime = localStorage.getItem('oracle_last_sync') || null;

    // Initialize Supabase (auth, sync)
    initSupabase();

    // Inject sync buttons into all page headers
    injectSyncButtons();
    updateUserUI();

    renderDashboard();
}

init();
