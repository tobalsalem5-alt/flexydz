let token = localStorage.getItem('customer_token');
let serverUrl = localStorage.getItem('customer_server_url') || 'https://tobalflexy-app-dz.loca.lt';

// Elements
const loginScreen = document.getElementById('login-screen');
const dashboardScreen = document.getElementById('dashboard-screen');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const flexyForm = document.getElementById('flexy-form');
const flexyResult = document.getElementById('flexy-result');
const operatorOptions = document.querySelectorAll('.operator-option');

let selectedOperator = '';

// Check Login on Start
if (token) {
    showDashboard();
    fetchProfile();
}

function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = "toast show";
    setTimeout(() => { toast.className = toast.className.replace("show", ""); }, 3000);
}

// Login
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const srv = document.getElementById('server-url').value.trim();
    
    if (srv) {
        serverUrl = srv.replace(/\/$/, "");
        localStorage.setItem('customer_server_url', serverUrl);
    }

    const btn = document.getElementById('btn-login');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الدخول...';
    btn.disabled = true;

    try {
        const res = await fetch(`${serverUrl}/api/customer/login`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Bypass-Tunnel-Reminder': 'true'
            },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        
        if (data.success) {
            token = data.token;
            localStorage.setItem('customer_token', token);
            loginError.textContent = '';
            showDashboard();
            updateUI(data.user);
        } else {
            loginError.textContent = data.message;
        }
    } catch (err) {
        loginError.textContent = 'فشل الاتصال بالسيرفر. تأكد من رابط السيرفر واتصالك بالإنترنت.';
    }

    btn.innerHTML = 'تسجيل الدخول <i class="fas fa-sign-in-alt"></i>';
    btn.disabled = false;
});

function showDashboard() {
    loginScreen.classList.remove('active');
    dashboardScreen.classList.add('active');
}

function logout() {
    localStorage.removeItem('customer_token');
    token = null;
    dashboardScreen.classList.remove('active');
    loginScreen.classList.add('active');
    document.getElementById('password').value = '';
}

async function fetchProfile() {
    try {
        const res = await fetch(`${serverUrl}/api/customer/profile`, {
            headers: { 
                'Authorization': token,
                'Bypass-Tunnel-Reminder': 'true'
            }
        });
        const data = await res.json();
        if (data.success) {
            updateUI(data.user);
        } else {
            logout(); // token invalid
        }
    } catch (e) {
        showToast('تعذر تحديث الرصيد. تحقق من الاتصال.');
    }
}

function updateUI(user) {
    document.getElementById('user-name-display').textContent = user.name;
    document.getElementById('user-balance').textContent = user.balance.toLocaleString('en-US');
}

// Operator Selection
operatorOptions.forEach(opt => {
    opt.addEventListener('click', () => {
        operatorOptions.forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        selectedOperator = opt.dataset.op;
    });
});

// Auto Select Operator based on Phone Prefix
document.getElementById('flexy-phone').addEventListener('input', (e) => {
    const val = e.target.value;
    if (val.length >= 2) {
        let op = '';
        if (val.startsWith('05')) op = 'ooredoo';
        else if (val.startsWith('06')) op = 'mobilis';
        else if (val.startsWith('07')) op = 'djezzy';

        if (op) {
            operatorOptions.forEach(o => o.classList.remove('selected'));
            document.querySelector(`.operator-option[data-op="${op}"]`).classList.add('selected');
            selectedOperator = op;
        }
    }
});

// Preset Amounts
document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.getElementById('flexy-amount').value = e.target.dataset.val;
    });
});

// Send Flexy
flexyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!selectedOperator) {
        alert('الرجاء اختيار المتعامل أولاً');
        return;
    }

    const phone = document.getElementById('flexy-phone').value;
    const amount = document.getElementById('flexy-amount').value;
    
    if (phone.length !== 10) {
        alert('رقم الهاتف يجب أن يتكون من 10 أرقام');
        return;
    }

    const btn = document.getElementById('btn-send-flexy');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الإرسال...';
    btn.disabled = true;
    flexyResult.className = 'result-message'; // clear previous

    try {
        const res = await fetch(`${serverUrl}/api/customer/flexy`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': token,
                'Bypass-Tunnel-Reminder': 'true'
            },
            body: JSON.stringify({ phone, amount })
        });
        const data = await res.json();
        
        if (data.success) {
            flexyResult.textContent = data.message;
            flexyResult.classList.add('success');
            document.getElementById('flexy-phone').value = '';
            document.getElementById('flexy-amount').value = '';
            fetchProfile(); // update balance
        } else {
            flexyResult.textContent = data.message || 'حدث خطأ غير معروف';
            flexyResult.classList.add('error');
        }
    } catch (err) {
        flexyResult.textContent = 'خطأ في الاتصال بالسيرفر';
        flexyResult.classList.add('error');
    }

    btn.innerHTML = 'إرسال الآن <i class="fas fa-paper-plane"></i>';
    btn.disabled = false;
});
