// --- 9. REPORTS CONTROLLER & ANALYTICS ---
let currentReportTab = 'sales';

function switchReportTab(tab) {
    currentReportTab = tab;
    ['sales', 'products', 'cashflow', 'inventory'].forEach((t) => {
        const btn = document.getElementById(`rep-tab-${t}`);
        if (!btn) return;
        if (t === tab) {
            btn.className =
                'rep-tab-btn px-3 py-1 rounded-xl transition-all shadow-xs bg-white text-[#0066cc] font-bold';
        } else {
            btn.className =
                'rep-tab-btn px-3 py-1 rounded-xl transition-all text-gray-700 hover:text-gray-900 font-semibold';
        }
    });

    const searchInput = document.getElementById('rep-table-search');
    if (searchInput) searchInput.value = '';

    renderReports();
}

function updateKpiCard(index, icon, label, val, subHtml, iconClasses) {
    const iconEl = document.getElementById(`rep-kpi-icon-${index}`);
    const labelEl = document.getElementById(`rep-kpi-label-${index}`);
    const subEl = document.getElementById(`rep-kpi-sub-${index}`);

    if (iconEl) {
        iconEl.textContent = icon;
        if (iconClasses) iconEl.className = 'hidden';
    }
    if (labelEl) labelEl.textContent = label;
    if (subEl) subEl.innerHTML = subHtml;

    if (index === 1) {
        const el = document.getElementById('rep-total-revenue');
        if (el) el.textContent = val;
    } else if (index === 2) {
        const el = document.getElementById('rep-gross-profit');
        if (el) el.textContent = val;
    } else if (index === 3) {
        const el = document.getElementById('rep-kpi-val-3');
        if (el) el.textContent = val;
    } else if (index === 4) {
        const el = document.getElementById('rep-inventory-val');
        if (el) el.textContent = val;
    }
}

function renderDualBarChart(containerId, items, label1, color1, label2, color2) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (!items || items.length === 0) {
        container.innerHTML = renderHTML`
            <div class="h-full w-full flex flex-col items-center justify-center text-gray-400 py-6">
                <svg class="w-8 h-8 mb-1.5 text-gray-300" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M3 3v18h18M7 16v-4m4 4V8m4 8v-6m4 6v-9"/></svg>
                <span class="text-[12px] font-medium">Chưa có dữ liệu giao dịch trong khoảng thời gian này</span>
            </div>
        `;
        return;
    }

    const maxVal = Math.max(
        ...items.map((it) => Math.max(Math.abs(it.val1 || 0), Math.abs(it.val2 || 0))),
        1000000
    );

    container.innerHTML = items
        .map((it) => {
            const h1 = Math.max(
                6,
                Math.min(100, Math.round((Math.abs(it.val1 || 0) / maxVal) * 100))
            );
            const h2 =
                it.val2 == null
                    ? 0
                    : Math.max(
                          6,
                          Math.min(100, Math.round((Math.abs(it.val2 || 0) / maxVal) * 100))
                      );
            return renderHTML`
            <div tabindex="0" class="flex-1 flex flex-col items-center h-full justify-end group min-w-[42px] max-w-[70px] relative cursor-pointer focus:outline-none" title="${it.fullName || it.label}\n${label1}: ${formatVND(it.val1)} đ\n${label2}: ${it.val2 == null ? 'Thiếu giá vốn lịch sử' : formatVND(it.val2) + ' đ'}">
                <div class="hidden group-hover:block group-focus:block absolute -top-12 left-1/2 -translate-x-1/2 bg-gray-900/95 text-white text-[10.5px] leading-snug px-2 py-1 rounded-lg shadow-lg whitespace-nowrap z-30 pointer-events-none">
                    <div class="font-bold">${it.fullName || it.label}</div>
                    <div>${label1}: ${formatVND(it.val1)} đ</div>
                    <div>${label2}: ${it.val2 == null ? 'Thiếu giá vốn lịch sử' : formatVND(it.val2) + ' đ'}</div>
                </div>
                <div class="w-full flex items-end justify-center space-x-1.5 h-[132px] pb-1">
                    <div style="height: ${h1}%;" class="w-3.5 sm:w-4 rounded-t-md transition-all duration-300 group-hover:brightness-110 shadow-xs ${color1}"></div>
                    <div style="height: ${h2}%;" class="w-3.5 sm:w-4 rounded-t-md transition-all duration-300 group-hover:brightness-110 shadow-xs ${color2}"></div>
                </div>
                <div class="text-[10.5px] font-semibold text-gray-500 group-hover:text-[#0066cc] truncate max-w-full text-center tracking-tighter pt-1 border-t border-gray-100 w-full" title="${it.fullName || it.label}">${it.label}</div>
            </div>
        `;
        })
        .join('');
}

function renderSingleBarChart(containerId, items, barColor) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (!items || items.length === 0) {
        container.innerHTML = renderHTML`
            <div class="h-full w-full flex flex-col items-center justify-center text-gray-400 py-6">
                <svg class="w-8 h-8 mb-1.5 text-gray-300" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M3 3v18h18M7 16v-4m4 4V8m4 8v-6m4 6v-9"/></svg>
                <span class="text-[12px] font-medium">Chưa có phát sinh số liệu</span>
            </div>
        `;
        return;
    }

    const maxVal = Math.max(...items.map((it) => it.value || 0), 1000000);

    container.innerHTML = items
        .map((it) => {
            const h = Math.max(8, Math.min(100, Math.round(((it.value || 0) / maxVal) * 100)));
            return renderHTML`
            <div tabindex="0" class="flex-1 flex flex-col items-center h-full justify-end group min-w-[50px] max-w-[85px] relative cursor-pointer focus:outline-none" title="${it.fullName || it.label}\n${it.subLabel || ''}\n${formatVND(it.value)} đ">
                <div class="hidden group-hover:block group-focus:block absolute -top-11 left-1/2 -translate-x-1/2 bg-gray-900/95 text-white text-[10.5px] leading-snug px-2 py-1 rounded-lg shadow-lg whitespace-nowrap z-30 pointer-events-none">
                    <div class="font-bold">${it.fullName || it.label}</div>
                    <div>${formatVND(it.value)} đ</div>
                </div>
                <div class="w-full flex items-end justify-center h-[132px] pb-1">
                    <div style="height: ${h}%;" class="w-6 sm:w-8 rounded-t-lg transition-all duration-300 group-hover:brightness-110 shadow-xs ${barColor || 'bg-[#0066cc]'}"></div>
                </div>
                <div class="text-[10.5px] font-semibold text-gray-600 group-hover:text-[#0066cc] truncate max-w-full text-center tracking-tight pt-1 border-t border-gray-100 w-full" title="${it.fullName || it.label}">${it.label}</div>
            </div>
        `;
        })
        .join('');
}

