// *** ใส่ URL ของคุณที่นี่ ***
const API_URL = 'https://script.google.com/macros/s/AKfycbw8JQEp7nV0LS-jy6BFeqq6A3fiw4Imqws6cbih6Vaq1bj66B5XYpnMhCLmfpECvz53/exec'; 

// [NEW] รหัสลับ (ต้องตรงกับใน Google Apps Script)
const MY_SECRET = "My_Super_Secret_Password_999"; 

// --- OFFLINE MANAGER (Queue System) ---
const queueManager = {
    key: 'pos_offline_queue',
    getQueue() { return JSON.parse(localStorage.getItem(this.key)) || []; },
    addToQueue(data) {
        const q = this.getQueue();
        q.push(data);
        // Tip: localStorage มีจำกัด (ประมาณ 5MB) ถ้าเก็บไฟล์ PDF เยอะๆ อาจเต็มได้
        // แต่สำหรับ Offline Mode ชั่วคราวถือว่าใช้งานได้
        try {
            localStorage.setItem(this.key, JSON.stringify(q));
            this.updateIndicator();
        } catch(e) {
            Swal.fire('หน่วยความจำเต็ม', 'ไม่สามารถบันทึก Offline เพิ่มได้ กรุณาต่อเน็ต', 'error');
        }
    },
    async sync() {
        const q = this.getQueue();
        if (q.length === 0) return;
        
        document.getElementById('loader').classList.remove('hidden');
        document.getElementById('loader').querySelector('p').innerText = "กำลังซิงค์ข้อมูล...";
        
        let successCount = 0;
        const newQ = [];

        for (const item of q) {
            try {
                // เพิ่ม secret ตอน sync ด้วย
                item.secret = MY_SECRET;

                const res = await fetch(API_URL, {
                    method: 'POST',
                    headers: { "Content-Type": "text/plain;charset=utf-8" },
                    body: JSON.stringify(item)
                });
                const json = await res.json();
                if (json.status === 'success') successCount++;
                else newQ.push(item); // Keep failed item
            } catch (e) {
                newQ.push(item); // Keep failed item
            }
        }

        localStorage.setItem(this.key, JSON.stringify(newQ));
        this.updateIndicator();
        document.getElementById('loader').classList.add('hidden');
        
        if (successCount > 0) Swal.fire({icon: 'success', title: `ซิงค์สำเร็จ ${successCount} รายการ`});
        else Swal.fire({icon: 'error', title: 'ซิงค์ไม่สำเร็จ', text: 'กรุณาตรวจสอบอินเทอร์เน็ต'});
    },
    updateIndicator() {
        const count = this.getQueue().length;
        const el = document.getElementById('offline-indicator');
        const countEl = document.getElementById('offline-count');
        if (count > 0) {
            el.classList.remove('hidden');
            countEl.innerText = count;
        } else {
            el.classList.add('hidden');
        }
    }
};

