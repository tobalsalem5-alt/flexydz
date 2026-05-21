
let ipcRenderer = null;
try {
    ipcRenderer = require('electron').ipcRenderer;
} catch (e) {
    console.warn('Running in Web Browser mode (No Electron IPC). Falling back to HTTP APIs.');
    // Mock ipcRenderer.on to prevent crashes in web mode
    ipcRenderer = {
        on: (channel, callback) => {
            console.log('Registered mock listener for:', channel);
        }
    };
}

async function apiCall(channel, data) {
    if (ipcRenderer && typeof ipcRenderer.invoke === 'function') {
        return await ipcRenderer.invoke(channel, data);
    } else {
        const token = localStorage.getItem('admin_token') || 'SUPERM123';
        
        let serverUrl = localStorage.getItem('remote_server_url');
        if (!serverUrl) {
            serverUrl = prompt("الرجاء إدخال رابط السيرفر الخاص بك (مثال: http://192.168.1.5:3005 أو رابط ngrok):", "http://localhost:3005");
            if (serverUrl) {
                serverUrl = serverUrl.replace(/\/$/, "");
                localStorage.setItem('remote_server_url', serverUrl);
            } else {
                serverUrl = "http://localhost:3005";
            }
        }

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 seconds timeout
            
            const res = await fetch(`${serverUrl}/api/ipc/${channel}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': token },
                body: JSON.stringify({ data }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            
            if (!res.ok) {
                console.error('API request failed:', res.statusText);
                return { success: false, message: 'فشل الاتصال: ' + res.statusText };
            }
            return await res.json();
        } catch (e) {
            console.error('Network Error in apiCall:', e);
            return { success: false, message: 'خطأ في الشبكة أو السيرفر لا يستجيب' };
        }
    }
}

// Polling mechanism to keep data fresh in Web Mode (since no WebSockets)
if (typeof require === 'undefined') {
    setInterval(() => {
        if (document.getElementById('sim-cards-tab').classList.contains('active')) {
            if(typeof loadSims === 'function') loadSims();
        }
    }, 10000);
}


// --- Tab Switching Logic ---
const tabs = document.querySelectorAll('.nav-link');
const contents = document.querySelectorAll('.tab-content');

tabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
        e.preventDefault();
        tabs.forEach(t => t.classList.remove('active'));
        contents.forEach(c => c.style.display = 'none');
        
        tab.classList.add('active');
        const target = tab.getAttribute('data-target');
        document.getElementById(target).style.display = 'block';

        if(target === 'dashboard-tab') loadLogs();
        if(target === 'sims-tab') loadSims();
        if(target === 'idoom-tab') loadCards();
        if(target === 'sim-offers-tab') loadSimOffers();
        if(target === 'settings-tab') loadSettings();
        if(target === 'meetmob-tab') loadMeetmobSettings();
        if(target === 'bot-manager-tab') { loadSettings(); loadLogs(); }
        if(target === 'agents-tab') loadAgents();
        if(target === 'journal-agents-tab') loadAgentJournal();
        if(target === 'journal-server-tab') { loadServerJournal(); updateSimFilterDropdown(); }
        if(target === 'modem-ip-control-tab') switchIpControlSubView('home');
    });
});

// --- Modal Logic ---
function showModal(id) {
    document.getElementById(id).classList.add('active');
}

function hideModal(id) {
    document.getElementById(id).classList.remove('active');
}

// --- Data Loading ---
async function loadLogs() {
    try {
        const logs = await apiCall('get-logs');
        const tbody = document.getElementById('logsList');
        if (!tbody) return;
        tbody.innerHTML = '';
        logs.forEach(log => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${log.user_name}</td>
                <td><code>${log.message}</code></td>
                <td>${new Date(log.timestamp).toLocaleString()}</td>
            `;
            tbody.appendChild(tr);
        });
        
        // Also populate live monitor if empty
        const liveMonitor = document.getElementById('liveBotLogs');
        if (liveMonitor && liveMonitor.children.length === 0) {
            logs.slice(0, 10).reverse().forEach(log => appendToLiveLog(log));
        }
    } catch (e) {
        console.error(e);
    }
}

async function loadAgents() {
    try {
        const agents = await apiCall('get-agents');
        const tbody = document.getElementById('agentsList');
        if (!tbody) return;
        tbody.innerHTML = '';
        agents.forEach(agent => {
            const tr = document.createElement('tr');
            const safeName = agent.name ? agent.name.replace(/'/g, "\\'") : '';
            const safePhone = agent.phone_number || '';
            const safeTelegramId = agent.telegram_id || '';
            const tier = agent.tier || 'detaillant';
            const tierLabels = { admin: '🔴 Admin', super_grossiste: '🟠 Super Grossiste', grossiste: '🟡 Grossiste', detaillant: '🟢 Détaillant' };
            const tierLabel = tierLabels[tier] || tier;
            
            const statusBadge = agent.status === 'suspended' ? '<span class="badge danger" style="font-size:10px;">موقوف</span>' : '';
            tr.innerHTML = `
                <td>${agent.id}</td>
                <td>${agent.name || ''} ${statusBadge}</td>
                <td>${agent.telegram_id || ''}</td>
                <td>${agent.phone_number || '---'}</td>
                <td><span style="font-size:11px; padding:3px 8px; border-radius:12px; background:rgba(99,102,241,0.15); color:#818cf8;">${tierLabel}</span></td>
                <td>${agent.balance || 0} دج</td>
                <td>
                    <button class="btn success small" onclick="openBalanceModal(${agent.id}, '${safeName}', 'add')"><i class="fas fa-plus"></i> شحن</button>
                    <button class="btn danger small" onclick="openBalanceModal(${agent.id}, '${safeName}', 'remove')"><i class="fas fa-minus"></i> سحب</button>
                </td>
                <td>
                    <button class="btn primary small" onclick="openSendMessageModal('${safeTelegramId}', '${safeName}')"><i class="fab fa-telegram-plane"></i> مراسلة</button>
                </td>
                <td>
                    <button class="btn secondary small" onclick="openAgentOptionsModal({ id: ${agent.id}, status: '${agent.status || 'active'}', role: '${agent.role || 'user'}', tier: '${tier}', disabled_services: '${agent.disabled_services || ''}' })" title="خيارات متقدمة"><i class="fas fa-cogs"></i></button>
                    <button class="btn primary small" onclick="openAgentModal('edit', { id: ${agent.id}, name: '${safeName}', telegram_id: '${safeTelegramId}', phone_number: '${safePhone}', tier: '${tier}' })"><i class="fas fa-edit"></i> تعديل</button>
                    <button class="btn danger small" onclick="deleteAgent(${agent.id}, '${safeName}')"><i class="fas fa-trash"></i> حذف</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) {
        console.error(e);
    }
}

window.openBalanceModal = openBalanceModal;
window.executeBalanceOperation = executeBalanceOperation;

function openBalanceModal(id, name, type) {
    document.getElementById('balanceAgentId').value = id;
    document.getElementById('balanceAgentName').value = name;
    document.getElementById('balanceOperationType').value = type;
    document.getElementById('balanceModalTitle').innerText = type === 'add' ? 'إضافة رصيد للوكيل' : 'سحب رصيد من الوكيل';
    showModal('agentBalanceModal');
}

async function executeBalanceOperation() {
    const id = document.getElementById('balanceAgentId').value;
    const amount = parseFloat(document.getElementById('balanceAmount').value);
    const type = document.getElementById('balanceOperationType').value;
    
    if (isNaN(amount) || amount <= 0) {
        alert('يرجى إدخال مبلغ صحيح.');
        return;
    }
    
    try {
        const result = await apiCall('update-agent-balance', { id, amount, type });
        if (result.success) {
            hideModal('agentBalanceModal');
            loadAgents(); // Reload
            alert('تمت العملية بنجاح.');
        } else {
            alert('فشلت العملية: ' + result.message);
        }
    } catch (e) {
        console.error(e);
        alert('حدث خطأ أثناء تنفيذ العملية.');
    }
}

async function updateSimSortOrder(operator, isAsc) {
    try {
        await apiCall('update-sim-sort-order', { operator, isAsc });
    } catch (e) {
        console.error('Failed to update sort order', e);
    }
}

async function loadSims() {
    try {
        // Load sort preferences
        const sortSettings = await apiCall('get-sim-sort-order');
        if (document.getElementById('sort_asc_mobilis')) document.getElementById('sort_asc_mobilis').checked = sortSettings['sort_order_Mobilis'] === 'ASC';
        if (document.getElementById('sort_asc_djezzy')) document.getElementById('sort_asc_djezzy').checked = sortSettings['sort_order_Djezzy'] === 'ASC';
        if (document.getElementById('sort_asc_ooredoo')) document.getElementById('sort_asc_ooredoo').checked = sortSettings['sort_order_Ooredoo'] === 'ASC';

        const sims = await apiCall('get-sims');
        const grid = document.getElementById('simsGrid');
        if (!grid) return;
        
        // Remove cards that are no longer in the list
        const existingCardIds = new Set(sims.map(s => `sim-card-${s.id}`));
        const currentCards = Array.from(grid.querySelectorAll('.sim-card'));
        currentCards.forEach(c => {
            if (c.id && !existingCardIds.has(c.id)) {
                c.remove();
            }
        });
        
        sims.forEach(sim => {
            let card = document.getElementById(`sim-card-${sim.id}`);
            const isNew = !card;
            
            // Generate signal bars HTML
            let signalBarsHtml = '';
            const activeBars = sim.signal || 0;
            for(let i=1; i<=5; i++) {
                signalBarsHtml += `<div class="signal-bar ${i <= activeBars ? 'active' : ''}"></div>`;
            }

            const statusClass = sim.status === 'active' ? 'success' : 'failed';
            const statusText = sim.status === 'active' ? 'Active' : 'Inactive';
            
            if (isNew) {
                card = document.createElement('div');
                card.id = `sim-card-${sim.id}`;
                card.className = 'sim-card';
                card.draggable = true;
                
                card.addEventListener('dragstart', (e) => {
                    card.classList.add('dragging');
                    e.dataTransfer.effectAllowed = 'move';
                });
                
                card.addEventListener('dragend', () => {
                    card.classList.remove('dragging');
                });
                
                if (!grid.dataset.dragEvents) {
                    grid.dataset.dragEvents = 'true';
                    grid.addEventListener('dragover', e => {
                        e.preventDefault();
                        const draggingCard = document.querySelector('.dragging');
                        if (!draggingCard) return;
                        
                        const siblings = [...grid.querySelectorAll('.sim-card:not(.dragging)')];
                        let closest = null;
                        let closestOffset = Number.NEGATIVE_INFINITY;
                        
                        siblings.forEach(child => {
                            const box = child.getBoundingClientRect();
                            const offset = e.clientX - (box.left + box.width / 2) + e.clientY - (box.top + box.height / 2);
                            if (offset < 0 && offset > closestOffset) {
                                closestOffset = offset;
                                closest = child;
                            }
                        });
                        
                        if (closest) {
                            grid.insertBefore(draggingCard, closest);
                        } else {
                            grid.appendChild(draggingCard);
                        }
                    });
                }

                grid.appendChild(card);
                
                // Full initial render for new cards
                card.innerHTML = `
                    <div class="sim-card-header" style="cursor: grab;">
                        <span class="operator-badge ${sim.operator.toLowerCase()}" title="يمكنك سحب وإفلات الشريحة لتغيير مكانها">
                            <i class="fas fa-grip-lines" style="margin-right: 5px; opacity: 0.6;"></i>
                            <i id="spinner-${sim.id}" class="fas fa-cog ${sim.status === 'active' ? 'fa-spin' : ''}" style="margin-right: 4px; font-size: 0.9em; opacity: 0.9;"></i>
                            ${sim.operator}
                        </span>
                        <div style="display:flex; gap:5px; align-items:center;">
                            ${sim.address.includes('.') ? `
                            <button class="btn-block-internet" onclick="fixModemRouting(${sim.id}, '${sim.address}', this)" title="Bloquer internet (serveur uniquement)" style="background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.35); color: #ef4444; border-radius: 6px; padding: 3px 8px; font-size: 10px; cursor: pointer; display: flex; align-items: center; gap: 4px; transition: all 0.2s; font-family: 'Cairo', sans-serif;">
                                <i class="fas fa-globe-slash"></i> <span>Isoler Net</span>
                            </button>
                            ` : ''}
                            <span class="badge ${statusClass}">${statusText}</span>
                        </div>
                    </div>
                    <div class="sim-card-body">
                        <div class="phone">${sim.number}</div>
                        <div class="address">${sim.address} <small>(${sim.type})</small></div>
                        <div class="balance">
                            ${sim.operator.toLowerCase() === 'mobilis' ? renderBalance(sim.balance).replace('الرصيد', 'SOLDE').replace('دج', 'DZ') : `SOLDE: ${sim.balance || 0} DZ`}
                        </div>

                        ${sim.transfer_method === 'Ahla App' ? `
                        <div id="ahla-card-status-${sim.id}" style="margin-top:8px; display:flex; align-items:center; gap:8px; background:rgba(0,0,0,0.25); border:1px solid rgba(255,255,255,0.07); border-radius:8px; padding:6px 10px; font-size:11px;">
                            <span id="ahla-card-dot-${sim.id}" style="width:9px;height:9px;border-radius:50%;background:#f59e0b;flex-shrink:0;transition:background 0.4s,box-shadow 0.4s;"></span>
                            <span id="ahla-card-text-${sim.id}" style="color:#94a3b8;flex:1;">⏳ Vérification Ahla App...</span>
                            <button onclick="refreshAhlaCardStatus(${sim.id})" title="Revérifier" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:12px;padding:0 3px;"><i class='fas fa-rotate-right'></i></button>
                        </div>
                        ` : ''}

                        ${sim.operator.toLowerCase() === 'mobilis' ? `
                        <div style="margin-top:5px; font-size:11px;">
                            <label style="color:#aaa;">Transfert de:</label>
                            <select onchange="updateTransferType(${sim.id}, this.value)" style="background:#1a1d20; color:#fff; border:1px solid #444; border-radius:3px; padding:2px; font-size:11px;">
                                <option value="04" ${sim.transfer_type === '04' ? 'selected' : ''}>GTS (04)</option>
                                <option value="01" ${sim.transfer_type === '01' ? 'selected' : ''}>Poste (01)</option>
                                <option value="02" ${sim.transfer_type === '02' ? 'selected' : ''}>Assilou (02)</option>
                                <option value="03" ${sim.transfer_type === '03' ? 'selected' : ''}>Data (03)</option>
                                <option value="05" ${sim.transfer_type === '05' ? 'selected' : ''}>Mobilis (05)</option>
                            </select>
                        </div>
                        ` : ''}
                        
                        <div style="margin-top:10px;">
                            <label style="font-size:11px; color:#aaa;">Code d'envoi:</label>
                            <input type="text" value="${sim.ussd_transfer_override || ''}" onchange="updateSimTransferOverride(${sim.id}, this.value)" style="width:100%; background:rgba(0,0,0,0.3); border:1px solid #444; color:#fff; border-radius:4px; padding:4px 8px; font-size:12px; font-family:monospace;" placeholder="Ex: *610*{phone}*{amount}*0000#">
                        </div>
                        
                        <div class="card-actions" style="margin-top:15px; display:flex; gap:10px; flex-wrap:wrap;">
                            <button class="btn secondary btn-check-balance" style="flex:1;" onclick="checkBalance(${sim.id}, this)"><i class="fas fa-sync"></i> Vérifier</button>
                            <button class="btn secondary btn-toggle-status" onclick="toggleSimStatus(${sim.id}, '${sim.status}')">
                                <i class="fas ${sim.status === 'active' ? 'fa-stop' : 'fa-play'}"></i>
                            </button>
                            <button class="btn secondary" onclick="editSim(${sim.id}, '${sim.operator}', '${sim.number}', '${sim.type}', '${sim.address}', '${sim.ussd_transfer_override || ''}', '${sim.ussd_balance_override || ''}', '${sim.transfer_method || 'USSD'}', '${sim.ahla_phone || ''}', '${sim.ahla_pin || ''}', '${sim.sim_pin || ''}', ${sim.margin_percent_1 || 0}, ${sim.margin_percent_2 || 0})"><i class="fas fa-edit"></i></button>
                            <button class="btn danger-outline" onclick="deleteSim(${sim.id})"><i class="fas fa-trash"></i></button>
                        </div>
                    </div>
                    <!-- Removed sim-card-footer as requested -->

                    <!-- Live Monitoring Terminal -->
                    <div class="sim-terminal-container">
                        <div class="sim-terminal-header">
                            <span><i class="fas fa-terminal"></i> Moniteur en Direct</span>
                            <span class="pulse-dot"></span>
                        </div>
                        <div id="log-${sim.address.replace(/[^a-zA-Z0-9]/g, '')}" class="sim-terminal-body">
                            <div style="color: #22c55e; font-family: monospace; font-size: 1.1em; font-weight: bold; display: flex; align-items: center; gap: 10px;">
                                conect ${sim.operator} 
                                <div class="signal-container" style="transform: scale(0.85); transform-origin: left center; margin: 0; background: rgba(0,0,0,0.3); padding: 2px 8px; border-radius: 4px;" title="Signal: ${sim.signal || 0}/5">
                                    ${signalBarsHtml}
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- SIM Operations Journal -->
                    <div class="sim-history-container">
                        <div class="sim-history-header">
                            <span><i class="fas fa-clock-rotate-left"></i> Journal des opérations</span>
                            <span style="font-size:9px; background:#1e293b; padding:2px 5px; border-radius:3px;">FLEXY</span>
                        </div>
                        <div id="history-${sim.id}" class="sim-history-list">
                            <div style="font-size:11px; color:var(--text-muted); text-align:center; padding-top:10px;">Chargement...</div>
                        </div>
                    </div>
                `;
                loadSimMiniHistory(sim.id);
                if (sim.transfer_method === 'Ahla App') {
                    refreshAhlaCardStatus(sim.id);
                }
            } else {
                // Update in-place to avoid shift, jumping, and resetting terminals/history
                const statusBadge = card.querySelector('.sim-card-header .badge');
                if (statusBadge) {
                    statusBadge.className = `badge ${statusClass}`;
                    statusBadge.innerText = statusText;
                }
                
                const spinner = card.querySelector(`#spinner-${sim.id}`);
                if (spinner) {
                    if (sim.status === 'active') {
                        spinner.classList.add('fa-spin');
                    } else {
                        spinner.classList.remove('fa-spin');
                    }
                }
                
                const balanceDiv = card.querySelector('.sim-card-body .balance');
                if (balanceDiv) {
                    balanceDiv.innerHTML = sim.operator.toLowerCase() === 'mobilis' ? renderBalance(sim.balance).replace('الرصيد', 'SOLDE').replace('دج', 'DZ') : `SOLDE: ${sim.balance || 0} DZ`;
                }
                
                const signalContainer = card.querySelector('.sim-terminal-body .signal-container');
                if (signalContainer) {
                    signalContainer.title = `Signal: ${activeBars}/5`;
                    signalContainer.innerHTML = signalBarsHtml;
                }
                
                const toggleBtn = card.querySelector('.sim-card-body .btn-toggle-status');
                if (toggleBtn) {
                    toggleBtn.setAttribute('onclick', `toggleSimStatus(${sim.id}, '${sim.status}')`);
                    const icon = toggleBtn.querySelector('i');
                    if (icon) {
                        icon.className = `fas ${sim.status === 'active' ? 'fa-stop' : 'fa-play'}`;
                    }
                }
                
                const selectDropdown = card.querySelector('.sim-card-body select');
                if (selectDropdown) {
                    selectDropdown.value = sim.transfer_type;
                }
                
                // Refresh mini history smoothly without touching terminal log
                loadSimMiniHistory(sim.id);
            }
        });
        
        // Update stats summary on dashboard tab too if active
        loadDashboardStats();
    } catch (e) {
        console.error(e);
    }
}