function renderBreakdownBars(containerId, items) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (!items || items.length === 0) {
        container.innerHTML = renderHTML`
            <div class="h-full w-full flex flex-col items-center justify-center text-gray-400 py-4">
                <svg class="w-7 h-7 text-gray-400 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z"/></svg>
                <span class="text-[11.5px] font-medium">Chưa có dữ liệu cơ cấu</span>
            </div>
        `;
        return;
    }

    const total = items.reduce((a, b) => a + (b.value || 0), 0) || 1;

    container.innerHTML = items
        .map((it) => {
            const pct = Math.min(100, Math.round(((it.value || 0) / total) * 100));
            return renderHTML`
            <div class="space-y-1">
                <div class="flex items-center justify-between text-[11.5px]">
                    <span class="font-medium text-gray-700 truncate pr-2 flex items-center space-x-1.5">
                        <span class="w-2 h-2 rounded-full ${it.dotClass || 'bg-blue-500'}"></span>
                        <span class="truncate">${it.label}</span>
                    </span>
                    <span class="font-bold text-gray-900 tabular-nums flex-shrink-0">${formatVND(it.value)} đ <span class="text-gray-400 font-normal">(${pct}%)</span></span>
                </div>
                <div class="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
                    <div style="width: ${pct}%;" class="h-full rounded-full transition-all duration-500 ${it.barClass || 'bg-[#0066cc]'}"></div>
                </div>
            </div>
        `;
        })
        .join('');
}

function filterReportTable() {
    const query = (document.getElementById('rep-table-search')?.value || '').toLowerCase().trim();
    const tbody = document.getElementById('rep-table-tbody');
    if (!tbody) return;
    const rows = Array.from(tbody.querySelectorAll('tr'));
    let visibleCount = 0;
    rows.forEach((r) => {
        const text = r.textContent.toLowerCase();
        if (!query || text.includes(query)) {
            r.style.display = '';
            visibleCount++;
        } else {
            r.style.display = 'none';
        }
    });
    const badge = document.getElementById('rep-table-badge');
    if (badge) {
        badge.textContent = `${visibleCount}/${rows.length} dòng`;
    }
}

