// ==========================================
// SPLASH APP - CENTRAL CONFIGURATION (BRAIN)
// ==========================================

const Splash = {
    // --- Core Settings ---
    welcomeBonus: 1750,
    minDeposit: 14500,
    minWithdrawal: 5500,
    withdrawFeePercent: 4,
    withdrawTimesPerDay: 3,
    withdrawStartHour: 17,
    withdrawEndHour: 23,
    downloadAppReward: 650,
    
    referralRates: { level1: 27, level2: 5, level3: 1 },
    dailyIncomePercent: 13,

    // ============================================================
    //  SYSTEM STATUS (Reads admin toggles)
    // ============================================================
    getStatus: function () {
        try {
            const s = JSON.parse(localStorage.getItem('splash_system_status')) || {};
            return { maintenance: !!s.maintenance, deposits: s.deposits !== false, withdrawals: s.withdrawals !== false };
        } catch (e) { return { maintenance: false, deposits: true, withdrawals: true }; }
    },

    depositsOpen: function () {
        const st = this.getStatus();
        return { ok: st.deposits && !st.maintenance, message: st.deposits ? '' : 'Deposits are paused.' };
    },

    // ============================================================
    //  USER LOOKUP & AUTH
    // ============================================================
    getUser: function (phone) {
        try {
            const users = JSON.parse(localStorage.getItem('splash_users')) || [];
            const u = users.find(x => String(x.phone) === String(phone));
            if (u) {
                if (u.totalIncome === undefined) u.totalIncome = 0;
                if (!u.transactions) u.transactions = [];
            }
            return u || null;
        } catch (e) { return null; }
    },

    requireUser: function () {
        const phone = localStorage.getItem('splash_current_user');
        if (!phone) { window.location.href = 'index.html'; return null; }
        const user = this.getUser(phone);
        if (!user || user.blocked) {
            try { localStorage.removeItem('splash_current_user'); } catch (e) {}
            window.location.href = 'index.html';
            return null;
        }
        return user;
    },

    _saveUsers: function (users) {
        try { localStorage.setItem('splash_users', JSON.stringify(users)); return true; }
        catch (e) { return false; }
    },

    // ============================================================
    //  TRANSACTIONS
    // ============================================================
    _logTx: function (type, phone, amount, note) {
        try {
            const tx = JSON.parse(localStorage.getItem('splash_admin_tx')) || [];
            tx.unshift({ id: 'T' + Date.now() + Math.floor(Math.random() * 99), type, phone: String(phone), amount: Number(amount) || 0, note: note || '', ts: Date.now() });
            localStorage.setItem('splash_admin_tx', JSON.stringify(tx.slice(0, 500)));
        } catch (e) {}
    },

    logUserTx: function (phone, tx) {
        try {
            const users = JSON.parse(localStorage.getItem('splash_users')) || [];
            const idx = users.findIndex(u => String(u.phone) === String(phone));
            if (idx === -1) return;
            if (!users[idx].transactions) users[idx].transactions = [];
            const now = new Date();
            users[idx].transactions.unshift({
                type: tx.type || 'income',
                title: tx.title || 'Transaction',
                amount: Number(tx.amount) || 0,
                status: tx.status || 'Completed',
                date: now.toISOString().split('T')[0],
                time: now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }),
                ts: Date.now()
            });
            users[idx].transactions = users[idx].transactions.slice(0, 100);
            localStorage.setItem('splash_users', JSON.stringify(users));
        } catch (e) {}
    },

    // ============================================================
    //  VIP & INCOME
    // ============================================================
    buyPlan: function (phone, plan) {
        try {
            const users = JSON.parse(localStorage.getItem('splash_users')) || [];
            const idx = users.findIndex(u => String(u.phone) === String(phone));
            if (idx === -1) return { ok: false, message: 'User not found.' };

            const user = users[idx];
            user.balance = Number(user.balance) || 0;
            user.totalIncome = Number(user.totalIncome) || 0;

            if (user.balance < plan.price) return { insufficient: true };
            user.balance -= plan.price;

            if (!user.orders) user.orders = [];
            user.orders.push({
                planId: plan.id, name: plan.name,
                price: Number(plan.price), daily: Number(plan.daily),
                days: Number(plan.days), left: Number(plan.days),
                status: 'active',
                date: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
                createdAt: Date.now(), lastPayout: Date.now(), earned: 0
            });

            if (!user.vipLevel || Number(user.vipLevel) < plan.id) user.vipLevel = plan.id;

            users[idx] = user;
            this._saveUsers(users);
            this._logTx('buy', phone, plan.price, 'Purchased ' + plan.name);
            this.logUserTx(phone, { type: 'purchase', title: plan.name + ' Purchase', amount: plan.price, status: 'Completed' });

            return { ok: true };
        } catch (e) { return { ok: false, message: 'Purchase failed: ' + e.message }; }
    },

    settleOrders: function (phone) {
        try {
            const users = JSON.parse(localStorage.getItem('splash_users')) || [];
            const idx = users.findIndex(u => String(u.phone) === String(phone));
            if (idx === -1) return 0;
            const user = users[idx];
            if (!user.orders || !user.orders.length) return 0;

            const now = Date.now();
            let paid = 0, changed = false;
            user.totalIncome = Number(user.totalIncome) || 0;

            // Helper: Get the exact timestamp for 00:00:00 of a given date
            const getMidnight = (ts) => {
                const d = new Date(ts);
                d.setHours(0, 0, 0, 0);
                return d.getTime();
            };

            user.orders.forEach(o => {
                if (o.status !== 'active') return;
                if (o.left === undefined) o.left = o.days || 30;
                if (!o.lastPayout) o.lastPayout = o.createdAt || now;
                if (o.earned === undefined) o.earned = 0;

                // Compare the midnight of the last payout vs midnight of today
                const lastMidnight = getMidnight(o.lastPayout);
                const currentMidnight = getMidnight(now);
                const daysPassed = Math.floor((currentMidnight - lastMidnight) / 86400000);

                if (daysPassed > 0 && o.left > 0) {
                    // Calculate how many days to pay (safety cap: don't pay more than days left)
                    const daysToPay = Math.min(daysPassed, o.left);
                    const daily = Number(o.daily) || 0;
                    const amountToPay = daysToPay * daily;

                    user.balance = (Number(user.balance) || 0) + amountToPay;
                    user.totalIncome += amountToPay;
                    o.earned += amountToPay;
                    o.left -= daysToPay;
                    o.lastPayout = currentMidnight; // Advance lastPayout to the new midnight
                    paid += amountToPay;
                    changed = true;
                }
                if (o.left <= 0) o.status = 'done';
            });

            if (changed) {
                users[idx] = user;
                this._saveUsers(users);
                this._logTx('add', phone, paid, 'Daily income payout');
                this.logUserTx(phone, { 
                    type: 'income', 
                    title: 'Daily Income Payout', 
                    amount: paid, 
                    status: 'Completed' 
                });
            }
            return paid;
        } catch (e) { console.warn('settleOrders failed', e); return 0; }
    },

    // ============================================================
    //  HELPERS & WITHDRAWALS
    // ============================================================
    formatMoney: function (amount) {
        return 'UGX ' + Number(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    },
    calculateDailyIncome: function (amount) { return (Number(amount) * this.dailyIncomePercent) / 100; },
    calculateCommission: function (amount, level) { const rate = this.referralRates['level' + level] || 0; return (Number(amount) * rate) / 100; },
    calculateWithdrawalFee: function (amount) { return (Number(amount) * this.withdrawFeePercent) / 100; },
    calculateNetWithdrawal: function (amount) { return Number(amount) - this.calculateWithdrawalFee(amount); },

    canWithdrawNow: function () {
        const h = new Date().getHours();
        if (h >= this.withdrawStartHour && h < this.withdrawEndHour) return { ok: true };
        return { ok: false, message: 'Withdrawals are only available between 5:00 PM and 11:00 PM. Please come back later.' };
    },
    getRemainingWithdrawals: function () {
        const today = new Date().toDateString();
        if (localStorage.getItem('splash_wd_date') !== today) {
            localStorage.setItem('splash_wd_date', today);
            localStorage.setItem('splash_wd_count', '0');
            return this.withdrawTimesPerDay;
        }
        return Math.max(0, this.withdrawTimesPerDay - parseInt(localStorage.getItem('splash_wd_count') || '0', 10));
    },
    recordWithdrawal: function () {
        const c = parseInt(localStorage.getItem('splash_wd_count') || '0', 10);
        localStorage.setItem('splash_wd_count', (c + 1).toString());
    }
};