async function loadSimMiniHistory(simId) {
    try {
        const transactions = await apiCall('get-sim-transactions', simId);
        const container = document.getElementById(`history-${simId}`);
        if (!container) return;
        
        const filteredTransactions = transactions.filter(t => {
            return t.status.toLowerCase().includes('success') && t.type !== 'BALANCE';
        });

        if (filteredTransactions.length === 0) {
            container.innerHTML = '<div style="font-size:10px; color:var(--text-muted); text-align:center; padding-top:10px;">Aucune opération réussie</div>';
            return;
        }

        container.innerHTML = '';
        filteredTransactions.forEach(t => {
            const item = document.createElement('div');
            const statusLower = t.status.toLowerCase();
            const isSuccess = statusLower.includes('success');
            const isPending = statusLower.includes('pending');
            
            item.className = `sim-history-item ${isSuccess ? 'success' : (isPending ? 'pending' : 'failed')}`;
            
            const time = new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            
            let label = '';
            let iconClass = '';
            let amountText = '';

            if (t.type === 'BALANCE') {
                label = `Vérifier Solde`;
                iconClass = 'fas fa-search';
                if (isPending) {
                    amountText = '<i class="fas fa-spinner fa-spin"></i> En cours...';
                } else {
                    const msg = t.status.startsWith('SUCCESS:') ? t.status.replace('SUCCESS:', '').trim() : (isSuccess ? 'Terminé' : 'Échoué');
                    amountText = msg;
                }
            } else {
                const typeText = t.amount >= 500 ? "Activer l'offre" : 'Recharge Flexy';
                label = typeText;
                iconClass = t.amount >= 500 ? 'fas fa-bolt' : 'fas fa-mobile-screen-button';
                if (isPending) {
                    amountText = '<i class="fas fa-spinner fa-spin"></i> En cours...';
                } else {
                    amountText = `${t.amount} DZ`;
                }
            }
            
            item.innerHTML = `
                <div class="item-meta">
                    <span class="item-time">${time}</span>
                    <span class="item-label"><i class="${iconClass}"></i> ${label}</span>
                </div>
                <strong class="item-amount">${amountText}</strong>
            `;
            container.appendChild(item);
        });
    } catch (e) { console.error(e); }
}