function exportCurrentReport() {
    const thead = document.getElementById('rep-table-thead');
    const tbody = document.getElementById('rep-table-tbody');
    if (!thead || !tbody) return;

    const headers = Array.from(thead.querySelectorAll('th')).map(
        (th) => `"${th.innerText.replace(/"/g, '""').trim()}"`
    );
    const rows = Array.from(tbody.querySelectorAll('tr')).filter((r) => r.style.display !== 'none');

    if (rows.length === 0) {
        showToast('Không có dữ liệu nào để xuất!', 'warning');
        return;
    }

    const csvRows = [headers.join(',')];
    rows.forEach((r) => {
        const cols = Array.from(r.querySelectorAll('td')).map((td) => {
            let txt = td.innerText.replace(/"/g, '""').replace(/\n/g, ' ').trim();
            if (/^[=+\-@\t\r]/.test(txt)) {
                txt = "'" + txt;
            }
            return `"${txt}"`;
        });
        csvRows.push(cols.join(','));
    });

    const csvContent = '\uFEFF' + csvRows.join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateFilter = document.getElementById('rep-date-filter')?.value || 'this_month';
    const customFrom = document.getElementById('rep-date-from')?.value;
    const customTo = document.getElementById('rep-date-to')?.value;
    const dateSuffix =
        dateFilter === 'custom' && customFrom && customTo
            ? `${customFrom}_den_${customTo}`
            : dateFilter;
    link.setAttribute('download', `BaoCao_${currentReportTab}_${dateSuffix}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast('Đã xuất báo cáo ra file Excel (.csv) thành công!', 'success');
}

function printCurrentReport() {
    printRegion('view-reports', false);
}

function onReportDateFilterChange() {
    const filter = document.getElementById('rep-date-filter')?.value;
    const customContainer = document.getElementById('rep-custom-date-container');
    const fromInput = document.getElementById('rep-date-from');
    const toInput = document.getElementById('rep-date-to');

    if (filter === 'custom') {
        if (customContainer) {
            customContainer.classList.remove('hidden');
            customContainer.classList.add('inline-flex');
        }
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        if (fromInput && !fromInput.value) {
            fromInput.value = `${y}-${m}-01`;
        }
        if (toInput && !toInput.value) {
            toInput.value = `${y}-${m}-${d}`;
        }
    } else {
        if (customContainer) {
            customContainer.classList.add('hidden');
            customContainer.classList.remove('inline-flex');
        }
    }
    renderReports();
}

function renderReports() {
    const data = KVStore.data;
    const currentBranch = getCurrentBranch();
    const isAll =
        currentBranch ===
        (typeof ALL_BRANCHES !== 'undefined' ? ALL_BRANCHES : 'Toàn bộ chi nhánh');
    let branchProducts;
    if (isAll) {
        const prodMap = new Map();
        (data.products || []).forEach((p) => {
            const code = p.code;
            if (!prodMap.has(code)) {
                prodMap.set(code, {
                    ...p,
                    stock: 0,
                    costValue: 0,
                    retailValue: 0,
                    minStock: 0,
                    imeis: [],
                    branchStocks: []
                });
            }
            const item = prodMap.get(code);
            const bName = p.branch || FALLBACK_BRANCH;
            const bStock = Number(p.stock) || 0;
            item.stock += bStock;
            item.costValue += bStock * (Number(p.costPrice) || 0);
            item.retailValue += bStock * (Number(p.price) || 0);
            item.minStock = Math.max(item.minStock, Number(p.minStock) || 0);
            if (Array.isArray(p.imeis)) {
                item.imeis.push(...p.imeis);
            }
            item.branchStocks.push({ branch: bName, stock: bStock });
            if (p.status === 'active') item.status = 'active';
            if (!item.price && p.price) item.price = p.price;
            if (!item.costPrice && p.costPrice) item.costPrice = p.costPrice;
        });
        branchProducts = Array.from(prodMap.values()).map((item) => {
            item.costPrice = item.stock ? item.costValue / item.stock : 0;
            item.price = item.stock ? item.retailValue / item.stock : 0;
            item.branchBreakdown = item.branchStocks
                .map((b) => `${b.branch}: ${b.stock}`)
                .join(' · ');
            return item;
        });
    } else {
        branchProducts = (data.products || []).filter(
            (p) => (p.branch || FALLBACK_BRANCH) === currentBranch
        );
    }

    const repBranchEl = document.getElementById('rep-branch-name');
    if (repBranchEl) repBranchEl.textContent = isAll ? 'Toàn bộ chi nhánh' : currentBranch;

    const dateFilter = document.getElementById('rep-date-filter')?.value || 'this_month';
    const customFrom = document.getElementById('rep-date-from')?.value;
    const customTo = document.getElementById('rep-date-to')?.value;

    const repDateSummary = document.getElementById('rep-date-summary');
    if (repDateSummary) {
        if (dateFilter === 'custom') {
            const fText = customFrom ? customFrom.split('-').reverse().join('/') : '...';
            const tText = customTo ? customTo.split('-').reverse().join('/') : '...';
            repDateSummary.textContent = `| ${fText} - ${tText}`;
        } else {
            const filterLabels = {
                today: 'Hôm nay',
                yesterday: 'Hôm qua',
                '7days': '7 ngày qua',
                '30days': '30 ngày qua',
                this_month: 'Tháng này',
                last_month: 'Tháng trước',
                this_quarter: 'Quý này',
                this_year: 'Năm nay',
                all: 'Tất cả thời gian'
            };
            repDateSummary.textContent = `| ${filterLabels[dateFilter] || dateFilter}`;
        }
    }

    if (currentReportTab === 'sales') {
        renderSalesReportTab(data, currentBranch, branchProducts, dateFilter, customFrom, customTo);
    } else if (currentReportTab === 'products') {
        renderProductsReportTab(
            data,
            currentBranch,
            branchProducts,
            dateFilter,
            customFrom,
            customTo
        );
    } else if (currentReportTab === 'cashflow') {
        renderCashflowReportTab(
            data,
            currentBranch,
            branchProducts,
            dateFilter,
            customFrom,
            customTo
        );
    } else if (currentReportTab === 'inventory') {
        renderInventoryReportTab(
            data,
            currentBranch,
            branchProducts,
            dateFilter,
            customFrom,
            customTo
        );
    }

    filterReportTable();
}

function renderSalesReportTab(
    data,
    currentBranch,
    branchProducts,
    dateFilter,
    customFrom,
    customTo
) {
    const isAll =
        currentBranch ===
        (typeof ALL_BRANCHES !== 'undefined' ? ALL_BRANCHES : 'Toàn bộ chi nhánh');
    const branchInvoices = (data.invoices || []).filter(
        (i) =>
            (isAll || (i.branch || FALLBACK_BRANCH) === currentBranch) &&
            (i.status !== 'cancelled' || i.bookingVersion === 2)
    );
    const validInvoices = branchInvoices.filter((i) =>
        matchesDateFilter(i.time, dateFilter, customFrom, customTo)
    );

    const legacyCancelled = new Set(
        (data.invoices || [])
            .filter((i) => i.status === 'cancelled' && i.bookingVersion !== 2)
            .map((i) => i.code)
    );
    const branchReturns = (data.returns || []).filter(
        (r) =>
            (isAll || (r.branch || FALLBACK_BRANCH) === currentBranch) &&
            !legacyCancelled.has(r.invoiceCode)
    );
    const validReturns = branchReturns.filter((r) =>
        matchesDateFilter(r.time, dateFilter, customFrom, customTo)
    );

    const grossRevenue = validInvoices.reduce((a, c) => a + (c.total || 0), 0);
    const totalReturns = validReturns.reduce(
        (a, c) => a + (c.returnValue ?? c.totalRefund ?? 0),
        0
    );
    const netRevenue = grossRevenue - totalReturns;

    let totalCost = 0;
    validInvoices.forEach((inv) => {
        (inv.items || []).forEach((item) => {
            totalCost += (item.costPrice ?? 0) * item.qty;
        });
    });
    validReturns.forEach((ret) =>
        (ret.items || []).forEach((item) => {
            totalCost -= (item.costPrice ?? 0) * item.qty;
        })
    );
    const unknownCost =
        validInvoices.some((inv) => inv.items.some((item) => item.costPrice == null)) ||
        validReturns.some((ret) => ret.items.some((item) => item.costPrice == null));
    const grossProfit = netRevenue - totalCost;
    const margin = netRevenue > 0 ? ((grossProfit / netRevenue) * 100).toFixed(1) : '0.0';
    const invoicesCount = validInvoices.length;
    const aov = invoicesCount > 0 ? Math.round(grossRevenue / invoicesCount) : 0;
    const returnsCount = validReturns.length;

    // 1. KPI Cards
    updateKpiCard(
        1,
        '₫',
        'Doanh thu thuần',
        `${formatVND(netRevenue)} đ`,
        renderHTML`<span class="text-emerald-600 font-semibold">Đã trừ trả hàng (${formatVND(totalReturns)} đ)</span>`,
        'bg-blue-500/15 text-[#0066cc]'
    );
    updateKpiCard(
        2,
        '',
        'Lợi nhuận gộp',
        unknownCost ? 'Thiếu giá vốn lịch sử' : `${formatVND(grossProfit)} đ`,
        renderHTML`Tỷ suất: <span id="rep-margin" class="font-bold text-[#0066cc]">${unknownCost ? '—' : margin + '%'}</span>`,
        'bg-emerald-500/15 text-emerald-600'
    );
    updateKpiCard(
        3,
        '',
        'Số lượng hóa đơn',
        `${invoicesCount} đơn`,
        renderHTML`TB đơn (AOV): <span id="rep-kpi-aov-sub" class="font-bold text-gray-700">${formatVND(aov)} đ</span>`,
        'bg-[#0066cc]/15 text-[#0066cc]'
    );
    updateKpiCard(
        4,
        '',
        'Tổng giá trị trả hàng',
        `${formatVND(totalReturns)} đ`,
        renderHTML`<span class="font-semibold text-gray-800">${returnsCount}</span> phiếu trả hàng`,
        'bg-rose-500/15 text-rose-600'
    );

    // 2. Chart Titles & Legends
    const mainTitleEl = document.getElementById('rep-main-chart-title');
    if (mainTitleEl) mainTitleEl.textContent = 'Xu hướng Doanh thu & Lợi nhuận';
    const mainLegendEl = document.getElementById('rep-main-chart-legend');
    if (mainLegendEl) {
        mainLegendEl.innerHTML = renderHTML`
            <span class="inline-flex items-center space-x-1.5"><span class="w-2.5 h-2.5 rounded-sm bg-[#0066cc]"></span><span>Doanh thu</span></span>
            <span class="inline-flex items-center space-x-1.5"><span class="w-2.5 h-2.5 rounded-sm bg-emerald-500"></span><span>Lợi nhuận</span></span>
        `;
    }

    const sideTitleEl = document.getElementById('rep-side-chart-title');
    if (sideTitleEl) sideTitleEl.textContent = 'Phương thức thanh toán';
    const sideBadgeEl = document.getElementById('rep-side-chart-badge');
    if (sideBadgeEl) sideBadgeEl.textContent = 'Tỷ trọng';

    // 3. Main Chart Data (Group by date)
    const dayMap = Object.create(null);
    validInvoices.forEach((inv) => {
        const d = parseRecordDate(inv.time);
        const dayKey = d
            ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
            : 'Khác';
        if (!dayMap[dayKey]) {
            dayMap[dayKey] = {
                dayKey,
                dateObj: d || new Date(0),
                gross: 0,
                cost: 0,
                returns: 0,
                count: 0,
                unknownCost: false
            };
        }
        dayMap[dayKey].gross += inv.total || 0;
        dayMap[dayKey].count += 1;
        (inv.items || []).forEach((item) => {
            dayMap[dayKey].cost += (item.costPrice ?? 0) * item.qty;
            dayMap[dayKey].unknownCost ||= item.costPrice == null;
        });
    });

    validReturns.forEach((ret) => {
        const d = parseRecordDate(ret.time);
        const dayKey = d
            ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
            : 'Khác';
        if (!dayMap[dayKey]) {
            dayMap[dayKey] = {
                dayKey,
                dateObj: d || new Date(0),
                gross: 0,
                cost: 0,
                returns: 0,
                count: 0,
                unknownCost: false
            };
        }
        dayMap[dayKey].returns += ret.returnValue ?? ret.totalRefund ?? 0;
        (ret.items || []).forEach((item) => {
            dayMap[dayKey].cost -= (item.costPrice ?? 0) * item.qty;
            dayMap[dayKey].unknownCost ||= item.costPrice == null;
        });
    });

    const daysSorted = Object.values(dayMap).sort((a, b) => a.dateObj - b.dateObj);
    const chartItems = daysSorted.map((d) => {
        const net = d.gross - d.returns;
        const profit = net - d.cost;
        return {
            label: d.dayKey.slice(0, 5),
            fullName: d.dayKey,
            val1: net,
            val2: d.unknownCost ? null : profit
        };
    });
    renderDualBarChart(
        'rep-main-chart-container',
        chartItems,
        'Doanh thu thuần',
        'bg-[#0066cc]',
        'Lợi nhuận',
        'bg-emerald-500'
    );

    // 4. Side Chart: Payment breakdown
    const methods = { cash: 0, transfer: 0, card: 0, unknown: 0 };
    let debtTotal = 0;
    validInvoices.forEach((inv) => {
        debtTotal += Math.max(0, inv.total - (inv.returnedTotal || 0) - inv.paid);
        const payments = inv.payments || [
            { amount: inv.paid, method: inv.paymentMethod || 'unknown' }
        ];
        payments.forEach((p) => {
            methods[Object.hasOwn(methods, p.method) ? p.method : 'unknown'] += p.amount;
        });
    });
    renderBreakdownBars('rep-breakdown-container', [
        {
            label: 'Chuyển khoản (VietQR)',
            value: methods.transfer,
            dotClass: 'bg-[#0066cc]',
            barClass: 'bg-[#0066cc]'
        },
        {
            label: 'Tiền mặt',
            value: methods.cash,
            dotClass: 'bg-emerald-500',
            barClass: 'bg-emerald-500'
        },
        { label: 'Thẻ', value: methods.card, dotClass: 'bg-indigo-600', barClass: 'bg-indigo-600' },
        {
            label: 'Khách nợ / Chưa trả',
            value: debtTotal,
            dotClass: 'bg-amber-500',
            barClass: 'bg-amber-500'
        }
    ]);

    // 5. Table Rendering
    const tableTitleEl = document.getElementById('rep-table-title');
    if (tableTitleEl) tableTitleEl.textContent = 'Chi tiết Doanh thu theo từng ngày';

    const thead = document.getElementById('rep-table-thead');
    if (thead) {
        thead.innerHTML = renderHTML`
            <tr class="bg-gray-100/80 text-gray-700 font-bold border-b border-gray-200">
                <th class="py-2.5 px-3">Ngày ghi nhận</th>
                <th class="py-2.5 px-3 text-center">Số hóa đơn</th>
                <th class="py-2.5 px-3 text-right">Doanh thu bán</th>
                <th class="py-2.5 px-3 text-right">Tiền trả lại</th>
                <th class="py-2.5 px-3 text-right">Doanh thu thuần</th>
                <th class="py-2.5 px-3 text-right">Tiền vốn</th>
                <th class="py-2.5 px-3 text-right">Lợi nhuận gộp</th>
                <th class="py-2.5 px-3 text-right">Tỷ suất LN</th>
            </tr>
        `;
    }

    const daysDesc = [...daysSorted].reverse();
    const tbody = document.getElementById('rep-table-tbody');
    if (tbody) {
        tbody.innerHTML = daysDesc
            .map((d) => {
                const net = d.gross - d.returns;
                const profit = net - d.cost;
                const rate = net > 0 ? ((profit / net) * 100).toFixed(1) : '0.0';
                return renderHTML`
                <tr class="hover:bg-blue-50/40 transition-colors">
                    <td class="py-2.5 px-3 font-semibold text-gray-900 font-mono">${d.dayKey}</td>
                    <td class="py-2.5 px-3 text-center font-bold text-gray-700">${d.count}</td>
                    <td class="py-2.5 px-3 text-right font-medium text-gray-800 tabular-nums">${formatVND(d.gross)} đ</td>
                    <td class="py-2.5 px-3 text-right font-medium text-rose-600 tabular-nums">${d.returns > 0 ? '-' + formatVND(d.returns) + ' đ' : '0 đ'}</td>
                    <td class="py-2.5 px-3 text-right font-bold text-[#0066cc] tabular-nums">${formatVND(net)} đ</td>
                    <td class="py-2.5 px-3 text-right font-medium text-gray-600 tabular-nums">${d.unknownCost ? 'Thiếu giá vốn' : formatVND(d.cost) + ' đ'}</td>
                    <td class="py-2.5 px-3 text-right font-bold text-emerald-600 tabular-nums">${d.unknownCost ? 'Chưa xác định' : formatVND(profit) + ' đ'}</td>
                    <td class="py-2.5 px-3 text-right font-bold tabular-nums ${parseFloat(rate) >= 20 ? 'text-emerald-600' : 'text-amber-600'}">${d.unknownCost ? '—' : rate + '%'}</td>
                </tr>
            `;
            })
            .join('');
    }

    const tableBadgeEl = document.getElementById('rep-table-badge');
    if (tableBadgeEl) tableBadgeEl.textContent = `${daysDesc.length} ngày`;

    const footer = document.getElementById('rep-table-footer');
    if (footer) {
        footer.innerHTML = renderHTML`
            <div class="flex items-center space-x-4">
                <span>Tổng cộng: <strong class="text-gray-900">${invoicesCount}</strong> đơn hàng</span>
                <span>Doanh thu bán: <strong class="text-gray-900">${formatVND(grossRevenue)} đ</strong></span>
            </div>
            <div class="flex items-center space-x-4">
                <span>DT thuần: <strong class="text-[#0066cc]">${formatVND(netRevenue)} đ</strong></span>
                <span>Lợi nhuận gộp: <strong class="text-emerald-600">${unknownCost ? 'Thiếu giá vốn lịch sử' : formatVND(grossProfit) + ' đ'}</strong></span>
                <span>Tỷ suất TB: <strong class="text-gray-900">${unknownCost ? '—' : margin + '%'}</strong></span>
            </div>
        `;
    }
}

function renderProductsReportTab(
    data,
    currentBranch,
    branchProducts,
    dateFilter,
    customFrom,
    customTo
) {
    const isAll =
        currentBranch ===
        (typeof ALL_BRANCHES !== 'undefined' ? ALL_BRANCHES : 'Toàn bộ chi nhánh');
    const branchInvoices = (data.invoices || []).filter(
        (i) =>
            (isAll || (i.branch || FALLBACK_BRANCH) === currentBranch) &&
            (i.status !== 'cancelled' || i.bookingVersion === 2)
    );
    const validInvoices = branchInvoices.filter((i) =>
        matchesDateFilter(i.time, dateFilter, customFrom, customTo)
    );

    const productsByCode = new Map();
    for (const p of branchProducts) if (!productsByCode.has(p.code)) productsByCode.set(p.code, p);
    const legacyCancelled = new Set(
        (data.invoices || [])
            .filter((i) => i.status === 'cancelled' && i.bookingVersion !== 2)
            .map((i) => i.code)
    );
    const prodMap = Object.create(null);
    validInvoices.forEach((inv) => {
        (inv.items || []).forEach((it) => {
            if (!prodMap[it.code]) {
                const p = productsByCode.get(it.code);
                prodMap[it.code] = {
                    code: it.code,
                    name: it.name,
                    category: p?.category || 'Chung',
                    costPrice: it.costPrice ?? 0,
                    totalCost: 0,
                    unknownCost: false,
                    stock: p ? p.stock || 0 : 0,
                    minStock: p ? p.minStock || 0 : 0,
                    qty: 0,
                    revenue: 0
                };
            }
            prodMap[it.code].qty += it.qty || 1;
            prodMap[it.code].revenue += invoiceLineNet(inv, it);
            prodMap[it.code].totalCost += (it.costPrice ?? 0) * it.qty;
            prodMap[it.code].unknownCost ||= it.costPrice == null;
        });
    });

    (data.returns || [])
        .filter(
            (r) =>
                (isAll || (r.branch || FALLBACK_BRANCH) === currentBranch) &&
                matchesDateFilter(r.time, dateFilter, customFrom, customTo) &&
                !legacyCancelled.has(r.invoiceCode)
        )
        .forEach((r) =>
            (r.items || []).forEach((it) => {
                if (!prodMap[it.code])
                    prodMap[it.code] = {
                        code: it.code,
                        name: it.name,
                        category: '',
                        stock: 0,
                        minStock: 0,
                        qty: 0,
                        revenue: 0,
                        totalCost: 0,
                        unknownCost: false
                    };
                const p = prodMap[it.code];
                p.qty -= it.qty;
                p.revenue -= it.total;
                p.totalCost -= (it.costPrice ?? 0) * it.qty;
                p.unknownCost ||= it.costPrice == null;
            })
        );
    const prodList = Object.values(prodMap)
        .map((p) => {
            const totalCost = p.totalCost;
            const profit = p.revenue - totalCost;
            const margin = p.revenue > 0 ? ((profit / p.revenue) * 100).toFixed(1) : '0.0';
            return { ...p, totalCost, profit, margin };
        })
        .sort((a, b) => b.revenue - a.revenue);

    const totalQtySold = prodList.reduce((a, b) => a + b.qty, 0);
    const totalProdRev = prodList.reduce((a, b) => a + b.revenue, 0);
    const totalProdProfit = prodList.reduce((a, b) => a + b.profit, 0);
    const avgPrice = totalQtySold > 0 ? Math.round(totalProdRev / totalQtySold) : 0;
    const avgMargin =
        totalProdRev > 0 ? ((totalProdProfit / totalProdRev) * 100).toFixed(1) : '0.0';
    const topProd = prodList[0];

    // 1. KPI Cards
    updateKpiCard(
        1,
        '',
        'Tổng sản phẩm đã bán',
        `${totalQtySold} SP`,
        renderHTML`Từ <span class="font-semibold text-gray-800">${validInvoices.length}</span> hóa đơn bán`,
        'bg-blue-500/15 text-[#0066cc]'
    );
    updateKpiCard(
        2,
        '₫',
        'Doanh thu sản phẩm',
        `${formatVND(totalProdRev)} đ`,
        renderHTML`Đơn giá TB: <span class="font-semibold text-gray-800">${formatVND(avgPrice)} đ/SP</span>`,
        'bg-emerald-500/15 text-emerald-600'
    );
    updateKpiCard(
        3,
        '',
        'Lợi nhuận hàng hóa',
        prodList.some((p) => p.unknownCost)
            ? 'Thiếu giá vốn lịch sử'
            : `${formatVND(totalProdProfit)} đ`,
        renderHTML`Tỷ suất TB: <span id="rep-margin" class="font-bold text-[#0066cc]">${prodList.some((p) => p.unknownCost) ? '—' : avgMargin + '%'}</span>`,
        'bg-[#0066cc]/15 text-[#0066cc]'
    );
    updateKpiCard(
        4,
        '',
        'Mặt hàng dẫn đầu',
        topProd
            ? topProd.name.length > 20
                ? topProd.name.slice(0, 18) + '...'
                : topProd.name
            : 'Chưa có',
        topProd
            ? renderHTML`<span class="font-semibold text-[#0066cc]">${topProd.qty} SP</span> (${formatVND(topProd.revenue)} đ)`
            : 'Chưa phát sinh',
        'bg-amber-500/15 text-amber-600'
    );

    // 2. Chart Titles & Legends
    const mainTitleEl = document.getElementById('rep-main-chart-title');
    if (mainTitleEl) mainTitleEl.textContent = 'Top 5 sản phẩm doanh thu & lợi nhuận cao nhất';
    const mainLegendEl = document.getElementById('rep-main-chart-legend');
    if (mainLegendEl) {
        mainLegendEl.innerHTML = renderHTML`
            <span class="inline-flex items-center space-x-1.5"><span class="w-2.5 h-2.5 rounded-sm bg-[#0066cc]"></span><span>Doanh thu</span></span>
            <span class="inline-flex items-center space-x-1.5"><span class="w-2.5 h-2.5 rounded-sm bg-emerald-500"></span><span>Lợi nhuận</span></span>
        `;
    }

    const sideTitleEl = document.getElementById('rep-side-chart-title');
    if (sideTitleEl) sideTitleEl.textContent = 'Doanh thu theo Nhóm hàng';
    const sideBadgeEl = document.getElementById('rep-side-chart-badge');
    if (sideBadgeEl) sideBadgeEl.textContent = 'Danh mục';

    // 3. Main Chart: Top 5 products
    const top5 = prodList.slice(0, 5).map((p) => ({
        label: p.code,
        fullName: p.name,
        val1: p.revenue,
        val2: p.unknownCost ? null : p.profit
    }));
    renderDualBarChart(
        'rep-main-chart-container',
        top5,
        'Doanh thu',
        'bg-[#0066cc]',
        'Lợi nhuận',
        'bg-emerald-500'
    );

    // 4. Side Chart: Category Breakdown
    const catMap = Object.create(null);
    prodList.forEach((p) => {
        catMap[p.category] = (catMap[p.category] || 0) + p.revenue;
    });
    const catItems = Object.entries(catMap).map(([name, val], idx) => {
        const colors = [
            { dot: 'bg-blue-500', bar: 'bg-blue-500' },
            { dot: 'bg-emerald-500', bar: 'bg-emerald-500' },
            { dot: 'bg-[#0066cc]', bar: 'bg-[#0066cc]' },
            { dot: 'bg-amber-500', bar: 'bg-amber-500' },
            { dot: 'bg-slate-700', bar: 'bg-slate-700' }
        ];
        const c = colors[idx % colors.length];
        return { label: name, value: val, dotClass: c.dot, barClass: c.bar };
    });
    renderBreakdownBars('rep-breakdown-container', catItems);

    // 5. Table Rendering
    const tableTitleEl = document.getElementById('rep-table-title');
    if (tableTitleEl) tableTitleEl.textContent = 'Bảng xếp hạng hiệu quả kinh doanh theo mặt hàng';

    const thead = document.getElementById('rep-table-thead');
    if (thead) {
        thead.innerHTML = renderHTML`
            <tr class="bg-gray-100/80 text-gray-700 font-bold border-b border-gray-200">
                <th class="py-2.5 px-3">Mã SKU</th>
                <th class="py-2.5 px-3">Tên sản phẩm</th>
                <th class="py-2.5 px-3">Nhóm hàng</th>
                <th class="py-2.5 px-3 text-center">SL bán</th>
                <th class="py-2.5 px-3 text-right">Doanh thu</th>
                <th class="py-2.5 px-3 text-right">Tiền vốn</th>
                <th class="py-2.5 px-3 text-right">Lợi nhuận</th>
                <th class="py-2.5 px-3 text-right">Tỷ suất</th>
                <th class="py-2.5 px-3 text-center">Tồn kho</th>
            </tr>
        `;
    }

    const tbody = document.getElementById('rep-table-tbody');
    if (tbody) {
        tbody.innerHTML = prodList
            .map((p) => {
                const stockBadge =
                    p.stock <= 0
                        ? trustedHTML('<span class="kv-badge kv-badge-danger">Hết hàng (0)</span>')
                        : p.stock <= p.minStock
                          ? renderHTML`<span class="kv-badge kv-badge-warning">Sắp hết (${p.stock})</span>`
                          : renderHTML`<span class="kv-badge kv-badge-success">${p.stock}</span>`;

                return renderHTML`
                <tr class="hover:bg-blue-50/40 transition-colors">
                    <td class="py-2.5 px-3 font-semibold text-[#0066cc] font-mono text-[12px]">${p.code}</td>
                    <td class="py-2.5 px-3 font-semibold text-gray-900 max-w-[260px] truncate" title="${p.name}">${p.name}</td>
                    <td class="py-2.5 px-3 text-gray-600 text-[12px]">${p.category}</td>
                    <td class="py-2.5 px-3 text-center font-bold text-gray-800">${p.qty}</td>
                    <td class="py-2.5 px-3 text-right font-bold text-[#0066cc] tabular-nums">${formatVND(p.revenue)} đ</td>
                    <td class="py-2.5 px-3 text-right font-medium text-gray-600 tabular-nums">${p.unknownCost ? 'Thiếu giá vốn' : formatVND(p.totalCost) + ' đ'}</td>
                    <td class="py-2.5 px-3 text-right font-bold text-emerald-600 tabular-nums">${p.unknownCost ? 'Chưa xác định' : formatVND(p.profit) + ' đ'}</td>
                    <td class="py-2.5 px-3 text-right font-bold tabular-nums ${parseFloat(p.margin) >= 20 ? 'text-emerald-600' : 'text-amber-600'}">${p.unknownCost ? '—' : p.margin + '%'}</td>
                    <td class="py-2.5 px-3 text-center">${stockBadge}</td>
                </tr>
            `;
            })
            .join('');
    }

    const tableBadgeEl = document.getElementById('rep-table-badge');
    if (tableBadgeEl) tableBadgeEl.textContent = `${prodList.length} mặt hàng`;

    const footer = document.getElementById('rep-table-footer');
    if (footer) {
        footer.innerHTML = renderHTML`
            <div class="flex items-center space-x-4">
                <span>Tổng mặt hàng phát sinh: <strong class="text-gray-900">${prodList.length}</strong></span>
                <span>Tổng số lượng bán: <strong class="text-gray-900">${totalQtySold} SP</strong></span>
            </div>
            <div class="flex items-center space-x-4">
                <span>Doanh thu: <strong class="text-[#0066cc]">${formatVND(totalProdRev)} đ</strong></span>
                <span>Lợi nhuận gộp: <strong class="text-emerald-600">${prodList.some((p) => p.unknownCost) ? 'Thiếu giá vốn lịch sử' : formatVND(totalProdProfit) + ' đ'}</strong></span>
                <span>Tỷ suất TB: <strong class="text-gray-900">${prodList.some((p) => p.unknownCost) ? '—' : avgMargin + '%'}</strong></span>
            </div>
        `;
    }
}

function renderCashflowReportTab(
    data,
    currentBranch,
    branchProducts,
    dateFilter,
    customFrom,
    customTo
) {
    const isAll =
        currentBranch ===
        (typeof ALL_BRANCHES !== 'undefined' ? ALL_BRANCHES : 'Toàn bộ chi nhánh');
    const branchCashbook = (data.cashbook || []).filter(
        (c) => isAll || (c.branch || FALLBACK_BRANCH) === currentBranch
    );
    const validCashbook = branchCashbook.filter((c) =>
        matchesDateFilter(c.time, dateFilter, customFrom, customTo)
    );

    const thuList = validCashbook.filter((c) => c.type === 'thu');
    const chiList = validCashbook.filter((c) => c.type === 'chi');
    const totalThu = thuList.reduce((a, b) => a + (b.amount || 0), 0);
    const totalChi = chiList.reduce((a, b) => a + (b.amount || 0), 0);
    const netCash = totalThu - totalChi;

    const allThu = branchCashbook
        .filter((c) => c.type === 'thu')
        .reduce((a, b) => a + (b.amount || 0), 0);
    const allChi = branchCashbook
        .filter((c) => c.type === 'chi')
        .reduce((a, b) => a + (b.amount || 0), 0);
    const allBalance = allThu - allChi;

    // 1. KPI Cards
    updateKpiCard(
        1,
        '',
        'Tổng thu trong kỳ',
        `${formatVND(totalThu)} đ`,
        renderHTML`<span class="text-blue-600 font-semibold">${thuList.length} phiếu thu</span>`,
        'bg-blue-500/15 text-[#0066cc]'
    );
    updateKpiCard(
        2,
        '',
        'Tổng chi trong kỳ',
        `${formatVND(totalChi)} đ`,
        renderHTML`<span class="text-rose-600 font-semibold">${chiList.length} phiếu chi</span>`,
        'bg-rose-500/15 text-rose-600'
    );
    updateKpiCard(
        3,
        '',
        'Dòng tiền ròng (Thu - Chi)',
        `${netCash >= 0 ? '+' : ''}${formatVND(netCash)} đ`,
        renderHTML`<span class="${netCash >= 0 ? 'text-emerald-600' : 'text-rose-600'} font-semibold">${netCash >= 0 ? 'Thặng dư tiền mặt' : 'Thâm hụt dòng tiền'}</span>`,
        netCash >= 0 ? 'bg-emerald-500/15 text-emerald-600' : 'bg-rose-500/15 text-rose-600'
    );
    updateKpiCard(
        4,
        '',
        'Tồn quỹ chi nhánh',
        `${formatVND(allBalance)} đ`,
        renderHTML`<span class="font-semibold text-gray-800">Toàn bộ quỹ tích lũy</span>`,
        'bg-amber-500/15 text-amber-600'
    );

    // 2. Chart Titles & Legends
    const mainTitleEl = document.getElementById('rep-main-chart-title');
    if (mainTitleEl) mainTitleEl.textContent = 'Biến động Dòng tiền Thu & Chi theo ngày';
    const mainLegendEl = document.getElementById('rep-main-chart-legend');
    if (mainLegendEl) {
        mainLegendEl.innerHTML = renderHTML`
            <span class="inline-flex items-center space-x-1.5"><span class="w-2.5 h-2.5 rounded-sm bg-[#0066cc]"></span><span>Tiền thu</span></span>
            <span class="inline-flex items-center space-x-1.5"><span class="w-2.5 h-2.5 rounded-sm bg-rose-500"></span><span>Tiền chi</span></span>
        `;
    }

    const sideTitleEl = document.getElementById('rep-side-chart-title');
    if (sideTitleEl) sideTitleEl.textContent = 'Cơ cấu Thu - Chi';
    const sideBadgeEl = document.getElementById('rep-side-chart-badge');
    if (sideBadgeEl) sideBadgeEl.textContent = 'Hình thức';

    // 3. Main Chart: Group cashflow by day
    const dayMap = Object.create(null);
    validCashbook.forEach((c) => {
        const d = parseRecordDate(c.time);
        const dayKey = d
            ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
            : 'Khác';
        if (!dayMap[dayKey]) {
            dayMap[dayKey] = { dayKey, dateObj: d || new Date(0), thu: 0, chi: 0 };
        }
        if (c.type === 'thu') dayMap[dayKey].thu += c.amount || 0;
        else dayMap[dayKey].chi += c.amount || 0;
    });

    const daysSorted = Object.values(dayMap).sort((a, b) => a.dateObj - b.dateObj);
    const chartItems = daysSorted.map((d) => ({
        label: d.dayKey.slice(0, 5),
        fullName: d.dayKey,
        val1: d.thu,
        val2: d.chi
    }));
    renderDualBarChart(
        'rep-main-chart-container',
        chartItems,
        'Tiền thu',
        'bg-[#0066cc]',
        'Tiền chi',
        'bg-rose-500'
    );

    // 4. Side Chart: Method / Category
    let transferAmount = 0;
    let cashAmount = 0;
    validCashbook.forEach((c) => {
        const m = (c.method || '').toLowerCase();
        if (m.includes('khoản') || m.includes('vietqr') || m.includes('bank')) {
            transferAmount += c.amount || 0;
        } else {
            cashAmount += c.amount || 0;
        }
    });

    renderBreakdownBars('rep-breakdown-container', [
        {
            label: 'Chuyển khoản ngân hàng',
            value: transferAmount,
            dotClass: 'bg-[#0066cc]',
            barClass: 'bg-[#0066cc]'
        },
        {
            label: 'Tiền mặt tại quầy',
            value: cashAmount,
            dotClass: 'bg-emerald-500',
            barClass: 'bg-emerald-500'
        }
    ]);

    // 5. Table Rendering
    const tableTitleEl = document.getElementById('rep-table-title');
    if (tableTitleEl) tableTitleEl.textContent = 'Sổ nhật ký thu chi chi tiết';

    const thead = document.getElementById('rep-table-thead');
    if (thead) {
        thead.innerHTML = renderHTML`
            <tr class="bg-gray-100/80 text-gray-700 font-bold border-b border-gray-200">
                <th class="py-2.5 px-3">Mã phiếu</th>
                <th class="py-2.5 px-3">Thời gian</th>
                <th class="py-2.5 px-3 text-center">Loại phiếu</th>
                <th class="py-2.5 px-3">Khoản mục</th>
                <th class="py-2.5 px-3">Người nộp / nhận</th>
                <th class="py-2.5 px-3">Phương thức</th>
                <th class="py-2.5 px-3 text-right">Số tiền</th>
                <th class="py-2.5 px-3">Ghi chú</th>
            </tr>
        `;
    }

    const sortedCashbook = [...validCashbook].sort((a, b) => {
        const da = parseRecordDate(a.time) || new Date(0);
        const db = parseRecordDate(b.time) || new Date(0);
        return db - da;
    });

    const tbody = document.getElementById('rep-table-tbody');
    if (tbody) {
        tbody.innerHTML = sortedCashbook
            .map((c) => {
                const isThu = c.type === 'thu';
                const typeBadge = isThu
                    ? trustedHTML('<span class="kv-badge kv-badge-success">Thu tiền</span>')
                    : trustedHTML('<span class="kv-badge kv-badge-danger">Chi tiền</span>');
                const amtColor = isThu ? 'text-blue-600' : 'text-rose-600';
                const amtPrefix = isThu ? '+' : '-';

                return renderHTML`
                <tr class="hover:bg-blue-50/40 transition-colors">
                    <td class="py-2.5 px-3 font-semibold text-[#0066cc] font-mono text-[12px]">${c.code}</td>
                    <td class="py-2.5 px-3 text-gray-600 font-mono text-[12px]">${c.time}</td>
                    <td class="py-2.5 px-3 text-center">${typeBadge}</td>
                    <td class="py-2.5 px-3 font-medium text-gray-900">${c.category || 'Khác'}</td>
                    <td class="py-2.5 px-3 text-gray-700 font-medium">${c.person || '-'}</td>
                    <td class="py-2.5 px-3 text-gray-600 text-[12px]">${c.method || 'Tiền mặt'}</td>
                    <td class="py-2.5 px-3 text-right font-bold tabular-nums ${amtColor}">${amtPrefix}${formatVND(c.amount)} đ</td>
                    <td class="py-2.5 px-3 text-gray-500 text-[12px] max-w-[200px] truncate" title="${c.note || ''}">${c.note || '-'}</td>
                </tr>
            `;
            })
            .join('');
    }

    const tableBadgeEl = document.getElementById('rep-table-badge');
    if (tableBadgeEl) tableBadgeEl.textContent = `${sortedCashbook.length} phiếu`;

    const footer = document.getElementById('rep-table-footer');
    if (footer) {
        footer.innerHTML = renderHTML`
            <div class="flex items-center space-x-4">
                <span>Tổng thu: <strong class="text-blue-600">+${formatVND(totalThu)} đ</strong></span>
                <span>Tổng chi: <strong class="text-rose-600">-${formatVND(totalChi)} đ</strong></span>
            </div>
            <div class="flex items-center space-x-4">
                <span>Chênh lệch ròng: <strong class="${netCash >= 0 ? 'text-emerald-600' : 'text-rose-600'}">${netCash >= 0 ? '+' : ''}${formatVND(netCash)} đ</strong></span>
                <span>Tồn quỹ hiện tại: <strong class="text-gray-900">${formatVND(allBalance)} đ</strong></span>
            </div>
        `;
    }
}

function renderInventoryReportTab(data, currentBranch, branchProducts, dateFilter) {
    const products = branchProducts.filter((p) => p.status === 'active');

    const totalStockQty = products.reduce((a, b) => a + (b.stock || 0), 0);
    const costValue = (p) => p.costValue ?? (p.stock || 0) * (p.costPrice || 0);
    const retailValue = (p) => p.retailValue ?? (p.stock || 0) * (p.price || 0);
    const totalCostVal = products.reduce((sum, p) => sum + costValue(p), 0);
    const totalRetailVal = products.reduce((sum, p) => sum + retailValue(p), 0);
    const potentialProfit = Math.max(0, totalRetailVal - totalCostVal);
    const invMargin =
        totalRetailVal > 0 ? ((potentialProfit / totalRetailVal) * 100).toFixed(1) : '0.0';

    const lowStock = products.filter(
        (p) => (p.stock || 0) <= (p.minStock || 0) && (p.stock || 0) > 0
    );
    const outOfStock = products.filter((p) => (p.stock || 0) <= 0);
    const goodStock = products.filter((p) => (p.stock || 0) > (p.minStock || 0));
    const warningCount = lowStock.length + outOfStock.length;

    // 1. KPI Cards
    updateKpiCard(
        1,
        '',
        'Giá trị tồn theo vốn',
        `${formatVND(totalCostVal)} đ`,
        renderHTML`<span class="font-semibold text-gray-700">${products.length} mặt hàng</span> (${totalStockQty} SP)`,
        'bg-blue-500/15 text-[#0066cc]'
    );
    updateKpiCard(
        2,
        '',
        'Giá trị tồn theo giá bán',
        `${formatVND(totalRetailVal)} đ`,
        `Doanh số tiềm năng`,
        'bg-emerald-500/15 text-emerald-600'
    );
    updateKpiCard(
        3,
        '',
        'Lợi nhuận gộp kho ước tính',
        `${formatVND(potentialProfit)} đ`,
        renderHTML`Biên LN kho: <span id="rep-margin" class="font-bold text-[#0066cc]">${invMargin}%</span>`,
        'bg-[#0066cc]/15 text-[#0066cc]'
    );
    updateKpiCard(
        4,
        '',
        'Cảnh báo dưới định mức',
        `${warningCount} mặt hàng`,
        renderHTML`<span class="text-rose-600 font-semibold">${outOfStock.length} hết hàng</span> · <span class="text-amber-600 font-semibold">${lowStock.length} sắp hết</span>`,
        'bg-amber-500/15 text-amber-600'
    );

    // 2. Chart Titles & Legends
    const mainTitleEl = document.getElementById('rep-main-chart-title');
    if (mainTitleEl) mainTitleEl.textContent = 'Giá trị tồn kho theo Nhóm hàng (Giá vốn)';
    const mainLegendEl = document.getElementById('rep-main-chart-legend');
    if (mainLegendEl) {
        mainLegendEl.innerHTML = renderHTML`
            <span class="inline-flex items-center space-x-1.5"><span class="w-2.5 h-2.5 rounded-sm bg-[#0066cc]"></span><span>Giá trị vốn tồn kho</span></span>
        `;
    }

    const sideTitleEl = document.getElementById('rep-side-chart-title');
    if (sideTitleEl) sideTitleEl.textContent = 'Trạng thái Định mức kho';
    const sideBadgeEl = document.getElementById('rep-side-chart-badge');
    if (sideBadgeEl) sideBadgeEl.textContent = 'Định mức';

    // 3. Main Chart: Category stock value
    const catMap = Object.create(null);
    products.forEach((p) => {
        const val = costValue(p);
        catMap[p.category] = (catMap[p.category] || 0) + val;
    });

    const catChartItems = Object.entries(catMap).map(([name, val]) => ({
        label: name.length > 10 ? name.slice(0, 8) + '..' : name,
        fullName: name,
        subLabel: 'Giá trị vốn tồn',
        value: val
    }));
    renderSingleBarChart('rep-main-chart-container', catChartItems, 'bg-[#0066cc]');

    // 4. Side Chart: Stock Status Breakdown
    renderBreakdownBars('rep-breakdown-container', [
        {
            label: 'Đủ hàng an toàn (> Min)',
            value: goodStock.length,
            dotClass: 'bg-emerald-500',
            barClass: 'bg-emerald-500'
        },
        {
            label: 'Sắp hết hàng (≤ Min)',
            value: lowStock.length,
            dotClass: 'bg-amber-500',
            barClass: 'bg-amber-500'
        },
        {
            label: 'Hết hàng (Hết sạch)',
            value: outOfStock.length,
            dotClass: 'bg-rose-500',
            barClass: 'bg-rose-500'
        }
    ]);

    // 5. Table Rendering
    const tableTitleEl = document.getElementById('rep-table-title');
    if (tableTitleEl) tableTitleEl.textContent = 'Báo cáo chi tiết định mức tồn kho & giá trị hàng';

    const thead = document.getElementById('rep-table-thead');
    if (thead) {
        thead.innerHTML = renderHTML`
            <tr class="bg-gray-100/80 text-gray-700 font-bold border-b border-gray-200">
                <th class="py-2.5 px-3">Mã SKU</th>
                <th class="py-2.5 px-3">Tên hàng hóa</th>
                <th class="py-2.5 px-3">Nhóm hàng</th>
                <th class="py-2.5 px-3 text-center">Tồn kho</th>
                <th class="py-2.5 px-3 text-center">Định mức</th>
                <th class="py-2.5 px-3 text-right">Giá vốn</th>
                <th class="py-2.5 px-3 text-right">Giá bán</th>
                <th class="py-2.5 px-3 text-right">Giá trị vốn tồn</th>
                <th class="py-2.5 px-3 text-center">Trạng thái</th>
            </tr>
        `;
    }

    const sortedProducts = [...products].sort((a, b) => {
        const aWarn = a.stock <= 0 ? 2 : a.stock <= a.minStock ? 1 : 0;
        const bWarn = b.stock <= 0 ? 2 : b.stock <= b.minStock ? 1 : 0;
        if (bWarn !== aWarn) return bWarn - aWarn;
        return costValue(b) - costValue(a);
    });

    const tbody = document.getElementById('rep-table-tbody');
    if (tbody) {
        tbody.innerHTML = sortedProducts
            .map((p) => {
                const valCost = costValue(p);
                let badgeHtml = '';
                if (p.stock <= 0) {
                    badgeHtml = trustedHTML(
                        '<span class="kv-badge kv-badge-danger">Hết hàng</span>'
                    );
                } else if (p.stock <= p.minStock) {
                    badgeHtml = trustedHTML(
                        '<span class="kv-badge kv-badge-warning">Sắp hết</span>'
                    );
                } else {
                    badgeHtml = trustedHTML(
                        '<span class="kv-badge kv-badge-success">Đủ hàng</span>'
                    );
                }

                return renderHTML`
                <tr class="hover:bg-blue-50/40 transition-colors">
                    <td class="py-2.5 px-3 font-semibold text-[#0066cc] font-mono text-[12px]">${p.code}</td>
                    <td class="py-2.5 px-3 font-semibold text-gray-900 max-w-[260px] truncate" title="${p.name}">${p.name}</td>
                    <td class="py-2.5 px-3 text-gray-600 text-[12px]">${p.category}</td>
                    <td class="py-2.5 px-3 text-center font-bold ${p.stock <= 0 ? 'text-rose-600' : p.stock <= p.minStock ? 'text-amber-600' : 'text-gray-800'}" title="${p.branchBreakdown || ''}">${p.stock || 0}</td>
                    <td class="py-2.5 px-3 text-center text-gray-500 font-medium">${p.minStock || 0}</td>
                    <td class="py-2.5 px-3 text-right font-medium text-gray-600 tabular-nums">${formatVND(p.costPrice)} đ</td>
                    <td class="py-2.5 px-3 text-right font-medium text-gray-800 tabular-nums">${formatVND(p.price)} đ</td>
                    <td class="py-2.5 px-3 text-right font-bold text-[#0066cc] tabular-nums">${formatVND(valCost)} đ</td>
                    <td class="py-2.5 px-3 text-center">${badgeHtml}</td>
                </tr>
            `;
            })
            .join('');
    }

    const tableBadgeEl = document.getElementById('rep-table-badge');
    if (tableBadgeEl) tableBadgeEl.textContent = `${sortedProducts.length} mặt hàng`;

    const footer = document.getElementById('rep-table-footer');
    if (footer) {
        footer.innerHTML = renderHTML`
            <div class="flex items-center space-x-4">
                <span>Tổng tồn kho: <strong class="text-gray-900">${totalStockQty} SP</strong></span>
                <span>Mặt hàng cảnh báo: <strong class="${warningCount > 0 ? 'text-rose-600' : 'text-gray-900'}">${warningCount}</strong></span>
            </div>
            <div class="flex items-center space-x-4">
                <span>Tổng vốn tồn: <strong class="text-[#0066cc]">${formatVND(totalCostVal)} đ</strong></span>
                <span>Tổng giá trị bán: <strong class="text-emerald-600">${formatVND(totalRetailVal)} đ</strong></span>
            </div>
        `;
    }
}