// --- Auto-Sync Admin Config on load ---
document.addEventListener('DOMContentLoaded', () => {
    try {
        const cfg = JSON.parse(localStorage.getItem('splash_admin_config'));
        if (cfg) {
            if (cfg.bonus !== undefined) Splash.welcomeBonus = cfg.bonus;
            if (cfg.minDeposit !== undefined) Splash.minDeposit = cfg.minDeposit;
            if (cfg.minWithdraw !== undefined) Splash.minWithdrawal = cfg.minWithdraw;
        }
    } catch (e) {}
});

// ==========================================
// TREASURE CHEST SYSTEM (Global)
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.innerHTML = `
        #chestModal { position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 9999; display: flex; align-items: center; justify-content: center; opacity: 0; pointer-events: none; transition: opacity 0.3s; padding: 20px; backdrop-filter: blur(4px); }
        #chestModal.show { opacity: 1; pointer-events: auto; }
        .chest-box { background: #fff; border-radius: 24px; padding: 24px; width: 100%; max-width: 320px; text-align: center; transform: translateY(20px) scale(0.9); transition: transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1); }
        #chestModal.show .chest-box { transform: translateY(0) scale(1); }
        .chest-box img { width: 100px; margin: 0 auto 15px; display: block; animation: chestFloat 2s ease-in-out infinite; }
        .chest-box h3 { color: #cc5a00; font-size: 22px; margin-bottom: 8px; font-weight: 800; transition: color 0.3s; }
        .chest-box p { color: #666; font-size: 14px; margin-bottom: 20px; line-height: 1.5; }
        .chest-btn { width: 100%; background: linear-gradient(180deg, #ffa74f, #f37b1d); color: #fff; border: none; border-radius: 30px; padding: 14px; font-size: 16px; font-weight: 800; cursor: pointer; box-shadow: 0 4px 12px rgba(243,123,29,0.4); transition: transform 0.1s, background 0.3s; }
        .chest-btn:active { transform: scale(0.97); }
        .chest-btn.locked { background: #ccc; box-shadow: none; cursor: not-allowed; color: #777; }
        @keyframes chestFloat { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
    `;
    document.head.appendChild(style);

    const modalHtml = `
        <div id="chestModal">
            <div class="chest-box">
                <img src="chest.png" alt="Chest" onerror="this.src='https://cdn3d.iconscout.com/3d/premium/thumb/treasure-chest-4248829-3529633.png'">
                <h3 id="chestTitle">Treasure Chest</h3>
                <p id="chestMsg">Make a deposit to unlock this chest!</p>
                <button class="chest-btn locked" id="chestBtn">Go to Deposit</button>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    const bindChests = () => {
        document.querySelectorAll('.float-gift, #chest').forEach(el => {
            el.removeEventListener('click', openChest);
            el.addEventListener('click', openChest);
        });
    };
    bindChests();
    setTimeout(bindChests, 1000);

    document.getElementById('chestModal').addEventListener('click', function(e) {
        if (e.target === this) this.classList.remove('show');
    });
});

function openChest() {
    const phone = localStorage.getItem('splash_current_user');
    if (!phone) return;

    const users = JSON.parse(localStorage.getItem('splash_users')) || [];
    const user = users.find(u => String(u.phone) === String(phone));
    if (!user) return;

    const modal = document.getElementById('chestModal');
    const title = document.getElementById('chestTitle');
    const msg = document.getElementById('chestMsg');
    const btn = document.getElementById('chestBtn');

    title.style.color = '#cc5a00';
    msg.style.color = '#666';

    if (user.hasUnopenedChest) {
        const cfg = JSON.parse(localStorage.getItem('splash_admin_config')) || { chestReward: 500 };
        const reward = Number(cfg.chestReward) || 500;

        title.textContent = "Congratulations!";
        msg.innerHTML = `You have a treasure chest waiting!<br>Open it to claim <b>UGX ${reward.toLocaleString()}</b>.`;
        
        btn.className = 'chest-btn';
        btn.textContent = 'Open Box 📦';
        btn.style.background = '';
        
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        
        newBtn.onclick = () => {
            user.balance = (Number(user.balance) || 0) + reward;
            user.hasUnopenedChest = false;
            
            if (!user.transactions) user.transactions = [];
            user.transactions.unshift({
                type: 'gift',
                title: 'Treasure Chest Reward',
                amount: reward,
                status: 'Completed',
                date: new Date().toISOString().split('T')[0],
                time: new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }),
                ts: Date.now()
            });
            
            const updatedUsers = JSON.parse(localStorage.getItem('splash_users')).map(u => String(u.phone) === String(phone) ? user : u);
            localStorage.setItem('splash_users', JSON.stringify(updatedUsers));

            try {
                const adminTx = JSON.parse(localStorage.getItem('splash_admin_tx')) || [];
                adminTx.unshift({
                    id: 'T' + Date.now(),
                    type: 'gift',
                    phone: String(phone),
                    amount: reward,
                    note: 'Treasure Chest Opened',
                    ts: Date.now()
                });
                localStorage.setItem('splash_admin_tx', JSON.stringify(adminTx.slice(0, 500)));
            } catch (e) {}

            title.textContent = "🎉 Congratulations!";
            title.style.color = "#1fa84f";
            msg.innerHTML = `You received <b>UGX ${reward.toLocaleString()}</b>!<br><br>Tap the floating <b>APP</b> icon to download the app and claim more bonuses.`;
            
            const closeBtn = newBtn.cloneNode(true);
            newBtn.parentNode.replaceChild(closeBtn, newBtn);
            closeBtn.textContent = 'Awesome!';
            closeBtn.style.background = '#1fa84f';
            closeBtn.onclick = () => modal.classList.remove('show');
        };
    } else {
        title.textContent = "Chest is Locked";
        msg.textContent = "Make a deposit to unlock your treasure chest!";
        
        btn.className = 'chest-btn locked';
        btn.textContent = 'Go to Deposit';
        btn.style.background = '';
        
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        newBtn.onclick = () => { window.location.href = 'deposit.html'; };
    }

    modal.classList.add('show');
}

window.Splash = Splash;