async function loadCards() {
    try {
        const cards = await apiCall('get-cards');
        const tbody = document.getElementById('cardsList');
        tbody.innerHTML = '';
        cards.forEach(card => {
            const statusClass = card.status === 'available' ? 'success' : 'failed';
            const statusText = card.status === 'available' ? 'متاح' : 'مباعة';
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${card.category}</td>
                <td class="phone-num">${card.pin_code}</td>
                <td class="amount-val">${card.value} دج</td>
                <td><span class="badge ${statusClass}">${statusText}</span></td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) {
        console.error(e);
    }
}

async function loadSettings() {
    try {
        const settings = await apiCall('get-settings');
        settings.forEach(s => {
            const input = document.getElementById(`setting_${s.key}`);
            if (input) {
                if (s.key === 'ooredoo_ahla_pin' && (!s.value || s.value === '0' || s.value === '0000')) {
                    input.value = '7840';
                } else if (s.key === 'ooredoo_ahla_adb_path' && !s.value) {
                    input.value = 'adb';
                } else {
                    input.value = s.value;
                }
            }
        });
    } catch (e) {
        console.error(e);
    }
}

// --- Actions ---
// --- Actions ---
function toggleSimFields() {
    const operator = document.getElementById('simOperator').value;
    const transferMethod = document.getElementById('simTransferMethod').value;
    const addressGroup = document.getElementById('simAddressGroup');
    const smartScanBtn = document.getElementById('simSmartScanBtn');
    const methodGroup = document.getElementById('simTransferMethodGroup');
    const addressInput = document.getElementById('simAddress');
    const ahlaConfigGroup = document.getElementById('ahlaConfigGroup');

    if (operator === 'Ooredoo') {
        if (methodGroup) methodGroup.style.display = 'block';
        if (transferMethod === 'Ahla App') {
            if (addressGroup) addressGroup.style.display = 'none';
            if (smartScanBtn) smartScanBtn.style.display = 'none';
            if (addressInput) addressInput.placeholder = 'مثال: Emulator (اختياري مع Ahla)';
            if (ahlaConfigGroup) ahlaConfigGroup.style.display = 'block';
        } else {
            if (addressGroup) addressGroup.style.display = 'block';
            if (smartScanBtn) smartScanBtn.style.display = 'block';
            if (addressInput) addressInput.placeholder = 'مثال: 192.168.8.1 أو COM3';
            if (ahlaConfigGroup) ahlaConfigGroup.style.display = 'none';
        }
    } else {
        if (methodGroup) methodGroup.style.display = 'none';
        document.getElementById('simTransferMethod').value = 'USSD';
        if (addressGroup) addressGroup.style.display = 'block';
        if (smartScanBtn) smartScanBtn.style.display = 'block';
        if (addressInput) addressInput.placeholder = 'مثال: 192.168.8.1 أو COM3';
        if (ahlaConfigGroup) ahlaConfigGroup.style.display = 'none';
    }
}

// Attach event listeners for dynamic field toggles on load
setTimeout(() => {
    const simOperator = document.getElementById('simOperator');
    const simTransferMethod = document.getElementById('simTransferMethod');
    if (simOperator) simOperator.addEventListener('change', toggleSimFields);
    if (simTransferMethod) simTransferMethod.addEventListener('change', toggleSimFields);
}, 1000);

function resetSimModal() {
    document.getElementById('simModalTitle').innerText = 'إضافة شريحة جديدة';
    document.getElementById('editSimId').value = '';
    document.getElementById('simOperator').value = 'Mobilis';
    document.getElementById('simNumber').value = '';
    document.getElementById('simAddress').value = '';
    document.getElementById('simTransferOverride').value = '';
    document.getElementById('simBalanceOverride').value = '';
    document.getElementById('simTransferMethod').value = 'USSD';
    
    document.getElementById('simAhlaPhone').value = '';
    document.getElementById('simAhlaPin').value = '';
    document.getElementById('simSimPin').value = '';
    
    if (document.getElementById('simMargin1')) document.getElementById('simMargin1').value = '';
    if (document.getElementById('simMargin2')) document.getElementById('simMargin2').value = '';
    
    toggleSimFields();
}

async function saveSim() {
    let address = document.getElementById('simAddress').value;
    const transferMethod = document.getElementById('simTransferMethod').value;

    if (transferMethod === 'Ahla App' && !address) {
        address = 'Emulator';
    }

    const type = (address && (address.match(/^\d+\.\d+\.\d+\.\d+$/) || address.startsWith('http'))) ? 'IP' : 'COM';

    const data = {
        operator: document.getElementById('simOperator').value,
        number: document.getElementById('simNumber').value,
        type: type,
        address: address,
        ussd_transfer_override: document.getElementById('simTransferOverride').value,
        ussd_balance_override: document.getElementById('simBalanceOverride').value,
        transfer_method: transferMethod,
        margin_percent_1: document.getElementById('simMargin1') ? document.getElementById('simMargin1').value : 0,
        margin_percent_2: document.getElementById('simMargin2') ? document.getElementById('simMargin2').value : 0
    };

    const editId = document.getElementById('editSimId').value;

    if(!data.number || !data.address) return alert('الرجاء إدخال الرقم والعنوان!');

    try {
    if (transferMethod === 'Ahla App') {
        data.ahla_phone = document.getElementById('simAhlaPhone').value;
        data.ahla_pin = document.getElementById('simAhlaPin').value;
        data.sim_pin = document.getElementById('simSimPin').value;
    }

        if (editId) {
            data.id = parseInt(editId);
            await apiCall('update-sim', data);
        } else {
            await apiCall('add-sim', data);
        }
        hideModal('addSimModal');
        resetSimModal();
        loadSims();
    } catch (e) {
        alert('حدث خطأ أثناء الحفظ');
    }
}

function editSim(id, operator, number, type, address, transferOverride, balanceOverride, transferMethod, ahlaPhone, ahlaPin, simPin, margin1, margin2) {
    document.getElementById('simModalTitle').innerText = 'تعديل الشريحة';
    document.getElementById('editSimId').value = id;
    document.getElementById('simOperator').value = operator;
    document.getElementById('simNumber').value = number;
    document.getElementById('simAddress').value = address || '';
    document.getElementById('simTransferOverride').value = transferOverride || '';
    document.getElementById('simBalanceOverride').value = balanceOverride || '';
    document.getElementById('simTransferMethod').value = transferMethod || 'USSD';
    
    document.getElementById('simAhlaPhone').value = ahlaPhone || '';
    document.getElementById('simAhlaPin').value = ahlaPin || '';
    document.getElementById('simSimPin').value = simPin || '';

    if (document.getElementById('simMargin1')) document.getElementById('simMargin1').value = margin1 || '';
    if (document.getElementById('simMargin2')) document.getElementById('simMargin2').value = margin2 || '';

    toggleSimFields();
    showModal('addSimModal');
}

async function deleteSim(id) {
    if (!confirm('هل أنت متأكد من حذف هذه الشريحة؟')) return;
    try {
        await apiCall('delete-sim', id);
        loadSims();
    } catch (e) {
        alert('حدث خطأ أثناء الحذف');
    }
}

async function updateSimTransferOverride(id, newValue) {
    try {
        await apiCall('update-sim-transfer-override', { id, transferOverride: newValue });
    } catch (e) {
        alert('حدث خطأ أثناء تحديث الكود: ' + e.message);
    }
}

async function toggleSimStatus(id, currentStatus) {
    const newStatus = currentStatus === 'active' ? 'stopped' : 'active';
    try {
        await apiCall('toggle-sim-status', { id, status: newStatus });
        loadSims();
    } catch (e) {
        alert('حدث خطأ أثناء تغيير الحالة');
    }
}

async function scanComPorts() {
    try {
        const ports = await apiCall('get-com-ports');
        const datalist = document.getElementById('comPortsList');
        datalist.innerHTML = '';
        
        if (ports.length === 0) {
            alert('لم يتم العثور على أي منافذ COM نشطة.');
        } else {
            ports.forEach(portStr => {
                const match = portStr.match(/^(COM\d+)\s*\((.*)\)$/);
                const option = document.createElement('option');
                if (match) {
                    option.value = match[1]; // Put only COM13 in the input
                    option.label = match[2]; // Show manufacturer as label
                } else {
                    option.value = portStr;
                }
                datalist.appendChild(option);
            });
            alert('تم تحديث قائمة المنافذ! اضغط على السهم في الخانة للاختيار.');
        }
    } catch (e) {
        alert('حدث خطأ أثناء فحص المنافذ');
    }
}

async function autoDetectSim(e) {
    const address = document.getElementById('simAddress').value;
    if (!address) return alert('الرجاء إدخال منفذ الـ COM أولاً!');
    
    if (!address.toUpperCase().startsWith('COM')) {
        return alert('الفحص الذكي يعمل فقط مع منافذ الـ COM (USB Modems)!');
    }

    const btn = e.target;
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الفحص...';
    btn.disabled = true;

    try {
        const result = await apiCall('auto-detect-sim', address);
        if (result.success) {
            alert(`تم الفحص بنجاح!\nالشبكة: ${result.operator}\nقوة الإشارة: ${result.bars}/5`);
            if (result.operator !== 'Unknown') {
                document.getElementById('simOperator').value = result.operator;
            }
        } else {
            alert('فشل الفحص: ' + result.message);
        }
    } catch (e) {
        alert('خطأ في الاتصال: ' + e);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

async function saveCard() {
    const data = {
        category: document.getElementById('cardCategory').value,
        pin_code: document.getElementById('cardPin').value,
        value: document.getElementById('cardValue').value
    };

    if(!data.pin_code || !data.value) return alert('الرجاء إدخال رقم البطاقة والقيمة!');

    try {
        await apiCall('add-card', data);
        hideModal('addCardModal');
        loadCards();
    } catch (e) {
        alert('حدث خطأ أثناء الحفظ. قد يكون كود البطاقة مكرراً.');
    }
}

async function handleFileUpload() {
    const fileInput = document.getElementById('uploadFile');
    const category = document.getElementById('uploadCategory').value;
    const purchasePrice = parseFloat(document.getElementById('uploadPurchasePrice').value);
    const salePrice = parseFloat(document.getElementById('uploadSalePrice').value);

    if (!fileInput.files || fileInput.files.length === 0) {
        return alert('الرجاء اختيار ملف نصي أولاً!');
    }

    if (isNaN(purchasePrice) || isNaN(salePrice)) {
        return alert('الرجاء إدخال سعر الشراء وسعر البيع!');
    }

    const file = fileInput.files[0];
    const reader = new FileReader();

    reader.onload = async (e) => {
        const text = e.target.result;
        const lines = text.split('\n');
        const cards = [];

        lines.forEach(line => {
            line = line.trim();
            if (!line) return;

            // Split by comma, space, semicolon or tab
            const parts = line.split(/[,\s，;\t]+/);
            let pin = '';
            let serial = '';

            if (parts.length >= 2) {
                const part1 = parts[0].trim();
                const part2 = parts[1].trim();
                
                // Smart auto-detection of PIN and Serial based on standard lengths
                if (category === 'Mobilis') {
                    if (part1.length === 14 || part1.length === 15) {
                        pin = part1;
                        serial = part2;
                    } else if (part2.length === 14 || part2.length === 15) {
                        pin = part2;
                        serial = part1;
                    } else {
                        pin = part1;
                        serial = part2;
                    }
                } else if (category === 'Idoom ADSL' || category === 'Idoom 4G') {
                    if (part1.length === 16 || part1.length === 15) {
                        pin = part1;
                        serial = part2;
                    } else if (part2.length === 16 || part2.length === 15) {
                        pin = part2;
                        serial = part1;
                    } else {
                        pin = part1;
                        serial = part2;
                    }
                }
            } else if (parts.length === 1) {
                // If the line only contains the PIN code
                pin = parts[0].trim();
                serial = 'S_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
            }

            if (!pin) return;

            // Validate lengths based on category
            let isValid = false;
            if (category === 'Mobilis') {
                // Mobilis PIN code must be 14 digits (standard) or 15 digits
                isValid = (pin.length === 14 || pin.length === 15);
            } else if (category === 'Idoom ADSL' || category === 'Idoom 4G') {
                // Idoom card PIN can be 15 or 16 digits
                isValid = (pin.length === 15 || pin.length === 16);
            }

            if (isValid) {
                cards.push({
                    category: category,
                    pin_code: pin,
                    serial_number: serial,
                    value: salePrice,
                    purchase_price: purchasePrice
                });
            }
        });

        if (cards.length === 0) {
            return alert('لم يتم العثور على بطاقات صالحة في الملف. يرجى التحقق من الأطوال والصيغة.');
        }

        try {
            const result = await apiCall('import-cards', cards);
            alert(`تم استيراد ${result.count} بطاقة بنجاح!`);
            hideModal('uploadCardsModal');
            loadCards();
        } catch (error) {
            alert('حدث خطأ أثناء استيراد البطاقات: ' + error.message);
        }
    };

    reader.readAsText(file);
}

window.handleFileUpload = handleFileUpload;

async function saveSettings() {
    const keys = [
        'bot_token', 'client_id', 'meetmob_idoom_sync_code', 'admin_secret', 'captcha_api_key',
        'ussd_mobilis_balance', 'ussd_djezzy_balance', 'ussd_ooredoo_balance',
        'ussd_mobilis_transfer', 'ussd_djezzy_transfer', 'ussd_ooredoo_transfer',
        'ooredoo_ahla_adb_path', 'ooredoo_ahla_phone', 'ooredoo_ahla_pin'
    ];

    const settingsArray = [];
    keys.forEach(key => {
        const input = document.getElementById(`setting_${key}`);
        if (input) {
            settingsArray.push({ key: key, value: input.value });
        }
    });

    try {
        const result = await apiCall('save-settings', settingsArray);
        if (result.success) {
            alert('تم حفظ الإعدادات بنجاح! قد يحتاج البوت لإعادة التشغيل إذا قمت بتغيير الـ Token.');
        }
    } catch (e) {
        alert('حدث خطأ أثناء حفظ الإعدادات');
    }
}

// Refreshes the Ahla emulator screen live preview image with a cache-buster
function refreshAhlaPreview(event) {
    if (event) event.preventDefault();
    const img = document.getElementById('ahla-live-preview');
    if (img) {
        img.src = 'last_ahla_screenshot.png?t=' + Date.now();
    }
}
window.refreshAhlaPreview = refreshAhlaPreview;

// Test Ahla App emulator connection
async function testAhlaConnection() {
    const dot = document.getElementById('ahla-status-dot');
    const text = document.getElementById('ahla-status-text');
    const btn = document.getElementById('btn-test-ahla');
    
    if (dot) dot.style.background = '#f59e0b';
    if (text) text.textContent = '⏳ جاري فحص الاتصال بالمحاكي...';
    if (btn) btn.disabled = true;
    
    try {
        const result = await apiCall('test-ahla-connection');
        
        if (result.success) {
            if (dot) dot.style.background = '#22c55e';
            if (dot) dot.style.boxShadow = '0 0 8px #22c55e';
        } else if (result.status === 'no_app') {
            if (dot) dot.style.background = '#f59e0b';
            if (dot) dot.style.boxShadow = '0 0 8px #f59e0b';
        } else {
            if (dot) dot.style.background = '#ef4444';
            if (dot) dot.style.boxShadow = '0 0 8px #ef4444';
        }
        
        if (text) text.textContent = result.message;
    } catch (e) {
        if (dot) dot.style.background = '#ef4444';
        if (text) text.textContent = '❌ خطأ في فحص الاتصال: ' + e.message;
    }
    
    if (btn) btn.disabled = false;
    refreshAhlaPreview();
}
window.testAhlaConnection = testAhlaConnection;

async function saveAndStartBot() {
    const keys = ['bot_token', 'admin_secret', 'captcha_api_key'];
    const settingsArray = [];
    keys.forEach(key => {
        const input = document.getElementById(`setting_${key}`);
        if (input) {
            settingsArray.push({ key: key, value: input.value });
        }
    });

    try {
        const result = await apiCall('save-settings', settingsArray);
        if (result.success) {
            alert('تم حفظ الإعدادات وتشغيل البوت بنجاح! 🚀');
        }
    } catch (e) {
        alert('حدث خطأ أثناء إرسال الإعدادات للسيرفر.');
    }
}

async function checkBalance(simId, btnElement) {
    const originalText = btnElement.innerHTML;
    btnElement.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    btnElement.disabled = true;

    // Find the terminal body of this card to output live actions instantly
    const cardElement = btnElement.closest('.sim-card');
    const terminalBody = cardElement ? cardElement.querySelector('.sim-terminal-body') : null;
    


    try {
        const result = await apiCall('check-balance', simId);
        if(!result.success) {
            alert('خطأ: \n' + result.message);
        }
    } catch (e) {
        alert('خطأ في الاتصال: ' + e);
    } finally {
        btnElement.innerHTML = originalText;
        btnElement.disabled = false;
        loadSims();
    }
}
ipcRenderer.on('automation-log', (event, log) => {
    const terminal = document.getElementById('automationTerminal');
    if (terminal) {
        const line = document.createElement('div');
        line.innerText = `> ${log.trim()}`;
        if (log.toLowerCase().includes('success') || log.includes('ناجحة')) line.style.color = '#0f0';
        if (log.toLowerCase().includes('error') || log.includes('فشل')) line.style.color = '#f00';
        if (log.toLowerCase().includes('captcha')) line.style.color = '#ff0';
        
        terminal.appendChild(line);
        terminal.scrollTop = terminal.scrollHeight;
        
        if (terminal.children.length > 100) {
            terminal.removeChild(terminal.firstChild);
        }
    }

    // Forward Meetmob logs to the Meetmob tab logs so they are visible directly
    if (log.includes('[Meetmob]') || log.includes('[Meetmob Routing]')) {
        appendMeetmobLog(log.trim());
    }
});

ipcRenderer.on('modem-log', (event, data) => {
    const logId = `log-${data.address.replace(/[^a-zA-Z0-9]/g, '')}`;
    const logBox = document.getElementById(logId);
    if (logBox) {
        const div = document.createElement('div');
        div.style.marginBottom = '6px';
        div.style.fontSize = '14px';
        div.style.fontFamily = "'JetBrains Mono', 'Fira Code', monospace";
        
        const rawText = data.log;
        let displayText = rawText
            .replace(/\[hilink\]/ig, '')
            .replace('جاري استعلام الرصيد', 'Vérification du solde en cours')
            .replace('جاري', 'En cours')
            .replace('الرد:', 'Réponse:')
            .replace('الرصيد المستخرج:', 'Solde extrait:')
            .replace('نجاح', 'Succès')
            .replace('فشل', 'Échec');
        
        if (rawText.startsWith('[SERIAL SEND]') || rawText.startsWith('جاري') || rawText.startsWith('[SERIAL]') || rawText.startsWith('En cours:')) {
            div.style.color = '#38bdf8'; // Cyan for commands
            div.innerHTML = `<span style="color:#64748b; font-weight:bold;">&gt;</span> ${displayText}`;
        } else if (rawText.startsWith('الرد:') || rawText.startsWith('[SMS CONTENT]') || rawText.startsWith('[SMS]') || rawText.startsWith('Réponse:') || rawText.startsWith('Réponse finale:')) {
            div.style.color = '#4ade80'; // Green for replies
            div.innerHTML = `<span style="color:#475569; font-weight:bold;">&lt;</span> ${displayText}`;
        } else if (rawText.includes('الرصيد المستخرج:') || rawText.includes('نجاح') || rawText.includes('SUCCESS') || rawText.includes('reussie') || rawText.includes('Succès:') || rawText.includes('Solde extrait:')) {
            div.style.color = '#facc15'; // Gold for success extraction
            div.style.fontWeight = 'bold';
            div.innerHTML = `<span style="color:#facc15;">🌟</span> ${displayText}`;
        } else if (rawText.toLowerCase().includes('failed') || rawText.toLowerCase().includes('error') || rawText.includes('فشل') || rawText.includes('⚠️')) {
            div.style.color = '#f43f5e'; // Rose/Red for errors/warnings
            div.innerHTML = `<span style="color:#f43f5e;">🚨</span> ${displayText}`;
        } else {
            div.style.color = '#94a3b8'; // Muted grey for normal trace logs
            div.innerHTML = `<span style="color:#334155;">#</span> ${displayText}`;
        }
        
        logBox.appendChild(div);
        logBox.scrollTop = logBox.scrollHeight;
        
        if (logBox.children.length > 40) {
            logBox.removeChild(logBox.firstChild);
        }
    }
});

ipcRenderer.on('bot-log', (event, data) => {
    appendToLiveLog(data);
    // Also refresh the history table if visible
    if (document.getElementById('bot-manager-tab').style.display === 'block') {
        loadLogs();
    }
});

function appendToLiveLog(log) {
    const container = document.getElementById('liveBotLogs');
    if (!container) return;

    const entry = document.createElement('div');
    const isAdmin = log.user_id === 'ADMIN';
    const isSms = log.user_id === 'SMS';
    
    entry.className = `log-entry ${isAdmin ? 'admin' : (isSms ? 'sms' : '')}`;
    
    const time = new Date(log.timestamp).toLocaleTimeString();
    
    entry.innerHTML = `
        <div class="log-entry-header">
            <strong class="log-entry-name ${isAdmin ? 'admin' : ''}">${log.user_name}</strong>
            <span class="log-entry-time">${time}</span>
        </div>
        <div class="log-entry-message">${log.message}</div>
    `;

    container.prepend(entry);
    if (container.children.length > 50) {
        container.removeChild(container.lastChild);
    }
}

function openSendMessageModal(telegramId, name) {
    if (!telegramId || telegramId === 'null') {
        alert('هذا الوكيل ليس لديه معرف تيليجرام مسجل.');
        return;
    }
    document.getElementById('msgAgentId').value = telegramId;
    document.getElementById('msgAgentName').value = name;
    document.getElementById('direct_message_text').value = '';
    showModal('sendMessageModal');
}

async function sendDirectMessage() {
    const userId = document.getElementById('msgAgentId').value;
    const text = document.getElementById('direct_message_text').value.trim();

    if (!text) return alert('الرجاء كتابة رسالة!');

    try {
        const result = await apiCall('send-telegram-message', { userId, text });
        if (result.success) {
            hideModal('sendMessageModal');
            alert('تم إرسال الرسالة بنجاح.');
        } else {
            alert('فشل الإرسال: ' + result.message);
        }
    } catch (e) {
        alert('خطأ: ' + e.message);
    }
}

async function sendBroadcast() {
    const text = document.getElementById('broadcast_message').value.trim();
    if (!text) return alert('الرجاء كتابة رسالة الإعلان!');

    if (!confirm('هل أنت متأكد من إرسال هذه الرسالة لجميع الوكلاء؟')) return;

    try {
        const result = await apiCall('broadcast-telegram-message', { text });
        if (result.success) {
            document.getElementById('broadcast_message').value = '';
            alert(`تم إرسال الإعلان بنجاح إلى ${result.count} وكيل.`);
        } else {
            alert('فشل الإرسال: ' + result.message);
        }
    } catch (e) {
        alert('خطأ: ' + e.message);
    }
}

ipcRenderer.on('bot-status', (event, data) => {
    const indicator = document.getElementById('bot_status_indicator');
    const text = document.getElementById('bot_status_text');
    if (indicator && text) {
        if (data.connected) {
            indicator.style.backgroundColor = 'var(--success)';
            indicator.style.boxShadow = '0 0 10px var(--success)';
            text.innerText = `متصل (${data.username})`;
            text.style.color = 'var(--success)';
        } else {
            indicator.style.backgroundColor = 'var(--danger)';
            indicator.style.boxShadow = '0 0 10px var(--danger)';
            text.innerText = `غير متصل: ${data.message || 'خطأ'}`;
            text.style.color = 'var(--danger)';
        }
    }
});

function renderBalance(balanceStr) {
    try {
        const balances = JSON.parse(balanceStr);
        return `
            <div style="font-size:11px; line-height:1.2;">
                <div>GTS: <span style="color:var(--success); font-weight:bold;">${balances.gts || 0}</span> دج</div>
                <div>Poste: ${balances.poste || 0} دج</div>
                <div>Assilou: ${balances.assilou || 0} دج</div>
                <div>Data: ${balances.data || 0} دج</div>
                <div>Mobilis: ${balances.mobilis || 0} دج</div>
            </div>
        `;
    } catch(e) {
        const cleanBalance = (balanceStr === '.' || !balanceStr) ? '0' : balanceStr;
        return `الرصيد: ${cleanBalance} دج`;
    }
}

async function updateTransferType(simId, value) {
    await apiCall('update-transfer-type', simId, value);
}

async function sendBroadcast() {
    const messageInput = document.getElementById('broadcast_message');
    const message = messageInput.value.trim();
    
    if (!message) {
        return alert('يرجى كتابة رسالة أولاً');
    }

    if (!confirm('هل أنت متأكد من إرسال هذه الرسالة لجميع الوكلاء؟')) {
        return;
    }

    try {
        const result = await apiCall('send-broadcast', message);
        if (result.success) {
            alert('تم إرسال الرسالة لـ ' + result.count + ' وكيل بنجاح!');
            messageInput.value = '';
        } else {
            alert('فشل الإرسال: ' + result.message);
        }
    } catch (e) {
        alert('حدث خطأ أثناء الإرسال');
    }
}

window.sendBroadcast = sendBroadcast;

// --- Journal Agents ---
let currentSelectedAgentId = null;

async function loadAgentJournal() {
    try {
        const agents = await apiCall('get-agent-journal-list');
        const listContainer = document.getElementById('agentListJournal');
        listContainer.innerHTML = '';
        
        agents.forEach(agent => {
            const item = document.createElement('div');
            item.className = 'agent-journal-item';
            item.style.padding = '12px';
            item.style.marginBottom = '8px';
            item.style.borderRadius = '6px';
            item.style.background = currentSelectedAgentId == agent.id ? 'rgba(37, 99, 235, 0.12)' : 'var(--panel-bg)';
            item.style.border = currentSelectedAgentId == agent.id ? '1px solid var(--primary)' : '1px solid var(--border-color)';
            item.style.cursor = 'pointer';
            item.onclick = () => selectAgent(agent.id);
            
            item.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <strong style="color: var(--text-main);">${agent.name}</strong>
                    <span style="font-size:12px; color: var(--text-muted);">ID: ${agent.id}</span>
                </div>
                <div style="font-size:11px; margin-top:5px; color: var(--text-muted);">
                    الرصيد: ${agent.balance} دج | المبيعات: ${agent.total_sales || 0} دج
                </div>
            `;
            listContainer.appendChild(item);
        });
    } catch (e) { console.error(e); }
}

async function selectAgent(agentId) {
    currentSelectedAgentId = agentId;
    loadAgentJournal(); // Refresh list to show active state
    
    const period = document.getElementById('agentPeriodFilter').value;
    try {
        const transactions = await apiCall('get-agent-transactions', { agentId, period });
        const tbody = document.getElementById('agentTransactionsJournal');
        tbody.innerHTML = '';
        
        let totalAmount = 0;
        transactions.forEach(t => {
            const tr = document.createElement('tr');
            const date = new Date(t.timestamp).toLocaleString();
            const statusClass = t.status.startsWith('SUCCESS') ? 'success' : (t.status.startsWith('PENDING') ? 'warning' : 'failed');
            const statusText = t.status.startsWith('SUCCESS') ? 'ناجحة' : (t.status.startsWith('PENDING') ? 'قيد الانتظار' : 'فاشلة');
            
            if (t.status.startsWith('SUCCESS')) totalAmount += t.amount;

            tr.innerHTML = `
                <td>${date}</td>
                <td>${t.type || 'FLEXY'}</td>
                <td class="phone-num">${t.phone_number}</td>
                <td class="amount-val">${t.amount} دج</td>
                <td><span class="badge ${statusClass}">${statusText}</span></td>
            `;
            tbody.appendChild(tr);
        });
        
        document.getElementById('selectedAgentTotal').innerText = `${totalAmount} دج`;
        document.getElementById('selectedAgentCount').innerText = transactions.length;
        
        if (transactions.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px; color:#888;">لا توجد عمليات لهذه الفترة</td></tr>';
        }
    } catch (e) { console.error(e); }
}

function filterAgentsJournal() {
    const q = document.getElementById('agentSearchJournal').value.toLowerCase();
    const items = document.querySelectorAll('.agent-journal-item');
    items.forEach(item => {
        const name = item.querySelector('strong').innerText.toLowerCase();
        item.style.display = name.includes(q) ? 'block' : 'none';
    });
}

// --- Journal Server ---
async function loadServerJournal() {
    const simId = document.getElementById('simFilterJournal').value;
    const period = document.getElementById('serverPeriodFilter').value;
    
    try {
        const transactions = await apiCall('get-server-transactions', { simId, period });
        const tbody = document.getElementById('serverTransactionsJournal');
        tbody.innerHTML = '';
        
        let totalSales = 0;
        let successCount = 0;
        let failedCount = 0;
        
        transactions.forEach(t => {
            const tr = document.createElement('tr');
            const date = new Date(t.timestamp).toLocaleString();
            const isSuccess = t.status.startsWith('SUCCESS');
            if (isSuccess) {
                totalSales += t.amount;
                successCount++;
            } else if (t.status.startsWith('FAILED') || t.status.startsWith('ERROR')) {
                failedCount++;
            }
            
            const statusClass = isSuccess ? 'success' : (t.status.startsWith('PENDING') ? 'warning' : 'failed');
            
            tr.innerHTML = `
                <td>${date}</td>
                <td>${t.sim_number || 'AUTO'}</td>
                <td>${t.type || 'FLEXY'}</td>
                <td class="phone-num">${t.phone_number}</td>
                <td class="amount-val">${t.amount} دج</td>
                <td>${t.balance_before || '-'}</td>
                <td>${t.balance_after || '-'}</td>
                <td><span class="badge ${statusClass}">${t.status}</span></td>
            `;
            tbody.appendChild(tr);
        });
        
        document.getElementById('serverTotalSales').innerText = `${totalSales} دج`;
        document.getElementById('serverSuccessCount').innerText = successCount;
        document.getElementById('serverFailedCount').innerText = failedCount;
        
        if (transactions.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:20px; color:#888;">لا توجد سجلات لهذه الفترة</td></tr>';
        }
    } catch (e) { console.error(e); }
}

async function updateSimFilterDropdown() {
    try {
        const sims = await apiCall('get-sims');
        const select = document.getElementById('simFilterJournal');
        // Keep "All" and add others
        select.innerHTML = '<option value="all">كل الشرائح</option>';
        sims.forEach(sim => {
            const opt = document.createElement('option');
            opt.value = sim.id;
            opt.innerText = `${sim.operator} (${sim.number})`;
            select.appendChild(opt);
        });
    } catch (e) { console.error(e); }
}

window.filterAgentsJournal = filterAgentsJournal;
window.loadAgentJournal = loadAgentJournal;
window.loadServerJournal = loadServerJournal;

// --- i18n & Multi-language Support ---
const i18n = {
    ar: {
        dashboard: "الرئيسية",
        sims: "إدارة الشرائح",
        modem_ip_control: "التحكم بالشرائح IP",
        cards: "بطاقات إيدوم",
        agents: "إدارة الوكلاء",
        journal_agents: "سجل الزبائن (Journal)",
        journal_server: "سجل السيرفر (Server)",
        bot_manager: "البوت (Autre Paramètre)",
        settings: "الإعدادات",
        ooredoo_bal: "رصيد أوريدو",
        djezzy_bal: "رصيد جيزي",
        mobilis_bal: "رصيد موبيليس",
        active_agents: "الوكلاء النشطين",
        recent_flexy: "آخر عمليات الفليكسي",
        bot_control: "التحكم في البوت (Autre Paramètre)",
        broadcast: "إرسال جماعي (Broadcast)",
        idoom_auto: "تعبئة إيدوم التلقائية (Automation Terminal)",
        server_connected: "الخادم متصل",
        server_disconnected: "الخادم غير متصل",
        add_sim: "إضافة شريحة",
        add_card: "إضافة بطاقة",
        upload_file: "رفع ملف",
        update: "تحديث",
        block_net: "عزل الإنترنت"
    },
    fr: {
        dashboard: "Accueil",
        sims: "Gestion SIMs",
        modem_ip_control: "Contrôle SIMs IP",
        cards: "Cartes Idoom",
        agents: "Gestion Agents",
        journal_agents: "Journal Clients",
        journal_server: "Journal Serveur",
        bot_manager: "Bot & Paramètres",
        settings: "Paramètres",
        ooredoo_bal: "Solde Ooredoo",
        djezzy_bal: "Solde Djezzy",
        mobilis_bal: "Solde Mobilis",
        active_agents: "Agents Actifs",
        recent_flexy: "Dernières Recharges Flexy",
        bot_control: "Contrôle du Bot (Autre Paramètre)",
        broadcast: "Diffusion de Masse (Broadcast)",
        idoom_auto: "Recharge Automatique Idoom (Automation Terminal)",
        server_connected: "Serveur Connecté",
        server_disconnected: "Serveur Déconnecté",
        add_sim: "Ajouter SIM",
        add_card: "Ajouter Carte",
        upload_file: "Importer Fichier",
        update: "Mettre à jour",
        block_net: "Isoler Internet"
    }
};

let currentLang = 'ar';

async function loadDashboardStats() {
    try {
        const stats = await apiCall('get-dashboard-stats');
        
        // Handle French translations for stats suffixes if French is selected
        if (currentLang === 'fr') {
            document.getElementById('stat-ooredoo-balance').innerText = stats.ooredoo.replace('دج', 'DA');
            document.getElementById('stat-djezzy-balance').innerText = stats.djezzy.replace('دج', 'DA');
            document.getElementById('stat-mobilis-balance').innerText = stats.mobilis.replace('دج', 'DA');
            document.getElementById('stat-active-agents').innerText = stats.agents.replace('وكيل', 'agents');
        } else {
            document.getElementById('stat-ooredoo-balance').innerText = stats.ooredoo;
            document.getElementById('stat-djezzy-balance').innerText = stats.djezzy;
            document.getElementById('stat-mobilis-balance').innerText = stats.mobilis;
            document.getElementById('stat-active-agents').innerText = stats.agents;
        }
    } catch(e) {
        console.error(e);
    }
}

function changeLanguage(lang) {
    currentLang = lang;
    localStorage.setItem('dashboard_lang', lang);
    
    // Switch document direction based on language
    if (lang === 'fr') {
        document.documentElement.setAttribute('dir', 'ltr');
        document.documentElement.setAttribute('lang', 'fr');
        const container = document.querySelector('.dashboard-container');
        if (container) container.style.flexDirection = 'row';
    } else {
        document.documentElement.setAttribute('dir', 'rtl');
        document.documentElement.setAttribute('lang', 'ar');
        const container = document.querySelector('.dashboard-container');
        if (container) container.style.flexDirection = 'row';
    }
    
    // Update all elements that have data-i18n attribute
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (i18n[lang][key]) {
            const icon = el.querySelector('i');
            if (icon) {
                el.innerHTML = '';
                el.appendChild(icon);
                el.appendChild(document.createTextNode(' ' + i18n[lang][key]));
            } else {
                el.innerText = i18n[lang][key];
            }
        }
    });
    
    // Refresh stats
    loadDashboardStats();
}

window.changeLanguage = changeLanguage;
window.loadDashboardStats = loadDashboardStats;

// Load initial data
document.addEventListener('DOMContentLoaded', () => {
    loadLogs();
    loadDashboardStats();
    
    // Auto-test Ahla Connection
    testAhlaConnection();
    
    // Load language preference if saved
    const savedLang = localStorage.getItem('dashboard_lang') || 'ar';
    const langSelect = document.getElementById('langSelector');
    if (langSelect) {
        langSelect.value = savedLang;
    }
    changeLanguage(savedLang);
});

ipcRenderer.on('sims-updated', () => {
    loadSims();
});

ipcRenderer.on('sim-data-fast-update', (event, data) => {
    // Fast UI update for specific SIM
    if (data.balance) {
        // Safe check for new rendering structure
        const card = document.getElementById(`sim-card-${data.simId}`);
        if (card) {
            const balanceEl = card.querySelector('.balance');
            if (balanceEl) {
                balanceEl.innerHTML = `الرصيد: ${data.balance} دج`;
            }
        }
    }
    // Always refresh history for this SIM
    loadSimMiniHistory(data.simId);
});

async function fixModemRouting(simId, address, btnElement) {
    const originalContent = btnElement.innerHTML;
    try {
        btnElement.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ...`;
        btnElement.disabled = true;
        
        const result = await apiCall('fix-modem-routing', { simId, address });
        
        if (result.success) {
            btnElement.style.background = 'rgba(16, 185, 129, 0.15)';
            btnElement.style.borderColor = 'rgba(16, 185, 129, 0.4)';
            btnElement.style.color = '#10b981';
            btnElement.innerHTML = `<i class="fas fa-shield-alt"></i> ${currentLang === 'fr' ? 'Isolé' : 'معزول'}`;
            alert(result.message);
        } else {
            btnElement.innerHTML = originalContent;
            btnElement.disabled = false;
            alert(result.message);
        }
    } catch (e) {
        btnElement.innerHTML = originalContent;
        btnElement.disabled = false;
        alert('حدث خطأ: ' + e.message);
    }
}
window.fixModemRouting = fixModemRouting;

// --- IP Modem Control Functions ---
function switchIpControlSubView(view) {
    const home = document.getElementById('ip-gateway-home');
    const ussd = document.getElementById('ip-ussd-panel');
    const sms = document.getElementById('ip-sms-panel');
    const call = document.getElementById('ip-call-panel');
    
    if (home) home.style.display = 'none';
    if (ussd) ussd.style.display = 'none';
    if (sms) sms.style.display = 'none';
    if (call) call.style.display = 'none';
    
    if (view === 'home' && home) home.style.display = 'block';
    if (view === 'ussd' && ussd) ussd.style.display = 'block';
    if (view === 'sms' && sms) sms.style.display = 'block';
    if (view === 'call' && call) call.style.display = 'block';
}

function setQuickUssdIpCode(code) {
    const input = document.getElementById('ip_ussd_code');
    if (input) input.value = code;
}

function appendToIpUssdLog(text, isError = false) {
    const consoleEl = document.getElementById('ipUssdLogs');
    if (!consoleEl) return;
    
    const div = document.createElement('div');
    div.style.marginBottom = '6px';
    if (isError) {
        div.style.color = '#f87171'; // light red
    } else {
        div.style.color = '#38bdf8'; // light blue
    }
    
    const time = new Date().toLocaleTimeString();
    div.innerText = `[${time}] ${text}`;
    consoleEl.appendChild(div);
    consoleEl.scrollTop = consoleEl.scrollHeight;
}

async function executeIpUssd() {
    const ip = document.getElementById('ip_ussd_modem_ip').value.trim();
    const code = document.getElementById('ip_ussd_code').value.trim();
    const btn = document.getElementById('btnExecuteIpUssd');
    
    if (!ip) {
        alert('⚠️ الرجاء إدخال عنوان الـ IP الخاص بالمودم!');
        return;
    }
    if (!code) {
        alert('⚠️ الرجاء إدخال كود USSD لتشغيله!');
        return;
    }
    
    const originalText = btn.innerHTML;
    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> جاري التشغيل...`;
    btn.disabled = true;
    
    appendToIpUssdLog(`جاري إرسال طلب USSD [${code}] إلى المودم ${ip}...`);
    
    try {
        const result = await apiCall('execute-raw-ussd', { ip, code });
        
        if (result.success) {
            appendToIpUssdLog(`✅ تم الاستلام بنجاح من المودم:`);
            appendToIpUssdLog(`>>> ${result.content}`);
        } else {
            appendToIpUssdLog(`❌ فشل الطلب: ${result.message || 'خطأ غير معروف'}`, true);
        }
    } catch (e) {
        appendToIpUssdLog(`❌ حدث خطأ أثناء الاتصال: ${e.message}`, true);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

async function refreshIpSmsList() {
    const ip = document.getElementById('ip_sms_modem_ip').value.trim();
    const btn = document.getElementById('btnRefreshIpSms');
    const container = document.getElementById('ipSmsInboxList');
    
    if (!ip) {
        alert('⚠️ الرجاء إدخال عنوان الـ IP أولاً!');
        return;
    }
    
    const originalText = btn.innerHTML;
    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> جاري التحميل...`;
    btn.disabled = true;
    
    container.innerHTML = `<div style="text-align: center; color: var(--text-muted); margin-top: 90px; font-size: 13.5px;"><i class="fas fa-spinner fa-spin"></i> جاري الاتصال بالمودم وجلب الرسائل الواردة...</div>`;
    
    try {
        const result = await apiCall('get-ip-sms-list', { ip });
        
        if (result.success) {
            const list = result.list || [];
            if (list.length === 0) {
                container.innerHTML = `<div style="text-align: center; color: var(--text-muted); margin-top: 90px; font-size: 13.5px;">📭 صندوق الوارد فارغ. لا توجد رسائل على هذه الشريحة حالياً.</div>`;
            } else {
                container.innerHTML = '';
                list.forEach(msg => {
                    const item = document.createElement('div');
                    item.style.background = 'var(--panel-bg)';
                    item.style.border = '1px solid var(--border-color)';
                    item.style.borderRadius = '10px';
                    item.style.padding = '12px';
                    item.style.marginBottom = '10px';
                    item.style.boxShadow = '0 2px 6px rgba(0,0,0,0.02)';
                    
                    item.innerHTML = `
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; border-bottom: 1px dashed var(--border-color); padding-bottom: 4px;">
                            <span style="font-weight: 700; color: var(--primary); font-size: 13px;"><i class="fas fa-phone-alt"></i> ${msg.phone}</span>
                            <span style="font-size: 11.5px; color: var(--text-muted);"><i class="far fa-clock"></i> ${msg.date}</span>
                        </div>
                        <div style="font-size: 13px; color: var(--text-main); line-height: 1.5; white-space: pre-wrap; text-align: right; direction: rtl;">${msg.content}</div>
                    `;
                    container.appendChild(item);
                });
            }
        } else {
            container.innerHTML = `<div style="text-align: center; color: var(--danger); margin-top: 90px; font-size: 13.5px;"><i class="fas fa-exclamation-triangle"></i> فشل جلب الرسائل: ${result.message || 'تأكد من عنوان IP والاتصال بالشبكة.'}</div>`;
        }
    } catch (e) {
        container.innerHTML = `<div style="text-align: center; color: var(--danger); margin-top: 90px; font-size: 13.5px;"><i class="fas fa-exclamation-triangle"></i> خطأ في الاتصال: ${e.message}</div>`;
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

async function sendIpSms() {
    const ip = document.getElementById('ip_sms_modem_ip').value.trim();
    const recipient = document.getElementById('ip_sms_recipient').value.trim();
    const text = document.getElementById('ip_sms_text').value.trim();
    const btn = document.getElementById('btnSendIpSms');
    
    if (!ip) {
        alert('⚠️ الرجاء إدخال عنوان الـ IP الخاص بالمودم!');
        return;
    }
    if (!recipient) {
        alert('⚠️ الرجاء إدخال رقم هاتف المستلم!');
        return;
    }
    if (!text) {
        alert('⚠️ الرجاء إدخال نص الرسالة المراد إرسالها!');
        return;
    }
    
    const originalText = btn.innerHTML;
    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> جاري الإرسال...`;
    btn.disabled = true;
    
    try {
        const result = await apiCall('send-ip-sms', { ip, recipient, text });
        
        if (result.success) {
            alert('✅ تم إرسال الرسالة بنجاح عبر الشريحة!');
            document.getElementById('ip_sms_recipient').value = '';
            document.getElementById('ip_sms_text').value = '';
        } else {
            alert(`❌ فشل إرسال الرسالة: ${result.message || 'خطأ غير معروف'}`);
        }
    } catch (e) {
        alert(`❌ حدث خطأ أثناء الاتصال: ${e.message}`);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

// Make functions globally accessible for inline HTML onclick handlers
window.switchIpControlSubView = switchIpControlSubView;
window.setQuickUssdIpCode = setQuickUssdIpCode;
window.executeIpUssd = executeIpUssd;
window.refreshIpSmsList = refreshIpSmsList;
window.sendIpSms = sendIpSms;

async function dialIpCall() {
    const ip = document.getElementById('ip_call_modem_ip').value.trim();
    const number = document.getElementById('ip_call_number').value.trim();
    const btn = document.getElementById('btnDialCall');
    
    if (!ip) {
        alert('⚠️ الرجاء إدخال عنوان الـ IP أو المنفذ!');
        return;
    }
    if (!number) {
        alert('⚠️ الرجاء إدخال رقم الهاتف للاتصال به!');
        return;
    }
    
    const originalText = btn.innerHTML;
    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> جاري الاتصال...`;
    btn.disabled = true;
    
    appendToIpCallLog(`جاري طلب الرقم [${number}] عبر المودم ${ip}...`);
    
    try {
        const result = await apiCall('dial-number', { ip, number });
        
        if (result.success) {
            appendToIpCallLog(`✅ تم إرسال أمر الاتصال بنجاح. الخط الآن نشط/يرن.`);
        } else {
            appendToIpCallLog(`❌ فشل الطلب: ${result.message || 'خطأ غير معروف'}`, true);
        }
    } catch (e) {
        appendToIpCallLog(`❌ حدث خطأ أثناء الاتصال: ${e.message}`, true);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

async function hangupIpCall() {
    const ip = document.getElementById('ip_call_modem_ip').value.trim();
    const btn = document.getElementById('btnHangupCall');
    
    if (!ip) {
        alert('⚠️ الرجاء إدخال عنوان الـ IP أو المنفذ!');
        return;
    }
    
    const originalText = btn.innerHTML;
    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> جاري الإنهاء...`;
    btn.disabled = true;
    
    appendToIpCallLog(`جاري إرسال طلب إنهاء المكالمة إلى ${ip}...`);
    
    try {
        const result = await apiCall('hangup-call', { ip });
        
        if (result.success) {
            appendToIpCallLog(`✅ تم إنهاء المكالمة بنجاح (Call Hangup Successful).`);
        } else {
            appendToIpCallLog(`❌ فشل الطلب: ${result.message || 'خطأ غير معروف'}`, true);
        }
    } catch (e) {
        appendToIpCallLog(`❌ حدث خطأ أثناء الاتصال: ${e.message}`, true);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

function setQuickCallNumber(number) {
    const input = document.getElementById('ip_call_number');
    if (input) input.value = number;
}

function appendToIpCallLog(text, isError = false) {
    const consoleEl = document.getElementById('ipCallLogs');
    if (!consoleEl) return;
    
    const div = document.createElement('div');
    div.style.marginBottom = '6px';
    if (isError) {
        div.style.color = '#ef4444'; // red
    } else {
        div.style.color = '#a78bfa'; // violet
    }
    
    const time = new Date().toLocaleTimeString();
    div.innerText = `[${time}] ${text}`;
    consoleEl.appendChild(div);
    consoleEl.scrollTop = consoleEl.scrollHeight;
}

window.dialIpCall = dialIpCall;
window.hangupIpCall = hangupIpCall;
window.setQuickCallNumber = setQuickCallNumber;
window.appendToIpCallLog = appendToIpCallLog;

// ==========================================
// MOBILIS MEETMOB AUTOMATION DASHBOARD HANDLERS
// ==========================================

async function loadMeetmobSettings() {
    try {
        const settings = await apiCall('get-settings');
        const phoneRow = settings.find(s => s.key === 'meetmob_phone');
        const pinRow = settings.find(s => s.key === 'meetmob_pin');
        const modemRow = settings.find(s => s.key === 'meetmob_modem');

        if (phoneRow) document.getElementById('meetmob_user_phone').value = phoneRow.value;
        if (pinRow) document.getElementById('meetmob_user_pin').value = pinRow.value;
        if (modemRow) document.getElementById('meetmob_sms_modem').value = modemRow.value;
        
        appendMeetmobLog("🔄 تم تحميل إعدادات Meetmob بنجاح.");
    } catch (e) {
        appendMeetmobLog(`❌ فشل تحميل الإعدادات: ${e.message}`);
    }
}

async function saveMeetmobSettings() {
    const phone = document.getElementById('meetmob_user_phone').value.trim();
    const pin = document.getElementById('meetmob_user_pin').value.trim();
    const modem = document.getElementById('meetmob_sms_modem').value.trim();

    if (!phone || !pin || !modem) {
        alert('⚠️ يرجى ملء جميع الحقول لحفظ إعدادات بوابة Meetmob!');
        return;
    }

    const settingsArray = [
        { key: 'meetmob_phone', value: phone },
        { key: 'meetmob_pin', value: pin },
        { key: 'meetmob_modem', value: modem }
    ];

    try {
        const result = await apiCall('save-settings', settingsArray);
        if (result.success) {
            alert('✅ تم حفظ إعدادات Meetmob بنجاح!');
            appendMeetmobLog("💾 تم حفظ البيانات الجديدة بنجاح.");
        }
    } catch (e) {
        alert('❌ حدث خطأ أثناء حفظ الإعدادات: ' + e.message);
    }
}

async function startMeetmobLogin() {
    const phone = document.getElementById('meetmob_user_phone').value.trim();
    const pin = document.getElementById('meetmob_user_pin').value.trim();
    const modem = document.getElementById('meetmob_sms_modem').value.trim();

    if (!phone || !pin || !modem) {
        alert('⚠️ يرجى ملء جميع حقول الإعدادات وتأكيد حفظها أولاً!');
        return;
    }

    const btn = document.getElementById('btnMeetmobLogin');
    const originalText = btn.innerHTML;
    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> جاري الاتصال...`;
    btn.disabled = true;

    appendMeetmobLog("🌐 جاري تشغيل المتصفح والاتصال بموقع Meetmob Mobilis...");
    
    // Reset indicators
    document.getElementById('meetmob_status_text').innerText = "جاري طلب OTP...";
    document.getElementById('meetmob_status_text').style.color = "var(--warning)";
    document.getElementById('meetmob_login_status').querySelector('.status-indicator').style.backgroundColor = "var(--warning)";
    document.getElementById('meetmob_login_status').querySelector('.status-indicator').style.boxShadow = "0 0 8px var(--warning)";

    try {
        const res = await fetch('http://localhost:3000/meetmob/send-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, pin, modemAddress: modem })
        });
        const result = await res.json();

        if (result.success) {
            if (result.loggedIn) {
                // Success!
                document.getElementById('meetmob_status_text').innerText = "متصل 🟢";
                document.getElementById('meetmob_status_text').style.color = "var(--success)";
                document.getElementById('meetmob_login_status').querySelector('.status-indicator').style.backgroundColor = "var(--success)";
                document.getElementById('meetmob_login_status').querySelector('.status-indicator').style.boxShadow = "0 0 8px var(--success)";
                
                appendMeetmobLog(`🎉 ${result.message}`);
                appendMeetmobLog(`🔑 كود OTP المكتشف تلقائياً: ${result.otp}`);
                
                // Fetch captcha immediately
                refreshMeetmobCaptcha();
            } else {
                // Sent, wait for manual input
                document.getElementById('meetmob_status_text').innerText = "بانتظار رمز OTP يدوياً...";
                appendMeetmobLog(`💬 ${result.message}`);
            }
        } else {
            throw new Error(result.message);
        }
    } catch (e) {
        document.getElementById('meetmob_status_text').innerText = "فشل الاتصال 🔴";
        document.getElementById('meetmob_status_text').style.color = "var(--danger)";
        document.getElementById('meetmob_login_status').querySelector('.status-indicator').style.backgroundColor = "var(--danger)";
        document.getElementById('meetmob_login_status').querySelector('.status-indicator').style.boxShadow = "0 0 8px var(--danger)";
        
        appendMeetmobLog(`❌ خطأ أثناء تسجيل الدخول: ${e.message}`);
        alert('❌ فشل تسجيل الدخول: ' + e.message);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

async function verifyMeetmobOtp() {
    const otp = document.getElementById('meetmob_manual_otp').value.trim();
    if (!otp) {
        alert('⚠️ الرجاء إدخال رمز الـ OTP أولاً!');
        return;
    }

    const btn = document.getElementById('btnMeetmobVerifyOtp');
    const originalText = btn.innerHTML;
    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i>`;
    btn.disabled = true;

    appendMeetmobLog(`⏳ جاري إرسال كود OTP المدخل يدوياً [${otp}] للتحقق...`);

    try {
        const res = await fetch('http://localhost:3000/meetmob/verify-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ otp })
        });
        const result = await res.json();

        if (result.success) {
            document.getElementById('meetmob_status_text').innerText = "متصل 🟢";
            document.getElementById('meetmob_status_text').style.color = "var(--success)";
            document.getElementById('meetmob_login_status').querySelector('.status-indicator').style.backgroundColor = "var(--success)";
            document.getElementById('meetmob_login_status').querySelector('.status-indicator').style.boxShadow = "0 0 8px var(--success)";
            
            appendMeetmobLog(`🎉 ${result.message}`);
            
            // Clean OTP input
            document.getElementById('meetmob_manual_otp').value = '';
            
            // Fetch captcha
            refreshMeetmobCaptcha();
        } else {
            throw new Error(result.message);
        }
    } catch (e) {
        appendMeetmobLog(`❌ فشل التحقق من الكود: ${e.message}`);
        alert('❌ كود غير صحيح: ' + e.message);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

async function refreshMeetmobCaptcha() {
    const img = document.getElementById('meetmob_captcha_img');
    const loading = document.getElementById('meetmob_captcha_loading');
    
    img.style.display = 'none';
    loading.style.display = 'block';
    loading.innerHTML = `<i class="fas fa-spinner fa-spin"></i> جاري تحديث الكابتشا...`;

    appendMeetmobLog("🖼️ جاري استخراج كود الكابتشا من صفحة الشحن...");

    try {
        const res = await fetch('http://localhost:3000/meetmob/captcha');
        const result = await res.json();

        if (result.success && result.captcha) {
            img.src = result.captcha;
            img.style.display = 'block';
            loading.style.display = 'none';
            appendMeetmobLog("✅ تم تحميل صورة الكابتشا بنجاح.");
        } else {
            throw new Error(result.message || "كود كابتشا غير متوفر");
        }
    } catch (e) {
        loading.innerHTML = `<i class="fas fa-exclamation-triangle" style="color:var(--danger)"></i> فشل التحميل`;
        appendMeetmobLog(`⚠️ فشل جلب الكابتشا: ${e.message}`);
    }
}

async function executeMeetmobRecharge() {
    const customerPhone = document.getElementById('meetmob_recharge_phone').value.trim();
    const voucherCode = document.getElementById('meetmob_recharge_pin').value.trim();
    const captchaCode = document.getElementById('meetmob_recharge_captcha').value.trim();

    if (!customerPhone || !voucherCode || !captchaCode) {
        alert('⚠️ يرجى ملء جميع حقول الشحن (الهاتف، كود البطاقة، ورمز الكابتشا)!');
        return;
    }

    const cleanPhone = customerPhone.replace(/^0/, '');

    const btn = document.getElementById('btnMeetmobExecute');
    const originalText = btn.innerHTML;
    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> جاري شحن البطاقة...`;
    btn.disabled = true;

    appendMeetmobLog(`⚡ جاري إرسال طلب الشحن: الرقم ${cleanPhone} | كود البطاقة: ${voucherCode}...`);

    try {
        const res = await fetch('http://localhost:3000/meetmob/recharge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ customerPhone: cleanPhone, voucherCode, captchaCode })
        });
        const result = await res.json();

        if (result.success) {
            appendMeetmobLog(`🎉 نجاح العملية: ${result.message}`);
            alert(`🎉 تم شحن البطاقة بنجاح للرقم ${customerPhone}!\nالرد: ${result.message}`);
            
            // Clean inputs
            document.getElementById('meetmob_recharge_phone').value = '';
            document.getElementById('meetmob_recharge_pin').value = '';
            document.getElementById('meetmob_recharge_captcha').value = '';
            
            // Auto refresh captcha for next operation
            refreshMeetmobCaptcha();
        } else {
            throw new Error(result.message);
        }
    } catch (e) {
        appendMeetmobLog(`❌ فشل الشحن: ${e.message}`);
        alert('❌ فشلت عملية شحن البطاقة: ' + e.message);
        
        // Refresh captcha for retry
        refreshMeetmobCaptcha();
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

function appendMeetmobLog(text) {
    const meetmobLogs = document.getElementById('meetmobLogs');
    if (meetmobLogs) {
        const line = document.createElement('div');
        line.style.marginBottom = '6px';
        line.innerText = `> ${text}`;
        if (text.toLowerCase().includes('success') || text.includes('🎉') || text.includes('نجاح')) line.style.color = '#10b981';
        if (text.toLowerCase().includes('error') || text.includes('❌') || text.includes('فشل')) line.style.color = '#ef4444';
        if (text.includes('💡') || text.includes('🔄')) line.style.color = '#38bdf8';
        
        meetmobLogs.appendChild(line);
        meetmobLogs.scrollTop = meetmobLogs.scrollHeight;
        
        if (meetmobLogs.children.length > 100) {
            meetmobLogs.removeChild(meetmobLogs.firstChild);
        }
    }
}

// Bind meetmob window event handlers
window.loadMeetmobSettings = loadMeetmobSettings;
window.saveMeetmobSettings = saveMeetmobSettings;
window.startMeetmobLogin = startMeetmobLogin;
window.verifyMeetmobOtp = verifyMeetmobOtp;
window.refreshMeetmobCaptcha = refreshMeetmobCaptcha;
window.executeMeetmobRecharge = executeMeetmobRecharge;
window.appendMeetmobLog = appendMeetmobLog;

// --- Pending Bot Captchas Real-time UI Handler ---
ipcRenderer.on('pending-captcha', (event, data) => {
    const panel = document.getElementById('meetmob-pending-captchas-panel');
    const img = document.getElementById('meetmob_pending_captcha_img');
    const phoneSpan = document.getElementById('meetmob_pending_captcha_phone');
    const idInput = document.getElementById('meetmob_pending_captcha_id');
    const codeInput = document.getElementById('meetmob_pending_captcha_input');

    if (panel && img && phoneSpan && idInput) {
        idInput.value = data.id;
        phoneSpan.innerText = `الرقم: ${data.phone}`;
        img.src = `data:image/png;base64,${data.image}`;
        img.style.display = 'block';
        if (codeInput) {
            codeInput.value = '';
            codeInput.focus();
        }
        panel.style.display = 'block';
        appendMeetmobLog(`⚠️ رمز كابتشا معلق للرقم ${data.phone}. بانتظار الإدخال...`);
    }
});

ipcRenderer.on('pending-captcha-solved', (event, data) => {
    const panel = document.getElementById('meetmob-pending-captchas-panel');
    const idInput = document.getElementById('meetmob_pending_captcha_id');
    if (panel && idInput && idInput.value === data.id) {
        panel.style.display = 'none';
        idInput.value = '';
        appendMeetmobLog(`✅ تم حل رمز الكابتشا المعلق بنجاح.`);
    }
});

// Real-time automatic offers refresh
ipcRenderer.on('sim-offers-updated', () => {
    loadSimOffers();
});

async function submitPendingCaptcha() {
    const idInput = document.getElementById('meetmob_pending_captcha_id');
    const codeInput = document.getElementById('meetmob_pending_captcha_input');
    
    if (!idInput || !idInput.value) {
        alert('لا توجد عملية شحن معلقة حالياً.');
        return;
    }
    
    const captchaCode = codeInput ? codeInput.value.trim() : '';
    if (!captchaCode) {
        alert('الرجاء إدخال رمز الكابتشا أولاً.');
        return;
    }
    
    try {
        const result = await apiCall('submit-captcha', { id: idInput.value, captchaCode });
        if (result.success) {
            const panel = document.getElementById('meetmob-pending-captchas-panel');
            if (panel) panel.style.display = 'none';
            idInput.value = '';
            if (codeInput) codeInput.value = '';
            appendMeetmobLog(`✅ تم إرسال رمز الكابتشا: ${captchaCode}`);
        } else {
            alert('فشل تأكيد الكابتشا: ' + (result.message || 'انتهت صلاحية الجلسة أو تم حلها بالفعل.'));
        }
    } catch (err) {
        console.error(err);
        alert('حدث خطأ أثناء إرسال كود الكابتشا.');
    }
}

// Bind to window context
window.submitPendingCaptcha = submitPendingCaptcha;


// --- SIM Offers Management Logic ---
let allSimOffers = [];
let currentOffersFilter = 'All';

async function loadSimOffers() {
    try {
        allSimOffers = await apiCall('get-sim-offers');
        renderSimOffers();
    } catch (e) {
        console.error('Error loading SIM offers:', e);
    }
}

function renderSimOffers() {
    const tbody = document.getElementById('offersTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const filteredOffers = allSimOffers.filter(o => 
        currentOffersFilter === 'All' || o.operator.toLowerCase() === currentOffersFilter.toLowerCase()
    );

    if (filteredOffers.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 40px; color: var(--text-muted);">
                    <i class="fas fa-box-open" style="font-size: 40px; margin-bottom: 12px; color: var(--primary); display: block;"></i>
                    <div>لا توجد عروض مضافة لمجموعة الفلتر الحالية.</div>
                </td>
            </tr>
        `;
        return;
    }

    filteredOffers.forEach(o => {
        const tr = document.createElement('tr');
        
        let opStyle = 'padding: 4px 10px; border-radius: 20px; font-size: 11.5px; font-weight: bold; display: inline-block; text-transform: uppercase;';
        if (o.operator.toLowerCase() === 'mobilis') {
            opStyle += ' background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.25);';
        } else if (o.operator.toLowerCase() === 'djezzy') {
            opStyle += ' background: rgba(14, 165, 233, 0.15); color: #0ea5e9; border: 1px solid rgba(14, 165, 233, 0.25);';
        } else if (o.operator.toLowerCase() === 'ooredoo') {
            opStyle += ' background: rgba(244, 63, 94, 0.15); color: #f43f5e; border: 1px solid rgba(244, 63, 94, 0.25);';
        } else {
            opStyle += ' background: rgba(255, 255, 255, 0.1); color: var(--text-color); border: 1px solid rgba(255, 255, 255, 0.15);';
        }

        tr.innerHTML = `
            <td><strong>#${o.id}</strong></td>
            <td><span style="${opStyle}">${o.operator}</span></td>
            <td><span style="font-weight: 600; color: var(--text-color);">${o.name}</span></td>
            <td><code style="font-family: 'JetBrains Mono', monospace; font-size: 13px; color: var(--accent); background: rgba(255,255,255,0.05); padding: 3px 8px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.05);">${o.ussd_code}</code></td>
            <td><strong style="color: #10B981; font-family: 'JetBrains Mono', monospace;">${o.price} دج</strong></td>
            <td><span style="font-size: 13px; color: var(--text-muted);">${o.description || 'لا توجد تفاصيل'}</span></td>
            <td>
                <div style="display: flex; gap: 8px; justify-content: center;">
                    <button class="btn primary small" onclick="openSimOfferModal(${o.id})"><i class="fas fa-edit"></i> تعديل</button>
                    <button class="btn danger small" onclick="deleteSimOffer(${o.id})"><i class="fas fa-trash"></i> حذف</button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function filterSimOffers(operator) {
    currentOffersFilter = operator;
    
    // Update buttons active class
    const navButtons = document.querySelectorAll('.offers-operators-nav button');
    navButtons.forEach(btn => {
        btn.classList.remove('active');
        if (btn.getAttribute('data-op') === operator) {
            btn.classList.add('active');
        }
    });
    
    renderSimOffers();
}

function openSimOfferModal(offerId = null) {
    const title = document.getElementById('offerModalTitle');
    const idInput = document.getElementById('editOfferId');
    const opSelect = document.getElementById('offerOperator');
    const nameInput = document.getElementById('offerName');
    const codeInput = document.getElementById('offerUssdCode');
    const priceInput = document.getElementById('offerPrice');
    const descInput = document.getElementById('offerDescription');

    if (offerId) {
        const offer = allSimOffers.find(o => o.id === offerId);
        if (offer) {
            title.innerText = 'تعديل عرض الشريحة';
            idInput.value = offer.id;
            opSelect.value = offer.operator;
            nameInput.value = offer.name;
            codeInput.value = offer.ussd_code;
            priceInput.value = offer.price;
            descInput.value = offer.description || '';
        }
    } else {
        title.innerText = 'إضافة عرض شريحة جديد';
        idInput.value = '';
        opSelect.value = 'Mobilis';
        nameInput.value = '';
        codeInput.value = '';
        priceInput.value = '';
        descInput.value = '';
    }
    showModal('addSimOfferModal');
}

async function saveSimOffer() {
    const id = document.getElementById('editOfferId').value;
    const operator = document.getElementById('offerOperator').value;
    const name = document.getElementById('offerName').value.trim();
    const ussd_code = document.getElementById('offerUssdCode').value.trim();
    const price = parseFloat(document.getElementById('offerPrice').value);
    const description = document.getElementById('offerDescription').value.trim();

    if (!name || !ussd_code || isNaN(price)) {
        alert('يرجى ملء جميع الحقول بشكل صحيح!');
        return;
    }

    const offerData = { operator, name, ussd_code, price, description };

    try {
        let result;
        if (id) {
            offerData.id = parseInt(id);
            result = await apiCall('update-sim-offer', offerData);
        } else {
            result = await apiCall('add-sim-offer', offerData);
        }
        
        if (result && !result.success) {
            alert('⚠️ ' + result.message);
            return;
        }
        
        hideModal('addSimOfferModal');
        loadSimOffers();
    } catch (e) {
        console.error(e);
        alert('حدث خطأ أثناء حفظ عرض الشريحة.');
    }
}

async function deleteSimOffer(offerId) {
    if (!confirm('هل أنت متأكد من حذف هذا العرض نهائياً؟')) return;
    try {
        await apiCall('delete-sim-offer', offerId);
        loadSimOffers();
    } catch (e) {
        console.error(e);
        alert('حدث خطأ أثناء حذف عرض الشريحة.');
    }
}

// Bind to window context for HTML onclick attributes
window.loadSimOffers = loadSimOffers;
window.filterSimOffers = filterSimOffers;
window.openSimOfferModal = openSimOfferModal;
window.saveSimOffer = saveSimOffer;
window.deleteSimOffer = deleteSimOffer;

function openAgentModal(mode, agent = null) {
    document.getElementById('agentModalAction').value = mode;
    if (mode === 'add') {
        document.getElementById('agentModalTitle').innerText = 'إضافة زبون جديد';
        document.getElementById('agentModalId').value = '';
        document.getElementById('agentModalName').value = '';
        document.getElementById('agentModalTelegramId').value = '';
        document.getElementById('agentModalPhone').value = '';
        if (document.getElementById('agentModalTier')) document.getElementById('agentModalTier').value = 'detaillant';
    } else {
        document.getElementById('agentModalTitle').innerText = 'تعديل بيانات الزبون';
        document.getElementById('agentModalId').value = agent.id;
        document.getElementById('agentModalName').value = agent.name;
        document.getElementById('agentModalTelegramId').value = agent.telegram_id;
        document.getElementById('agentModalPhone').value = agent.phone_number;
        if (document.getElementById('agentModalTier')) document.getElementById('agentModalTier').value = agent.tier || 'detaillant';
    }
    showModal('agentModal');
}

async function saveAgent() {
    const action = document.getElementById('agentModalAction').value;
    const id = document.getElementById('agentModalId').value;
    const name = document.getElementById('agentModalName').value.trim();
    const telegram_id = document.getElementById('agentModalTelegramId').value.trim();
    const phone_number = document.getElementById('agentModalPhone').value.trim();
    const tier = document.getElementById('agentModalTier') ? document.getElementById('agentModalTier').value : 'detaillant';
    
    if (!name) {
        alert('يرجى إدخال اسم الزبون.');
        return;
    }
    
    try {
        let result;
        if (action === 'add') {
            result = await apiCall('add-agent', { name, telegram_id, phone_number, tier });
        } else {
            result = await apiCall('update-agent', { id, name, telegram_id, phone_number, tier });
        }
        
        if (result.success) {
            hideModal('agentModal');
            loadAgents();
            alert(action === 'add' ? 'تم إضافة الزبون بنجاح.' : 'تم تعديل بيانات الزبون بنجاح.');
        } else {
            alert('فشلت العملية: ' + result.message);
        }
    } catch (e) {
        console.error(e);
        alert('حدث خطأ أثناء حفظ بيانات الزبون.');
    }
}

async function deleteAgent(id, name) {
    if (!confirm(`هل أنت متأكد من حذف الزبون "${name}" نهائياً؟\nسيتم إزالة كافة صلاحياته ورصيده من النظام!`)) return;
    try {
        const result = await apiCall('delete-agent', id);
        if (result.success) {
            loadAgents();
            alert('تم حذف الزبون بنجاح.');
        } else {
            alert('فشلت العملية: ' + result.message);
        }
    } catch (e) {
        console.error(e);
        alert('حدث خطأ أثناء حذف الزبون.');
    }
}

window.openAgentModal = openAgentModal;
window.saveAgent = saveAgent;
window.deleteAgent = deleteAgent;

function openAgentOptionsModal(agent) {
    document.getElementById('agentOptionsId').value = agent.id;
    document.getElementById('agentOptionsStatus').value = agent.status;
    document.getElementById('agentOptionsRole').value = agent.role;
    document.getElementById('agentOptionsTier').value = agent.tier;
    
    // Clear checkboxes
    document.querySelectorAll('.service-checkbox').forEach(cb => cb.checked = false);
    
    // Set checked if in disabled_services
    if (agent.disabled_services) {
        const disabled = agent.disabled_services.split(',');
        document.querySelectorAll('.service-checkbox').forEach(cb => {
            if (disabled.includes(cb.value)) {
                cb.checked = true;
            }
        });
    }
    
    showModal('agentOptionsModal');
}

async function saveAgentOptions() {
    const id = document.getElementById('agentOptionsId').value;
    const status = document.getElementById('agentOptionsStatus').value;
    const role = document.getElementById('agentOptionsRole').value;
    const tier = document.getElementById('agentOptionsTier').value;
    
    const disabled_services = Array.from(document.querySelectorAll('.service-checkbox:checked')).map(cb => cb.value).join(',');
    
    try {
        const result = await apiCall('update-agent-options', { id, status, role, tier, disabled_services });
        if (result.success) {
            hideModal('agentOptionsModal');
            loadAgents();
            alert('تم حفظ الخيارات بنجاح.');
        } else {
            alert('فشل حفظ الخيارات: ' + result.message);
        }
    } catch (e) {
        console.error(e);
        alert('حدث خطأ أثناء الحفظ.');
    }
}

window.openAgentOptionsModal = openAgentOptionsModal;
window.saveAgentOptions = saveAgentOptions;

async function executeIdoomManualRecharge() {
    const accountInput = document.getElementById('idoom_manual_account');
    const pinInput = document.getElementById('idoom_manual_pin');
    const btn = document.getElementById('btnIdoomManualRecharge');
    const originalText = btn.innerHTML;

    const account = accountInput.value.trim();
    const pin = pinInput.value.trim();

    if (!account) {
        alert('الرجاء إدخال رقم حساب إيدوم!');
        return;
    }
    if (!pin) {
        alert('الرجاء إدخال كود بطاقة التعبئة PIN!');
        return;
    }

    try {
        btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> جاري الاتصال...`;
        btn.disabled = true;

        appendAutomationTerminal(`💡 [تشغيل يدوي] تعبئة إيدوم للرقم: ${account} بكود الكارت PIN: ${pin}...`);

        const response = await fetch('http://localhost:3000/recharge-idoom', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ account, pin })
        });

        const result = await response.json();

        if (result && result.success) {
            appendAutomationTerminal(`🎉 [نجاح يدوي] تم التعبئة التلقائية للرقم ${account} بنجاح!`);
            if (result.details) {
                appendAutomationTerminal(`📄 تفاصيل: ${result.details}`);
            }
            alert(`🎉 تم التعبئة التلقائية للرقم ${account} بنجاح!\n${result.message || ''}`);
            pinInput.value = ''; // clear pin
            loadCards(); // refresh cards list
        } else {
            const errorMsg = result ? result.message : 'رد غير معروف من السيرفر';
            appendAutomationTerminal(`❌ [فشل يدوي] فشل التعبئة للرقم ${account}. السبب: ${errorMsg}`);
            alert(`❌ فشل التعبئة التلقائية: ${errorMsg}`);
        }
    } catch (e) {
        appendAutomationTerminal(`❌ [خطأ اتصال] حدث خطأ أثناء الاتصال بسيرفر الأتمتة: ${e.message}`);
        alert(`⚠️ حدث خطأ أثناء الاتصال بسيرفر الأتمتة: ${e.message}`);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

async function executeIdoomManualCheck() {
    const accountInput = document.getElementById('idoom_manual_account');
    const btn = document.getElementById('btnIdoomManualCheck');
    const originalText = btn.innerHTML;

    const account = accountInput.value.trim();

    if (!account) {
        alert('الرجاء إدخال رقم هاتف / حساب إيدوم للفحص!');
        return;
    }

    try {
        btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> جاري فحص الفاتورة...`;
        btn.disabled = true;

        appendAutomationTerminal(`💡 [فحص يدوي] جاري استعلام فاتورة الرقم: ${account}...`);

        const response = await fetch('http://localhost:3000/check-bill-idoom', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ account })
        });

        const result = await response.json();

        if (result && result.success) {
            appendAutomationTerminal(`🎉 [نجاح فحص] قيمة الفاتورة للرقم ${account} هي: ${result.amount} دج`);
            if (result.details) {
                appendAutomationTerminal(`📄 تفاصيل: ${result.details}`);
            }
            alert(`🧾 فحص الفاتورة للرقم ${account} ناجح:\nالمبلغ المستحق: ${result.amount} دج`);
        } else {
            const errorMsg = result ? result.message : 'رد غير معروف من السيرفر';
            appendAutomationTerminal(`❌ [فشل فحص] فشل الفحص للرقم ${account}. السبب: ${errorMsg}`);
            alert(`❌ فشل فحص الفاتورة: ${errorMsg}`);
        }
    } catch (e) {
        appendAutomationTerminal(`❌ [خطأ اتصال] حدث خطأ أثناء الفحص: ${e.message}`);
        alert(`⚠️ حدث خطأ أثناء الاتصال بسيرفر الأتمتة: ${e.message}`);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

function appendAutomationTerminal(log) {
    const terminal = document.getElementById('automationTerminal');
    if (terminal) {
        const line = document.createElement('div');
        line.innerText = `> ${log.trim()}`;
        if (log.toLowerCase().includes('success') || log.includes('ناجحة') || log.includes('نجاح')) line.style.color = '#0f0';
        else if (log.toLowerCase().includes('error') || log.includes('فشل') || log.includes('فشلت')) line.style.color = '#f00';
        else if (log.toLowerCase().includes('captcha') || log.includes('جاري') || log.includes('فحص')) line.style.color = '#ff0';
        else line.style.color = '#38bdf8'; // Cyan default for manual actions
        
        terminal.appendChild(line);
        terminal.scrollTop = terminal.scrollHeight;
        
        if (terminal.children.length > 100) {
            terminal.removeChild(terminal.firstChild);
        }
    }
}

// Bind manual controls to window context
window.executeIdoomManualRecharge = executeIdoomManualRecharge;
window.executeIdoomManualCheck = executeIdoomManualCheck;
window.appendAutomationTerminal = appendAutomationTerminal;

// ---- Ahla App Status inside SIM Card ----
async function refreshAhlaCardStatus(simId) {
    const dot  = document.getElementById(`ahla-card-dot-${simId}`);
    const text = document.getElementById(`ahla-card-text-${simId}`);
    if (!dot || !text) return;

    dot.style.background  = '#f59e0b';
    dot.style.boxShadow   = '0 0 5px #f59e0b';
    text.textContent      = '⏳ جاري فحص تطبيق أهلاً...';
    text.style.color      = '#94a3b8';

    try {
        const result = await apiCall('test-ahla-connection', simId);
        if (result && result.success) {
            dot.style.background = '#22c55e';
            dot.style.boxShadow  = '0 0 8px #22c55e';
            text.style.color     = '#22c55e';
            text.textContent     = '✅ ' + (result.message || 'تطبيق أهلاً متصل وينتظر الأوامر');
        } else {
            dot.style.background = '#ef4444';
            dot.style.boxShadow  = '0 0 8px #ef4444';
            text.style.color     = '#ef4444';
            text.textContent     = '❌ ' + (result.message || 'تطبيق أهلاً غير متصل');
        }
    } catch (e) {
        dot.style.background = '#ef4444';
        dot.style.boxShadow  = '0 0 8px #ef4444';
        text.style.color     = '#ef4444';
        text.textContent     = '❌ خطأ في فحص الاتصال';
    }
}
window.refreshAhlaCardStatus = refreshAhlaCardStatus;

// Periodically refresh Ahla status every 30 seconds
setInterval(() => {
    document.querySelectorAll('[id^="ahla-card-dot-"]').forEach(el => {
        const simId = el.id.replace('ahla-card-dot-', '');
        refreshAhlaCardStatus(simId);
    });
}, 30000);

// ===================== Product Management =====================
async function loadProducts() {
    try {
        const products = await apiCall('get-products');
        const grid = document.getElementById('productsGrid');
        if (!grid) return;
        grid.innerHTML = '';

        // Group by operator
        const grouped = {};
        products.forEach(p => {
            if (!grouped[p.operator]) grouped[p.operator] = [];
            grouped[p.operator].push(p);
        });

        const operatorColors = {
            'Mobilis': { bg: 'rgba(34,197,94,0.1)', border: '#22c55e', icon: 'fa-signal' },
            'Djezzy': { bg: 'rgba(239,68,68,0.1)', border: '#ef4444', icon: 'fa-fire' },
            'Ooredoo': { bg: 'rgba(234,179,8,0.1)', border: '#eab308', icon: 'fa-star' }
        };

        for (const [operator, items] of Object.entries(grouped)) {
            const colors = operatorColors[operator] || { bg: 'rgba(99,102,241,0.1)', border: '#6366f1', icon: 'fa-box' };
            const card = document.createElement('div');
            card.style.cssText = `background: ${colors.bg}; border: 1px solid ${colors.border}; border-radius: 12px; padding: 15px; transition: all 0.3s;`;
            
            let tableRows = items.map(p => `
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                    <td style="padding:8px; font-weight:600;">${p.name}</td>
                    <td style="padding:8px; text-align:center;">${Number(p.base_price).toLocaleString()} دج</td>
                    <td style="padding:8px; text-align:center; color:#ef4444;">${p.margin_admin}%</td>
                    <td style="padding:8px; text-align:center; color:#f97316;">${p.margin_super_grossiste}%</td>
                    <td style="padding:8px; text-align:center; color:#eab308;">${p.margin_grossiste}%</td>
                    <td style="padding:8px; text-align:center; color:#22c55e;">${p.margin_detaillant}%</td>
                    <td style="padding:8px; text-align:center;">
                        <button class="btn primary small" onclick='editProduct(${JSON.stringify(p).replace(/'/g, "\\'")})'><i class="fas fa-edit"></i></button>
                        <button class="btn danger small" onclick="deleteProduct(${p.id})"><i class="fas fa-trash"></i></button>
                    </td>
                </tr>
            `).join('');

            card.innerHTML = `
                <h4 style="margin: 0 0 12px 0; color: ${colors.border}; display:flex; align-items:center; gap:8px;">
                    <i class="fas ${colors.icon}"></i> ${operator}
                    <span style="font-size:11px; opacity:0.7; font-weight:normal;">(${items.length} منتج)</span>
                </h4>
                <div style="overflow-x:auto;">
                    <table style="width:100%; font-size:12px; border-collapse:collapse;">
                        <thead>
                            <tr style="border-bottom:2px solid ${colors.border};">
                                <th style="padding:8px; text-align:right;">المنتج</th>
                                <th style="padding:8px; text-align:center;">السعر</th>
                                <th style="padding:8px; text-align:center; color:#ef4444;">Admin</th>
                                <th style="padding:8px; text-align:center; color:#f97316;">S.Grossiste</th>
                                <th style="padding:8px; text-align:center; color:#eab308;">Grossiste</th>
                                <th style="padding:8px; text-align:center; color:#22c55e;">Détaillant</th>
                                <th style="padding:8px; text-align:center;">إجراءات</th>
                            </tr>
                        </thead>
                        <tbody>${tableRows}</tbody>
                    </table>
                </div>
            `;
            grid.appendChild(card);
        }

        if (products.length === 0) {
            grid.innerHTML = '<div style="text-align:center; padding:40px; color:#64748b;"><i class="fas fa-box-open" style="font-size:40px; margin-bottom:10px;"></i><br>لا توجد منتجات. اضغط "إضافة منتج" للبدء.</div>';
        }
    } catch (e) {
        console.error('Error loading products:', e);
    }
}

function openProductModal() {
    document.getElementById('productModalTitle').innerText = 'إضافة منتج جديد';
    document.getElementById('editProductId').value = '';
    document.getElementById('productOperator').value = 'Mobilis';
    document.getElementById('productName').value = '';
    document.getElementById('productBasePrice').value = '';
    document.getElementById('productMarginAdmin').value = '';
    document.getElementById('productMarginSuperGrossiste').value = '';
    document.getElementById('productMarginGrossiste').value = '';
    document.getElementById('productMarginDetaillant').value = '';
    showModal('addProductModal');
}

function editProduct(product) {
    document.getElementById('productModalTitle').innerText = 'تعديل المنتج';
    document.getElementById('editProductId').value = product.id;
    document.getElementById('productOperator').value = product.operator;
    document.getElementById('productName').value = product.name;
    document.getElementById('productBasePrice').value = product.base_price;
    document.getElementById('productMarginAdmin').value = product.margin_admin;
    document.getElementById('productMarginSuperGrossiste').value = product.margin_super_grossiste;
    document.getElementById('productMarginGrossiste').value = product.margin_grossiste;
    document.getElementById('productMarginDetaillant').value = product.margin_detaillant;
    showModal('addProductModal');
}

async function saveProduct() {
    const data = {
        operator: document.getElementById('productOperator').value,
        name: document.getElementById('productName').value.trim(),
        base_price: parseFloat(document.getElementById('productBasePrice').value) || 0,
        margin_admin: parseFloat(document.getElementById('productMarginAdmin').value) || 0,
        margin_super_grossiste: parseFloat(document.getElementById('productMarginSuperGrossiste').value) || 0,
        margin_grossiste: parseFloat(document.getElementById('productMarginGrossiste').value) || 0,
        margin_detaillant: parseFloat(document.getElementById('productMarginDetaillant').value) || 0
    };

    if (!data.name) return alert('يرجى إدخال اسم المنتج.');

    try {
        const editId = document.getElementById('editProductId').value;
        if (editId) {
            data.id = parseInt(editId);
            await apiCall('update-product', data);
        } else {
            await apiCall('add-product', data);
        }
        hideModal('addProductModal');
        loadProducts();
    } catch (e) {
        alert('حدث خطأ أثناء حفظ المنتج.');
        console.error(e);
    }
}

async function deleteProduct(id) {
    if (!confirm('هل أنت متأكد من حذف هذا المنتج؟')) return;
    try {
        await apiCall('delete-product', id);
        loadProducts();
    } catch (e) {
        alert('حدث خطأ أثناء الحذف.');
    }
}

// Auto-load products when tab is activated
document.addEventListener('click', (e) => {
    if (e.target.closest('[data-target="products-tab"]')) {
        setTimeout(loadProducts, 100);
    }
});