const api = {
    async post(payload, background = false) {
        // background=true คือการส่งแบบเงียบๆ ไม่ต้องโชว์ Loading (ใช้ตอนส่ง PDF)
        if (!background) {
            document.getElementById('loader').classList.remove('hidden');
            document.getElementById('loader').querySelector('p').innerText = "กำลังดำเนินการ...";
        }

        // [NEW] แนบรหัสลับไปกับข้อมูลทุกครั้ง
        payload.secret = MY_SECRET; 
        
        try {
            const res = await fetch(API_URL, {
                method: 'POST',
                headers: { "Content-Type": "text/plain;charset=utf-8" },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            
            if (!background) document.getElementById('loader').classList.add('hidden');
            
            // เพิ่มเช็ค Error จาก Server (เช่น รหัสผิด)
            if (data.status === 'error') {
                throw new Error(data.message);
            }

            return data;
        } catch (e) {
            if (!background) document.getElementById('loader').classList.add('hidden');
            console.warn("API Error / Offline", e);
            
            // ถ้า Server บอกว่า Access Denied (รหัสผิด) ให้แจ้งเตือนทันที ไม่ต้องเข้าคิว
            if (e.message && e.message.includes('Access Denied')) {
                    Swal.fire('ข้อผิดพลาด', 'รหัสความปลอดภัยไม่ถูกต้อง (API Secret Key)', 'error');
                    throw e; // หยุดทำงาน
            }

            // หากเป็นคำสั่ง Save หรือ Upload PDF ให้เข้าคิว
            if (payload.action === 'save_transaction' || payload.action === 'upload_pdf') {
                queueManager.addToQueue(payload);
                return { status: 'success', offline: true };
            } else {
                throw e;
            }
        }
    }
};

const app = {
    data: {
        cart: [],
        products: JSON.parse(localStorage.getItem('pos_products')) || [{id:1, name:'ทุเรียนหมอนทอง', price:150}],
        banks: JSON.parse(localStorage.getItem('pos_banks')) || [],
        reportData: [],
        payMethod: 'เงินสด',
        selectedBank: null,
        invNo: '',
        currentDebtList: [] // เก็บรายการหนี้ปัจจุบันสำหรับพิมพ์
    },
    init() {
        this.resetForm();
        this.renderProdList();
        this.renderBankList(); // Manage Modal List
        this.updateTime();
        setInterval(() => this.updateTime(), 60000);
        document.getElementById('inp-discount').addEventListener('input', () => this.renderCart());
        queueManager.updateIndicator();
    },
    clearDebtForm() {
        document.getElementById('debt-pay-name').value = '';
        document.getElementById('debt-pay-amt').value = '';
        document.getElementById('modal-debt-val').innerText = '0.00';
        document.getElementById('debt-display-area').classList.add('hidden');
        document.getElementById('debt-breakdown').innerHTML = '';
        document.getElementById('debt-breakdown').classList.add('hidden');
    },
    resetForm() {
        this.data.cart = [];
        this.data.payMethod = 'เงินสด';
        this.data.selectedBank = null;
        this.genInv();
        document.getElementById('inv-date').valueAsDate = new Date();
        document.getElementById('cust-name').value = '';
        document.getElementById('inp-discount').value = '';
        
        // Clear Debt Form Data as well
        this.clearDebtForm();
        
        const bulkSelect = document.getElementById('bulk-deposit-select');
        if(bulkSelect) bulkSelect.value = '';

        this.addRow(); // *** Add initial row ***
        this.setPayment('เงินสด', document.querySelector('.payment-option:first-child'));
    },
    cancelDebtModal() {
        ui.closeModal('debt-modal');
        this.clearDebtForm();
    },
    updateTime() {
        const now = new Date();
        document.getElementById('current-datetime').innerText = now.toLocaleDateString('th-TH', {day:'numeric', month:'short', year:'2-digit', hour:'2-digit', minute:'2-digit'});
    },
    genInv() {
        const r = Math.floor(1000 + Math.random() * 9000);
        const d = new Date().toISOString().slice(2,10).replace(/-/g,'');
        this.data.invNo = `INV-${d}-${r}`;
        document.getElementById('inv-no').value = this.data.invNo;
    },
    renderProdList() {
        document.getElementById('prod-list').innerHTML = this.data.products.map(p => 
            `<tr><td class="p-3 font-medium">${p.name}</td><td class="text-right p-3 text-slate-500">${p.price||'-'}</td>
            <td class="text-center text-red-400 hover:text-red-600 cursor-pointer p-3" onclick="app.delProd(${p.id})"><i class="fa-solid fa-trash"></i></td></tr>`
        ).join('');
    },
    addProduct() {
        const n = document.getElementById('new-prod-name').value;
        const p = document.getElementById('new-prod-price').value; 
        if(n) { 
            this.data.products.push({id:Date.now(), name:n, price:p});
            localStorage.setItem('pos_products', JSON.stringify(this.data.products));
            this.renderProdList(); this.renderCart();
            document.getElementById('new-prod-name').value=''; 
            document.getElementById('new-prod-price').value='';
        }
    },
    delProd(id) {
        this.data.products = this.data.products.filter(p=>p.id!==id);
        localStorage.setItem('pos_products', JSON.stringify(this.data.products));
        this.renderProdList(); this.renderCart();
    },
    // --- Bank Management ---
    renderBankList() {
        // Render List in Modal
        document.getElementById('bank-list-manage').innerHTML = this.data.banks.map(b => 
            `<tr><td class="p-2 font-medium">${b.name}</td>
            <td class="text-center text-red-400 hover:text-red-600 cursor-pointer p-2" onclick="app.delBank(${b.id})"><i class="fa-solid fa-trash"></i></td></tr>`
        ).join('');
        
        // Render Chips in Checkout
        const chipsContainer = document.getElementById('bank-list-chips');
        if(this.data.banks.length === 0) {
            chipsContainer.innerHTML = `<div class="text-xs text-slate-400 italic w-full text-center py-2">ยังไม่มีบัญชี (กดจัดการเพื่อเพิ่ม)</div>`;
        } else {
            chipsContainer.innerHTML = this.data.banks.map(b => 
                `<div class="bank-chip px-3 py-1.5 rounded-lg text-xs font-medium ${this.data.selectedBank === b.name ? 'selected' : 'bg-white text-slate-600'}" 
                onclick="app.selectBank('${b.name}', this)">
                <i class="fa-solid fa-building-columns mr-1"></i> ${b.name}
                </div>`
            ).join('');
        }
    },
    addBank() {
        const n = document.getElementById('new-bank-name').value.trim();
        if(n) {
            this.data.banks.push({id:Date.now(), name:n});
            localStorage.setItem('pos_banks', JSON.stringify(this.data.banks));
            document.getElementById('new-bank-name').value = '';
            this.renderBankList();
        }
    },
    delBank(id) {
        this.data.banks = this.data.banks.filter(b=>b.id!==id);
        localStorage.setItem('pos_banks', JSON.stringify(this.data.banks));
        if(this.data.selectedBank && !this.data.banks.find(b=>b.name === this.data.selectedBank)) {
            this.data.selectedBank = null;
        }
        this.renderBankList();
    },
    selectBank(name, el) {
        this.data.selectedBank = name;
        document.querySelectorAll('.bank-chip').forEach(c => c.classList.remove('selected', 'bg-emerald-100', 'border-emerald-500', 'text-emerald-700'));
        el.classList.add('selected');
    },
    // -----------------------
    addRow() {
        // Logic to copy previous item
        let newItem = {id:Date.now(), prodId:'', price:0, qty:'', deposit:0, name:''};
        
        if (this.data.cart.length > 0) {
            const lastItem = this.data.cart[this.data.cart.length - 1];
            if (lastItem.prodId) {
                newItem.prodId = lastItem.prodId;
                newItem.name = lastItem.name;
                newItem.price = lastItem.price;
                newItem.deposit = lastItem.deposit; // Copy deposit as well for convenience
            }
        }

        this.data.cart.push(newItem);
        this.renderCart();
    },
    updateRow(id, key, val) {
        const item = this.data.cart.find(x=>x.id===id);
        if(!item) return;
        if(key==='prodId') {
            const p = this.data.products.find(x=>x.id==val);
            item.prodId = val; item.name = p?p.name:''; item.price = p?p.price:0;
        } else {
            item[key] = parseFloat(val)||0;
        }
        this.renderCart();
    },
    delRow(id) {
        this.data.cart = this.data.cart.filter(x=>x.id!==id);
        this.renderCart();
    },
    setAllDeposit(val) {
        if(val === "") return;
        const v = parseFloat(val);
        this.data.cart.forEach(item => item.deposit = v);
        this.renderCart();
        document.getElementById('bulk-deposit-select').value = ""; // Reset to allow re-selection
    },
    renderCart() {
        const tbody = document.getElementById('cart-body');
        tbody.innerHTML = '';
        let sub=0, depTotal=0;
        
        this.data.cart.forEach(item => {
            const q = item.qty===''?0:item.qty;
            const lineTotal = (item.price * q) + item.deposit; 
            sub += (item.price * q);
            depTotal += item.deposit;

            const opts = `<option value="">--เลือก--</option>` + this.data.products.map(p=>`<option value="${p.id}" ${p.id==item.prodId?'selected':''}>${p.name}</option>`).join('');
            const depOpts = [0, 100, 200].map(v => `<option value="${v}" ${v==item.deposit?'selected':''}>${v===0?'ไม่มัดจำ':v}</option>`).join('');

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="p-1"><select class="custom-input w-full p-2.5 border border-gray-200 rounded-lg bg-white text-sm" onchange="app.updateRow(${item.id},'prodId',this.value)">${opts}</select></td>
                <td class="p-1"><input type="number" class="custom-input w-full p-2.5 border border-gray-200 rounded-lg text-right text-sm" value="${item.price}" onchange="app.updateRow(${item.id},'price',this.value)"></td>
                <td class="p-1"><input type="number" class="custom-input w-full p-2.5 border border-gray-200 rounded-lg text-center text-sm font-bold text-emerald-600" placeholder="0" value="${item.qty}" onchange="app.updateRow(${item.id},'qty',this.value)"></td>
                <td class="p-1"><select class="custom-input w-full p-2.5 border border-gray-200 rounded-lg text-center bg-white text-sm text-gray-500" onchange="app.updateRow(${item.id},'deposit',this.value)">${depOpts}</select></td>
                <td class="p-1 text-right font-bold text-gray-700 text-sm py-2">${lineTotal.toLocaleString()}</td>
                <td class="p-1 text-center text-red-400 hover:text-red-600 cursor-pointer transition-colors" onclick="app.delRow(${item.id})"><i class="fa-solid fa-trash-can"></i></td>
            `;
            tbody.appendChild(tr);
        });

        const disc = parseFloat(document.getElementById('inp-discount').value)||0;
        const total = sub + depTotal - disc;

        document.getElementById('sum-subtotal').innerText = sub.toLocaleString('th-TH',{minimumFractionDigits:2});
        document.getElementById('sum-deposit').innerText = depTotal.toLocaleString('th-TH',{minimumFractionDigits:2});
        document.getElementById('sum-total').innerText = total.toLocaleString('th-TH',{minimumFractionDigits:2});
    },
    setPayment(m, el) {
        this.data.payMethod = m;
        document.querySelectorAll('.payment-option').forEach(x=>x.classList.remove('active'));
        if(el) el.classList.add('active');
        
        // Toggle Bank Selector
        const bankArea = document.getElementById('bank-selector-area');
        if(m === 'โอน (QR Code)') {
            bankArea.classList.remove('hidden');
            this.renderBankList(); // Refresh chips
        } else {
            bankArea.classList.add('hidden');
            this.data.selectedBank = null;
        }
    },
    async checkDebt() {
        const name = document.getElementById('cust-name').value.trim();
        if(!name) return Swal.fire('แจ้งเตือน', 'กรุณาระบุชื่อลูกค้า', 'warning');
        try {
            const res = await api.post({ action: 'get_debt', name: name });
            if(res.status==='success') Swal.fire(`หนี้คงค้าง: ${res.debt.toLocaleString()} บาท`, name, 'info');
        } catch(e) { Swal.fire('Offline', 'ไม่สามารถเช็คหนี้ได้ขณะออฟไลน์', 'warning'); }
    },
    async checkDebtInModal() {
        const name = document.getElementById('debt-pay-name').value.trim();
        if(!name) return;
        
        // Reset display
        document.getElementById('modal-debt-val').innerText = "...";
        document.getElementById('debt-display-area').classList.remove('hidden');
        const breakdownDiv = document.getElementById('debt-breakdown');
        breakdownDiv.innerHTML = '';
        breakdownDiv.classList.add('hidden');
        
        this.data.currentDebtList = []; // Reset รายการเก่า

        try {
            // Fetch all report to calculate detailed debt
            const res = await api.post({ action: 'get_report' });
            
            if(res.status === 'success') {
                const transactions = res.data;
                
                // Filter for this customer
                const custTx = transactions.filter(t => t.customerName === name);
                
                // 1. Sort Old -> New
                custTx.sort((a,b) => (a.date + a.time).localeCompare(b.date + b.time));
                
                // 2. Calculate Total Debt vs Total Paid
                let pool = custTx.filter(x => x.note === 'ชำระหนี้ค้าง').reduce((s,x) => s + x.totalAmount, 0);
                let totalDebt = 0;
                const outstandingBills = [];

                custTx.forEach(x => {
                    if(x.note !== 'ชำระหนี้ค้าง' && (x.paymentMethod === 'รอชำระ' || x.paymentMethod === 'ชำระแล้ว (C)')) {
                        if(pool >= x.totalAmount) {
                            pool -= x.totalAmount;
                        } else {
                            const remaining = x.totalAmount - pool;
                            pool = 0;
                            outstandingBills.push({ ...x, remaining });
                            totalDebt += remaining;
                        }
                    }
                });

                // Display Total
                document.getElementById('modal-debt-val').innerText = totalDebt.toLocaleString();
                
                // *** เก็บค่าใส่ตัวแปรไว้สำหรับปริ้น ***
                this.data.currentDebtList = outstandingBills;

                // Display Breakdown
                if(outstandingBills.length > 0) {
                    breakdownDiv.classList.remove('hidden');
                    const listHtml = outstandingBills.map(b => `
                        <div class="flex justify-between border-b border-red-100 pb-1 text-slate-600 text-xs last:border-0">
                            <span>${b.date} (${b.invoiceId})</span>
                            <span class="font-bold text-red-500">${b.remaining.toLocaleString()}</span>
                        </div>
                    `).join('');
                    breakdownDiv.innerHTML = `<p class="font-bold text-slate-500 text-[10px] mb-1 uppercase">รายการค้างชำระ:</p>${listHtml}`;
                }
            }
        } catch(e) {
            document.getElementById('modal-debt-val').innerText = "0.00";
            console.error(e);
        }
    },
    async printDebtInvoice() {
        const list = this.data.currentDebtList;
        const name = document.getElementById('debt-pay-name').value.trim();
        const total = document.getElementById('modal-debt-val').innerText;

        if(!list || list.length === 0) {
            return Swal.fire('ไม่พบยอดค้าง', 'ไม่มีรายการหนี้ให้พิมพ์', 'warning');
        }

        // Setup Template
        document.getElementById('di-name').innerText = name;
        document.getElementById('di-date').innerText = new Date().toLocaleDateString('th-TH');
        document.getElementById('di-total').innerText = total;

        document.getElementById('di-body').innerHTML = list.map(item => `
            <tr>
                <td>${new Date(item.date).toLocaleDateString('th-TH')}</td>
                <td>${item.invoiceId}</td>
                <td style="text-align:right;">${item.remaining.toLocaleString()}</td>
            </tr>
        `).join('');

        // Generate PDF
        const el = document.getElementById('debt-invoice-render-area');
        try {
            const canvas = await html2canvas(el, {scale: 2});
            const img = canvas.toDataURL('image/jpeg');
            const pdf = new jspdf.jsPDF({orientation: 'p', unit: 'mm', format: 'a5'});
            const w = pdf.internal.pageSize.getWidth();
            const h = (canvas.height * w) / canvas.width;
            
            pdf.addImage(img, 'JPEG', 0, 0, w, h);
            pdf.save(`DebtNote_${name}.pdf`);
        } catch(e) {
            console.error(e);
            Swal.fire('Error', 'ไม่สามารถพิมพ์ได้', 'error');
        }
    },
    async submitDebtPayment() {
        const name = document.getElementById('debt-pay-name').value.trim();
        const amt = parseFloat(document.getElementById('debt-pay-amt').value);
        if(!name || !amt) return Swal.fire('ข้อมูลไม่ครบ', '', 'warning');
        
        const res = await api.post({
            action: 'save_transaction',
            invoiceId: 'PAY-'+Date.now(),
            date: new Date().toISOString().slice(0,10),
            time: new Date().toLocaleTimeString('th-TH'),
            customerName: name,
            items: 'ชำระหนี้ค้าง',
            totalAmount: amt,
            paymentMethod: 'โอน/เงินสด',
            note: 'ชำระหนี้ค้าง'
        });
        
        if(res.status==='success') {
            ui.closeModal('debt-modal');
            const msg = res.offline ? 'บันทึกออฟไลน์แล้ว' : 'บันทึกสำเร็จ';
            Swal.fire({icon:'success', title: msg, showConfirmButton:false, timer:1500});
            this.resetForm(); 
        }
    },
    async loadReport() {
        try {
            const res = await api.post({ action: 'get_report' });
            if(res.status==='success') {
                this.data.reportData = res.data;
                
                // Populate Bank Filter with Unique Banks from History + Current Settings
                const select = document.getElementById('rpt-bank-filter');
                const staticOpts = '<option value="">-- ทั้งหมด --</option><option value="เงินสด">เงินสด</option><option value="รอชำระ">รอชำระ</option>';
                
                // 1. Collect unique banks from History
                const historyBanks = new Set();
                this.data.reportData.forEach(d => {
                    // Extract "Bank Name" from "โอน(Bank Name)"
                    const match = d.paymentMethod.match(/โอน\((.*?)\)/);
                    if(match && match[1]) {
                        historyBanks.add(match[1]);
                    }
                });
                
                // 2. Add current active banks from settings
                this.data.banks.forEach(b => historyBanks.add(b.name));
                
                // 3. Sort and Generate Options
                const sortedBanks = Array.from(historyBanks).sort();
                const dynOpts = sortedBanks.map(name => `<option value="${name}">โอน (${name})</option>`).join('');
                
                select.innerHTML = staticOpts + dynOpts;

                this.renderReportTable();
            }
        } catch(e) { Swal.fire('Offline', 'ไม่สามารถดูรายงานได้ขณะออฟไลน์', 'warning'); }
    },
    clearReportFilters() {
        document.getElementById('rpt-search').value = '';
        document.getElementById('rpt-bank-filter').value = '';
        document.getElementById('rpt-start-date').value = '';
        document.getElementById('rpt-end-date').value = '';
        this.renderReportTable();
    },
    renderReportTable() {
        const search = document.getElementById('rpt-search').value.toLowerCase();
        const bankFilter = document.getElementById('rpt-bank-filter').value;
        const startDate = document.getElementById('rpt-start-date').value;
        const endDate = document.getElementById('rpt-end-date').value;

        // --- 1. FILTER DATA ---
        const filtered = this.data.reportData.filter(d => {
            // Text Search
            const matchText = (d.customerName||'').toLowerCase().includes(search) || (d.invoiceId||'').toLowerCase().includes(search);
            
            // Date Range
            let matchDate = true;
            if(startDate && d.date < startDate) matchDate = false;
            if(endDate && d.date > endDate) matchDate = false;

            // Bank Filter
            let matchBank = true;
            if(bankFilter) {
                if(bankFilter === 'เงินสด') {
                        if(!d.paymentMethod.includes('เงินสด')) matchBank = false;
                } else if(bankFilter === 'รอชำระ') {
                        if(!d.paymentMethod.includes('รอชำระ')) matchBank = false;
                } else {
                        // Match specific bank name inside parentheses e.g. "โอน(KBank)"
                        // Use exact match for bank name to avoid partial confusion
                        if(!d.paymentMethod.includes(`โอน(${bankFilter})`)) matchBank = false;
                }
            }
            return matchText && matchDate && matchBank;
        });

        // --- 2. CALCULATE GLOBAL STATS (Unfiltered Month/Week/Day) ---
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();
        const todayStr = now.toISOString().slice(0,10);
        
        // Week Helper
        const getWeekNumber = (d) => {
            d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
            d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay()||7));
            var yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
            var weekNo = Math.ceil(( ( (d - yearStart) / 86400000) + 1)/7);
            return [d.getUTCFullYear(), weekNo];
        };
        const [currYearWeek, currWeek] = getWeekNumber(now);

        let sumMonth = 0, sumWeek = 0, sumToday = 0;
        
        this.data.reportData.forEach(d => {
            if(d.note === 'ชำระหนี้ค้าง') return; 
            
            const dDate = new Date(d.date);
            // Month
            if(dDate.getMonth() === currentMonth && dDate.getFullYear() === currentYear) {
                sumMonth += d.totalAmount;
            }
            // Week
            const [y, w] = getWeekNumber(dDate);
            if(y === currYearWeek && w === currWeek) {
                sumWeek += d.totalAmount;
            }
            // Today
            if(d.date === todayStr) {
                sumToday += d.totalAmount;
            }
        });

        // --- 3. CALCULATE FILTERED TOTAL ---
        let sumFiltered = 0;
        filtered.forEach(d => {
            if(d.note !== 'ชำระหนี้ค้าง') sumFiltered += d.totalAmount;
        });

        // Update Cards
        document.getElementById('rpt-month').innerText = sumMonth.toLocaleString();
        document.getElementById('rpt-week').innerText = sumWeek.toLocaleString();
        document.getElementById('rpt-today').innerText = sumToday.toLocaleString();
        document.getElementById('rpt-filter-total').innerText = sumFiltered.toLocaleString();

        // --- 4. PREPARE DEBT CALC FOR DISPLAY ---
        const debtMap = {};
        const custGroups = {};
        this.data.reportData.forEach(x => {
            if(!custGroups[x.customerName]) custGroups[x.customerName] = [];
            custGroups[x.customerName].push(x);
        });
        Object.values(custGroups).forEach(group => {
            group.sort((a,b) => (a.date + a.time).localeCompare(b.date + b.time));
            let pool = group.filter(x => x.note === 'ชำระหนี้ค้าง').reduce((s,x) => s + x.totalAmount, 0);
            group.forEach(x => {
                if(x.note !== 'ชำระหนี้ค้าง' && (x.paymentMethod === 'รอชำระ' || x.paymentMethod === 'ชำระแล้ว (C)')) {
                    if(pool >= x.totalAmount) { debtMap[x.invoiceId] = 0; pool -= x.totalAmount; } 
                    else { debtMap[x.invoiceId] = x.totalAmount - pool; pool = 0; }
                }
            });
        });

        // --- 5. RENDER GROUPED TABLE ---
        const container = document.getElementById('rpt-container');
        container.innerHTML = '';

        // Group filtered data by Date
        const grouped = filtered.reduce((acc, curr) => {
            const date = new Date(curr.date).toLocaleDateString('th-TH');
            if (!acc[date]) acc[date] = { date, total: 0, pending: 0, items: [] };
            
            if (curr.note !== 'ชำระหนี้ค้าง') {
                acc[date].total += curr.totalAmount;
                // Check if it was originally 'รอชำระ' or marked as such
                if(curr.paymentMethod.includes('รอชำระ')) {
                    acc[date].pending += curr.totalAmount;
                }
            }
            acc[date].items.push(curr);
            return acc;
        }, {});

        Object.values(grouped).forEach(group => {
            const card = document.createElement('div');
            card.className = "bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden";
            let rows = group.items.map(d => {
                const isDebtPay = d.note === 'ชำระหนี้ค้าง';
                let actions = '';
                if (isDebtPay) {
                    actions = `<div class="flex gap-2 justify-center">
                        <button onclick="app.prepEdit('${d.invoiceId}', ${d.totalAmount})" class="text-blue-500 hover:text-blue-700 text-xs border border-blue-200 px-3 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 transition-colors">แก้ไข</button>
                        <button onclick="app.deleteTx('${d.invoiceId}')" class="text-red-500 hover:text-red-700 text-xs border border-red-200 px-3 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 transition-colors">ลบ</button>
                    </div>`;
                }
                
                let badgeClass = 'bg-gray-100 text-gray-600';
                if(d.paymentMethod.includes('เงินสด')) badgeClass = 'bg-emerald-100 text-emerald-700 border border-emerald-200';
                else if(d.paymentMethod.includes('โอน')) badgeClass = 'bg-blue-100 text-blue-700 border border-blue-200';
                else if(d.paymentMethod.includes('รอชำระ')) badgeClass = 'bg-amber-100 text-amber-700 border border-amber-200';
                if(d.note === 'ชำระหนี้ค้าง') badgeClass = 'bg-purple-100 text-purple-700 border border-purple-200';

                let displayStatus = d.note === 'ชำระหนี้ค้าง' ? 'รับชำระหนี้' : d.paymentMethod;
                if(d.paymentMethod === 'รอชำระ') {
                    const remain = debtMap[d.invoiceId];
                    if(remain !== undefined && remain > 0) {
                        displayStatus = `รอชำระ<span class="text-red-600 font-bold ml-1">(${remain.toLocaleString()})</span>`;
                    } else if (remain === 0) {
                        displayStatus = `<span class="text-emerald-600 font-bold flex items-center gap-1"><i class="fa-solid fa-check-circle"></i> ชำระครบแล้ว</span>`;
                        badgeClass = 'bg-emerald-50 text-emerald-700 border border-emerald-100';
                    }
                }

                return `<tr class="hover:bg-gray-50 border-b border-gray-100 last:border-0 transition-colors ${isDebtPay ? 'bg-purple-50/50':''}">
                    <td class="p-4 w-[20%] text-xs font-mono text-gray-400">
                        <div class="font-bold text-gray-600">${d.time}</div>
                        ${d.invoiceId}
                    </td>
                    <td class="p-4 w-[25%] font-medium text-gray-700">${d.customerName}</td>
                    <td class="p-4 w-[20%] text-right font-bold text-base ${isDebtPay ? 'text-purple-600':''}">${d.totalAmount.toLocaleString()}</td>
                    <td class="p-4 w-[15%] text-center text-xs"><span class="px-3 py-1.5 rounded-full ${badgeClass} inline-block font-medium shadow-sm">${displayStatus}</span></td>
                    <td class="p-4 w-[20%] text-center">${actions}</td>
                </tr>`;
            }).join('');

            card.innerHTML = `
                <div class="bg-gradient-to-r from-gray-50 to-white px-5 py-4 border-b border-gray-100 flex justify-between items-center">
                    <span class="font-bold text-gray-700 flex items-center gap-2 text-lg"><i class="fa-regular fa-calendar-check text-emerald-500"></i> ${group.date}</span>
                    <div class="text-sm flex gap-4 bg-white px-3 py-1.5 rounded-lg border border-gray-100 shadow-sm">
                        <span class="font-bold text-gray-500">รอชำระ: <span class="text-amber-600">${group.pending.toLocaleString()}</span></span>
                        <div class="w-px h-4 bg-gray-200"></div>
                        <span class="font-bold text-emerald-600">ขายรวม: ${group.total.toLocaleString()}</span>
                    </div>
                </div>
                <table class="w-full text-sm"><tbody>${rows}</tbody></table>
            `;
            container.appendChild(card);
        });
    },
    prepEdit(inv, amt) {
        document.getElementById('edit-inv-id').value = inv;
        document.getElementById('edit-amt').value = amt;
        ui.openModal('edit-modal');
    },
    async confirmEdit() {
        const inv = document.getElementById('edit-inv-id').value;
        const amt = document.getElementById('edit-amt').value;
        if(!amt) return;
        const res = await api.post({ action: 'edit_transaction', invoiceId: inv, amount: amt });
        if(res.status==='success') {
            ui.closeModal('edit-modal');
            Swal.fire({icon:'success', title:'แก้ไขแล้ว', timer:1500, showConfirmButton:false});
            this.loadReport();
        }
    },
    async deleteTx(inv) {
        const conf = await Swal.fire({title:'ยืนยันลบ?', icon:'warning', showCancelButton:true, confirmButtonText:'ลบ', confirmButtonColor:'#ef4444'});
        if(conf.isConfirmed) {
            const res = await api.post({ action: 'delete_transaction', invoiceId: inv });
            if(res.status==='success') {
                Swal.fire('ลบสำเร็จ', '', 'success');
                this.loadReport();
            }
        }
    },
    async processCheckout() {
        const name = document.getElementById('cust-name').value.trim();
        const total = parseFloat(document.getElementById('sum-total').innerText.replace(/,/g,''));
        if(!name || (this.data.cart.length===0 && total <= 0)) return Swal.fire('ข้อมูลไม่ครบ', '', 'warning');

        // Validate Transfer Payment
        let finalPayMethod = this.data.payMethod;
        if (finalPayMethod === 'โอน (QR Code)') {
            if (!this.data.selectedBank) {
                return Swal.fire('กรุณาเลือกบัญชี', 'โปรดเลือกบัญชีธนาคารที่รับเงิน', 'warning');
            }
            finalPayMethod = `โอน(${this.data.selectedBank})`;
        }

        let oldDebt = 0;
        try {
            // Try fetch debt if online, else 0
            const r = await api.post({ action: 'get_debt', name: name });
            if(r.status==='success') oldDebt = r.debt;
        } catch(e){}

        const itemsStr = this.data.cart.map(x=>`${x.name} (${x.qty||0}x${x.price}) [มัดจำ:${x.deposit}]`).join(', ');
        const payload = {
            action: 'save_transaction',
            date: document.getElementById('inv-date').value,
            time: new Date().toLocaleTimeString('th-TH'),
            invoiceId: this.data.invNo,
            customerName: name,
            items: itemsStr,
            totalAmount: total,
            paymentMethod: finalPayMethod,
            note: 'ขายสินค้า'
        };

        const res = await api.post(payload);
        if(res.status==='success') {
            // *** บันทึกเสร็จแล้วจึงสร้าง PDF และ upload ***
            // หมายเหตุ: ถึงแม้บันทึกเป็น offline (res.offline=true) เราก็ยังเรียก printA5
            // เพราะ printA5 จะจัดการ uploadPdf ซึ่ง uploadPdf จะจัดการเข้า Queue อัตโนมัติถ้าเน็ตหลุด
            await this.printA5({...payload, paymentMethod: finalPayMethod}, oldDebt);
            
            const msg = res.offline ? 'บันทึกออฟไลน์แล้ว' : 'บันทึกเรียบร้อย';
            Swal.fire({icon:'success', title: msg, showConfirmButton:false, timer:1500});
            this.resetForm(); 
        }
    },
    async uploadPdf(invId, base64) {
            const payload = {
                action: 'upload_pdf',
                fileName: `Receipt_${invId}.pdf`,
                fileData: base64,
                mimeType: 'application/pdf'
            };
            // ส่งแบบ background=true เพื่อไม่ให้ user ต้องรอนาน
            // ถ้าเน็ตหลุด api.post จะโยนลง queueManager ให้อัตโนมัติ
            api.post(payload, true); 
    },
    async printA5(data, oldDebt) {
        document.getElementById('r-name').innerText = data.customerName;
        document.getElementById('r-inv').innerText = data.invoiceId;
        document.getElementById('r-date').innerText = new Date(data.date).toLocaleDateString('th-TH');
        document.getElementById('r-time').innerText = data.time;
        document.getElementById('r-pay').innerText = data.paymentMethod;

        document.getElementById('r-body').innerHTML = this.data.cart.map(i => `
            <tr>
                <td>${i.name}</td>
                <td style="text-align:right">${i.price}</td>
                <td style="text-align:center">${i.qty||0}</td>
                <td style="text-align:right">${(i.price*(i.qty||0)).toLocaleString()}</td>
            </tr>
        `).join('');

        const sub = document.getElementById('sum-subtotal').innerText;
        const dep = document.getElementById('sum-deposit').innerText;
        const disc = document.getElementById('inp-discount').value || '0.00';
        
        document.getElementById('r-sub').innerText = sub;
        document.getElementById('r-dep').innerText = dep;
        document.getElementById('r-disc').innerText = disc;
        document.getElementById('r-total').innerText = data.totalAmount.toLocaleString();

        const debtDiv = document.getElementById('r-debt-section');
        if(data.paymentMethod === 'รอชำระ' || oldDebt > 0) {
            debtDiv.classList.remove('hidden');
            document.getElementById('r-debt-old').innerText = oldDebt.toLocaleString();
            let newDebt = oldDebt;
            if(data.paymentMethod === 'รอชำระ') newDebt += data.totalAmount;
            document.getElementById('r-debt-new').innerText = newDebt.toLocaleString();
        } else {
            debtDiv.classList.add('hidden');
        }

        const el = document.getElementById('receipt-render-area');
        const canvas = await html2canvas(el, {scale:2});
        const img = canvas.toDataURL('image/jpeg');
        const pdf = new jspdf.jsPDF({orientation:'p', unit:'mm', format:'a5'});
        const w = pdf.internal.pageSize.getWidth();
        const h = (canvas.height * w) / canvas.width;
        pdf.addImage(img, 'JPEG', 0, 0, w, h);
        
        // 1. Download ให้ User เหมือนเดิม
        pdf.save(`${data.invoiceId}.pdf`);

        // 2. แปลงเป็น Base64 และ Upload ขึ้น Drive
        // output('datauristring') จะได้ string ยาวๆ แบบ "data:application/pdf;base64,JVBER..."
        // เราต้อง split เอาเฉพาะส่วนหลังเครื่องหมายจุลภาค
        const pdfBase64 = pdf.output('datauristring').split(',')[1];
        this.uploadPdf(data.invoiceId, pdfBase64);
    }
};

const ui = {
    openModal(id) { document.getElementById(id).classList.remove('hidden'); if(id==='product-modal') app.renderProdList(); if(id==='bank-modal') app.renderBankList(); },
    closeModal(id) { document.getElementById(id).classList.add('hidden'); }
};

app.init();
