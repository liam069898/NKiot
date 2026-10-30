'use strict';
// Local super-admin portal UI. All server text is safely rendered with textContent / DOM APIs.
(() => {
    if (typeof document === 'undefined') return;

    let csrf = '';
    let currentTenants = [];
    let currentPartners = [];
    let activeSearchQuery = '';
    let activeFilterStatus = 'all';

    const $ = (id) => document.getElementById(id);

    let messageTimer = null;
    function message(text, ok = false) {
        const el = $('message');
        if (!el) return;
        el.textContent = text;
        el.className = ok ? 'ok show' : 'error show';
        clearTimeout(messageTimer);
        if (ok) {
            messageTimer = setTimeout(() => {
                el.classList.remove('show');
            }, 4000);
        }
    }

    $('message')?.addEventListener('click', () => {
        $('message')?.classList.remove('show');
    });

    function askAdminConfirm({
        title = 'Xác nhận thao tác',
        message: msg = '',
        confirmText = 'Xác nhận'
    }) {
        const modal = $('modal-confirm-action');
        if (!modal) {
            return Promise.resolve(typeof confirm === 'function' ? confirm(msg) : true);
        }
        $('confirm-modal-title').textContent = title;
        $('confirm-modal-message').textContent = msg;
        const acceptBtn = $('btn-accept-confirm-modal');
        const cancelBtn = $('btn-cancel-confirm-modal');
        const closeBtn = $('btn-close-confirm-modal');
        if (acceptBtn) acceptBtn.textContent = confirmText;

        modal.hidden = false;
        modal.classList.add('show');
        setTimeout(() => acceptBtn?.focus(), 30);

        return new Promise((resolve) => {
            const cleanup = (result) => {
                modal.classList.remove('show');
                modal.hidden = true;
                acceptBtn?.removeEventListener('click', onAccept);
                cancelBtn?.removeEventListener('click', onCancel);
                closeBtn?.removeEventListener('click', onCancel);
                modal.removeEventListener('click', onBackdrop);
                resolve(result);
            };
            const onAccept = () => cleanup(true);
            const onCancel = () => cleanup(false);
            const onBackdrop = (e) => {
                if (e.target === modal) cleanup(false);
            };
            acceptBtn?.addEventListener('click', onAccept);
            cancelBtn?.addEventListener('click', onCancel);
            closeBtn?.addEventListener('click', onCancel);
            modal.addEventListener('click', onBackdrop);
        });
    }

    async function api(path, body) {
        const options = body
            ? {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'X-NKiot-Admin-CSRF': csrf },
                  body: JSON.stringify(body)
              }
            : {};
        const res = await fetch(path, { credentials: 'same-origin', ...options });
        const data = await res
            .json()
            .catch(() => ({ success: false, error: 'Phản hồi không hợp lệ từ máy chủ.' }));
        if (!res.ok || !data.success) {
            throw Object.assign(new Error(data.error || 'Lỗi hệ thống.'), { status: res.status });
        }
        return data;
    }

    function updateKpiCards(tenants, partners, nextPort) {
        const totalEl = $('kpi-total-tenants');
        const runningEl = $('kpi-running-tenants');
        const pairsEl = $('kpi-partner-pairs');
        const nextPortEl = $('kpi-next-port');
        const navNextPortEl = $('nav-next-port');

        if (totalEl) totalEl.textContent = String(tenants.length);
        if (runningEl) runningEl.textContent = String(tenants.filter((t) => t.running).length);
        if (pairsEl) pairsEl.textContent = String(partners.length);
        if (nextPortEl) nextPortEl.textContent = String(nextPort);
        if (navNextPortEl) navNextPortEl.textContent = String(nextPort);

        const cntAll = $('cnt-all');
        const cntRunning = $('cnt-running');
        const cntSuspended = $('cnt-suspended');
        if (cntAll) cntAll.textContent = String(tenants.length);
        if (cntRunning) cntRunning.textContent = String(tenants.filter((t) => t.running).length);
        if (cntSuspended)
            cntSuspended.textContent = String(
                tenants.filter((t) => t.status === 'suspended').length
            );
    }

    function formatBytes(bytes) {
        if (!bytes || bytes <= 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    function renderTenantRows(tenants) {
        const rows = $('tenant-rows');
        if (!rows) return;
        rows.replaceChildren();

        const query = activeSearchQuery.trim().toLowerCase();
        let filtered = tenants;

        if (activeFilterStatus === 'active') {
            filtered = filtered.filter((t) => t.running);
        } else if (activeFilterStatus === 'suspended') {
            filtered = filtered.filter((t) => t.status === 'suspended');
        }

        if (query) {
            filtered = filtered.filter(
                (t) =>
                    t.id.toLowerCase().includes(query) ||
                    t.name.toLowerCase().includes(query) ||
                    t.username.toLowerCase().includes(query) ||
                    String(t.port).includes(query) ||
                    (t.category && t.category.toLowerCase().includes(query)) ||
                    (t.phone && t.phone.includes(query)) ||
                    (t.status && t.status.toLowerCase().includes(query))
            );
        }

        if (filtered.length === 0) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = 5;
            td.style.textAlign = 'center';
            td.style.padding = '32px 16px';
            td.style.color = 'var(--text-muted)';
            td.textContent = query
                ? `Không tìm thấy nhà bán hàng nào phù hợp với "${query}".`
                : 'Chưa có nhà bán hàng nào được khởi tạo.';
            tr.append(td);
            rows.append(tr);
            return;
        }

        for (const t of filtered) {
            const tr = document.createElement('tr');

            // 1. Nhà bán hàng & CRM metadata
            const tdName = document.createElement('td');
            const nameWrap = document.createElement('div');
            nameWrap.className = 'tenant-cell-name';

            const avatar = document.createElement('div');
            avatar.className = 'tenant-avatar';
            avatar.textContent = (t.name.trim().charAt(0) || t.id.charAt(0) || 'N').toUpperCase();
            const colors = [
                ['#eff6ff', '#bfdbfe', '#0066cc'],
                ['#ecfdf5', '#a7f3d0', '#059669'],
                ['#f5f3ff', '#ddd6fe', '#7c3aed'],
                ['#fffbeb', '#fde68a', '#d97706'],
                ['#fdf2f8', '#fbcfe8', '#db2777']
            ];
            const hash = t.id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
            const [bg, border, text] = colors[hash % colors.length];
            avatar.style.background = `linear-gradient(135deg, ${bg} 0%, ${border} 100%)`;
            avatar.style.borderColor = border;
            avatar.style.color = text;

            const nameText = document.createElement('span');
            nameText.textContent = t.name;

            nameWrap.append(avatar, nameText);
            if (t.category) {
                const catTag = document.createElement('span');
                catTag.className = 'tag-category';
                catTag.textContent = t.category;
                nameWrap.append(catTag);
            }

            const subMeta = document.createElement('div');
            subMeta.className = 'cell-meta-sub';

            const badgeId = document.createElement('span');
            badgeId.className = 'tenant-cell-id';
            badgeId.textContent = t.id;

            const userText = document.createElement('span');
            userText.textContent = `👤 ${t.username}`;

            subMeta.append(badgeId, userText);
            if (t.phone) {
                const phoneText = document.createElement('span');
                phoneText.textContent = `📞 ${t.phone}`;
                subMeta.append(phoneText);
            }
            if (t.email) {
                const emailText = document.createElement('span');
                emailText.textContent = `✉️ ${t.email}`;
                subMeta.append(emailText);
            }

            tdName.append(nameWrap, subMeta);
            tr.append(tdName);

            // 2. Cổng & URL POS
            const tdUrl = document.createElement('td');
            const urlWrap = document.createElement('div');
            urlWrap.className = 'url-cell';

            const link = document.createElement('a');
            link.href = t.url;
            link.target = '_blank';
            link.rel = 'noopener';
            link.className = 'tenant-url-link';
            link.textContent = t.url ? t.url.replace(/^https?:\/\//, '') : `:${t.port}`;
            link.title = `Mở ${t.url} trong tab mới`;

            const copyBtn = document.createElement('button');
            copyBtn.type = 'button';
            copyBtn.className = 'btn-copy';
            copyBtn.style.padding = '4px 8px';
            copyBtn.style.fontSize = '11px';
            copyBtn.title = 'Sao chép URL';
            copyBtn.textContent = '📋';
            copyBtn.addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(t.url);
                    copyBtn.textContent = '✓';
                    setTimeout(() => {
                        copyBtn.textContent = '📋';
                    }, 1500);
                } catch {}
            });

            urlWrap.append(link, copyBtn);
            tdUrl.append(urlWrap);
            tr.append(tdUrl);

            // 3. Dữ liệu & DB
            const tdData = document.createElement('td');
            const dataWrap = document.createElement('div');
            dataWrap.style.display = 'flex';
            dataWrap.style.flexDirection = 'column';
            dataWrap.style.gap = '2px';

            const sizeText = document.createElement('span');
            sizeText.style.fontWeight = '700';
            sizeText.style.fontSize = '12px';
            sizeText.textContent = formatBytes(t.dbSize);

            const countText = document.createElement('span');
            countText.style.fontSize = '11px';
            countText.style.color = '#6b7280';
            countText.textContent = `${t.productsCount || 0} SP · ${t.invoicesCount || 0} Đơn`;

            const backupLink = document.createElement('a');
            backupLink.href = `/api/tenants/backup?id=${encodeURIComponent(t.id)}`;
            backupLink.className = 'btn-action-icon';
            backupLink.style.marginTop = '4px';
            backupLink.style.width = 'fit-content';
            backupLink.title = 'Tải bản sao lưu SQLite .db về máy';
            backupLink.textContent = '💾 Tải DB';

            dataWrap.append(sizeText, countText, backupLink);
            tdData.append(dataWrap);
            tr.append(tdData);

            // 4. Trạng thái (Shop & POS process)
            const tdStatus = document.createElement('td');
            const statusWrap = document.createElement('div');
            statusWrap.style.display = 'flex';
            statusWrap.style.flexDirection = 'column';
            statusWrap.style.gap = '4px';

            const isShopActive = t.status === 'active';
            const shopBadge = document.createElement('span');
            shopBadge.className = isShopActive ? 'badge badge-success' : 'badge badge-danger';
            const shopDot = document.createElement('span');
            shopDot.className = isShopActive ? 'dot pulse' : 'dot';
            shopBadge.append(
                shopDot,
                document.createTextNode(isShopActive ? ' Hoạt động' : ' Tạm khóa')
            );

            const posBadge = document.createElement('span');
            posBadge.className = t.running ? 'badge badge-success' : 'badge badge-warning';
            const posDot = document.createElement('span');
            posDot.className = t.running ? 'dot pulse' : 'dot';
            posBadge.append(posDot, document.createTextNode(t.running ? ' POS Chạy' : ' POS Dừng'));

            statusWrap.append(shopBadge, posBadge);
            tdStatus.append(statusWrap);
            tr.append(tdStatus);

            // 5. Thao tác quản trị
            const tdActions = document.createElement('td');
            const actWrap = document.createElement('div');
            actWrap.className = 'cell-actions';

            // Nút mở POS chính (Primary Pill Highlight)
            if (t.running) {
                const openLink = document.createElement('a');
                openLink.href = t.url;
                openLink.target = '_blank';
                openLink.rel = 'noopener';
                openLink.className = 'btn-open-pos';
                openLink.textContent = 'Mở POS ↗';
                actWrap.append(openLink);
            }

            // Nhóm nút công cụ quản trị (Admin Tools Group)
            const toolsGroup = document.createElement('div');
            toolsGroup.className = 'actions-group';

            if (t.running) {
                const stopBtn = document.createElement('button');
                stopBtn.type = 'button';
                stopBtn.className = 'btn-action-icon btn-action-warning';
                stopBtn.textContent = '⏸️ Tắt';
                stopBtn.title = 'Dừng tiến trình POS';
                stopBtn.addEventListener('click', () =>
                    guarded(stopBtn, async () => {
                        await api('/api/tenants/stop', { id: t.id });
                        message(`Đã dừng tiến trình POS ${t.id}.`, true);
                        await refresh();
                    })
                );
                toolsGroup.append(stopBtn);
            } else {
                const startBtn = document.createElement('button');
                startBtn.type = 'button';
                startBtn.className = 'btn-action-icon btn-action-success';
                startBtn.textContent = '▶️ Bật';
                startBtn.title = 'Khởi động POS';
                startBtn.addEventListener('click', () =>
                    guarded(startBtn, async () => {
                        await api('/api/tenants/start', { id: t.id });
                        message(`Đã khởi động POS ${t.id}.`, true);
                        await refresh();
                    })
                );
                toolsGroup.append(startBtn);
            }

            // Nút Khóa / Mở khóa
            const toggleStatusBtn = document.createElement('button');
            toggleStatusBtn.type = 'button';
            if (isShopActive) {
                toggleStatusBtn.className = 'btn-action-icon btn-action-danger';
                toggleStatusBtn.textContent = '🔒 Khóa';
                toggleStatusBtn.title = 'Tạm dừng hoạt động cửa hàng';
                toggleStatusBtn.addEventListener('click', () =>
                    guarded(toggleStatusBtn, async () => {
                        const confirmed = await askAdminConfirm({
                            title: 'Tạm khóa cửa hàng',
                            message: `Bạn có chắc muốn tạm khóa cửa hàng "${t.name}"? POS sẽ bị dừng và không thể đăng nhập.`,
                            confirmText: 'Tạm khóa'
                        });
                        if (!confirmed) return;
                        await api('/api/tenants/status', { id: t.id, status: 'suspended' });
                        message(`Đã tạm khóa cửa hàng ${t.id}.`, true);
                        await refresh();
                    })
                );
            } else {
                toggleStatusBtn.className = 'btn-action-icon btn-action-success';
                toggleStatusBtn.textContent = '🔓 Mở';
                toggleStatusBtn.title = 'Mở khóa cửa hàng';
                toggleStatusBtn.addEventListener('click', () =>
                    guarded(toggleStatusBtn, async () => {
                        await api('/api/tenants/status', { id: t.id, status: 'active' });
                        message(`Đã mở khóa cửa hàng ${t.id}.`, true);
                        await refresh();
                    })
                );
            }
            toolsGroup.append(toggleStatusBtn);

            // Nút Đổi mật khẩu
            const pwdBtn = document.createElement('button');
            pwdBtn.type = 'button';
            pwdBtn.className = 'btn-action-icon';
            pwdBtn.textContent = '🔑 Đổi MK';
            pwdBtn.title = 'Đặt lại mật khẩu admin POS';
            pwdBtn.addEventListener('click', () => openResetPwdModal(t));
            toolsGroup.append(pwdBtn);

            actWrap.append(toolsGroup);
            tdActions.append(actWrap);
            tr.append(tdActions);

            rows.append(tr);
        }
    }

    function render({ tenants, partners }) {
        currentTenants = tenants;
        currentPartners = partners;

        // Tính toán port tiếp theo
        const used = new Set(tenants.map((t) => t.port));
        let nextPort = 3101;
        while (used.has(nextPort)) nextPort++;

        updateKpiCards(tenants, partners, nextPort);
        renderTenantRows(tenants);

        // Partner Form Select options
        const partnerSelects = document.querySelectorAll('#partner-form select');
        for (const select of partnerSelects) {
            select.replaceChildren(
                ...tenants.map((t) =>
                    Object.assign(document.createElement('option'), {
                        value: t.id,
                        textContent: `${t.id} - ${t.name}`
                    })
                )
            );
        }
        if (partnerSelects[1] && tenants[1]) {
            partnerSelects[1].value = tenants[1].id;
        }

        // Partner chips list
        const partnerList = $('partner-rows');
        if (partnerList) {
            if (!partners.length) {
                const emptyLi = document.createElement('li');
                emptyLi.className = 'empty-state';
                emptyLi.textContent = 'Chưa có liên kết kho nào giữa các cửa hàng.';
                partnerList.replaceChildren(emptyLi);
            } else {
                partnerList.replaceChildren(
                    ...partners.map((p) => {
                        const li = document.createElement('li');

                        const metaDiv = document.createElement('div');
                        metaDiv.className = 'partner-pair-meta';

                        const nodesSpan = document.createElement('div');
                        nodesSpan.className = 'partner-pair-nodes';

                        const shopATag = document.createElement('span');
                        shopATag.className = 'partner-node-tag';
                        shopATag.textContent = `🏪 ${p.a}`;

                        const arrowSpan = document.createElement('span');
                        arrowSpan.className = 'partner-pair-arrow';
                        arrowSpan.textContent = '⟷';

                        const shopBTag = document.createElement('span');
                        shopBTag.className = 'partner-node-tag';
                        shopBTag.textContent = `🏪 ${p.b}`;

                        nodesSpan.append(shopATag, arrowSpan, shopBTag);

                        const badge = document.createElement('span');
                        badge.className = 'badge badge-success';
                        const dot = document.createElement('span');
                        dot.className = 'dot pulse';
                        badge.append(dot, document.createTextNode(' Đang kết nối'));

                        metaDiv.append(nodesSpan, badge);

                        // Nút ngắt kết nối khẩn cấp
                        const unlinkBtn = document.createElement('button');
                        unlinkBtn.type = 'button';
                        unlinkBtn.className = 'btn-emergency-unlink';
                        unlinkBtn.title = `Ngắt liên kết kho giữa ${p.a} và ${p.b}`;
                        unlinkBtn.textContent = '✕ Ngắt kết nối';
                        unlinkBtn.addEventListener('click', () =>
                            guarded(unlinkBtn, async () => {
                                const confirmed = await askAdminConfirm({
                                    title: 'Ngắt liên kết kho chung',
                                    message: `Xác nhận ngắt liên kết kho chung giữa "${p.a}" và "${p.b}"?`,
                                    confirmText: 'Ngắt liên kết'
                                });
                                if (!confirmed) return;
                                await api('/api/partners', { a: p.a, b: p.b, active: false });
                                message(`Đã ngắt liên kết kho giữa ${p.a} và ${p.b}.`, true);
                                await refresh();
                            })
                        );

                        li.append(metaDiv, unlinkBtn);
                        return li;
                    })
                );
            }
        }

        // Update default port input if empty or collided
        const form = $('tenant-form')?.elements;
        if (form && form.port) {
            if (!form.port.value || used.has(Number(form.port.value))) {
                form.port.value = nextPort;
            }
            updateTenantUrlPreview();
        }
    }

    function updateTenantUrlPreview() {
        const form = $('tenant-form')?.elements;
        const preview = $('tenant-url-preview');
        if (!form || !preview) return;
        const port = form.port.value || '3101';
        preview.textContent = `http://localhost:${port}`;
    }

    function show(loggedIn) {
        $('login-view').hidden = loggedIn;
        $('app-view').hidden = !loggedIn;
        $('logout').hidden = !loggedIn;
        const navLinks = $('nav-center-links');
        if (navLinks) navLinks.hidden = !loggedIn;
        const navPort = $('nav-next-port-pill');
        if (navPort) navPort.hidden = !loggedIn;
        const navUser = $('nav-user-tag');
        if (navUser) navUser.hidden = !loggedIn;
        if (!loggedIn) {
            const created = $('created');
            if (created) created.hidden = true;
        }
    }

    async function refresh() {
        render(await api('/api/tenants'));
    }

    async function guarded(button, action) {
        if (button) button.disabled = true;
        try {
            await action();
        } catch (error) {
            if (error.status === 401) show(false);
            message(error.message);
        } finally {
            if (button) button.disabled = false;
        }
    }

    // Toggle password visibility helper
    function setupPasswordToggle(buttonId, inputId) {
        const btn = $(buttonId);
        const input = $(inputId);
        if (!btn || !input) return;
        btn.addEventListener('click', () => {
            const isPassword = input.type === 'password';
            input.type = isPassword ? 'text' : 'password';
            btn.textContent = isPassword ? '🔒' : '👁';
        });
    }

    // Events
    $('login-form')?.addEventListener('submit', (event) => {
        event.preventDefault();
        guarded(event.submitter, async () => {
            csrf = (await api('/api/login', { password: $('login-password').value })).csrf;
            $('login-password').value = '';
            show(true);
            message('Đăng nhập thành công vào NKiot Control Plane.', true);
            await refresh();
        });
    });

    $('tenant-form')?.addEventListener('submit', (event) => {
        event.preventDefault();
        const form = event.target.elements;
        guarded(event.submitter, async () => {
            const { tenant } = await api('/api/tenants', {
                id: form.id.value.trim(),
                name: form.name.value,
                username: form.username.value,
                password: form.password.value.trim() || 'admin1234',
                port: Number(form.port.value),
                phone: form.phone?.value || '',
                category: form.category?.value || '',
                email: form.email?.value || '',
                note: form.note?.value || ''
            });
            form.password.value = '';
            form.id.value = '';
            form.name.value = '';
            if (form.phone) form.phone.value = '';
            if (form.category) form.category.value = '';
            if (form.email) form.email.value = '';
            if (form.note) form.note.value = '';

            const createdLink = $('created-link');
            if (createdLink) {
                createdLink.href = tenant.url;
                createdLink.textContent = `Mở POS ${tenant.name} (${tenant.url}) ↗`;
            }
            $('created').hidden = false;

            if (tenant.running) {
                message(
                    `Đã tạo và khởi chạy thành công cửa hàng ${tenant.id}. Mật khẩu POS được mã hóa trong DB riêng.`,
                    true
                );
            } else {
                message(`Đã tạo ${tenant.id} nhưng chưa khởi chạy được POS: ${tenant.startError}`);
            }
            await refresh();
        });
    });

    // Reset Password Modal
    function openResetPwdModal(tenant) {
        const modal = $('modal-reset-pwd');
        if (!modal) return;
        $('reset-pwd-tenant-id').value = tenant.id;
        $('reset-pwd-tenant-name').textContent = `${tenant.name} (Mã: ${tenant.id})`;
        $('reset-pwd-input').value = '';
        modal.hidden = false;
        modal.classList.add('show');
        setTimeout(() => $('reset-pwd-input')?.focus(), 50);
    }

    function closeResetPwdModal() {
        const modal = $('modal-reset-pwd');
        if (modal) {
            modal.classList.remove('show');
            modal.hidden = true;
        }
        const input = $('reset-pwd-input');
        if (input) input.value = '';
    }

    closeResetPwdModal();

    $('btn-close-pwd-modal')?.addEventListener('click', closeResetPwdModal);
    $('btn-cancel-pwd')?.addEventListener('click', closeResetPwdModal);
    $('modal-reset-pwd')?.addEventListener('click', (e) => {
        if (e.target === $('modal-reset-pwd')) closeResetPwdModal();
    });

    $('form-reset-pwd')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const id = $('reset-pwd-tenant-id').value;
        const password = $('reset-pwd-input').value;
        guarded(e.submitter, async () => {
            await api('/api/tenants/reset-password', { id, password });
            closeResetPwdModal();
            message(`Đã đặt lại mật khẩu admin cho cửa hàng ${id} thành công!`, true);
        });
    });

    // Dismiss created banner
    $('btn-dismiss-created')?.addEventListener('click', () => {
        const created = $('created');
        if (created) created.hidden = true;
    });

    // Copy created URL button
    $('btn-copy-created')?.addEventListener('click', async () => {
        const link = $('created-link');
        const btn = $('btn-copy-created');
        if (!link || !link.href) return;
        try {
            await navigator.clipboard.writeText(link.href);
            const original = btn.textContent;
            btn.textContent = '✓ Đã sao chép!';
            setTimeout(() => {
                btn.textContent = original;
            }, 2000);
        } catch {
            // ignore
        }
    });

    $('partner-form')?.addEventListener('submit', (event) => {
        event.preventDefault();
        const form = event.target.elements;
        const active = event.submitter?.value !== 'unlink';
        guarded(event.submitter, async () => {
            await api('/api/partners', { a: form.a.value, b: form.b.value, active });
            message(
                active
                    ? `Đã thiết lập liên kết kho giữa ${form.a.value} và ${form.b.value}.`
                    : `Đã hủy liên kết kho giữa ${form.a.value} và ${form.b.value}.`,
                true
            );
            await refresh();
        });
    });

    $('logout')?.addEventListener('click', (event) => {
        guarded(event.currentTarget, async () => {
            await api('/api/logout', {});
            csrf = '';
            show(false);
            message('Đã đăng xuất an toàn.', true);
        });
    });

    // Live search input
    $('tenant-search')?.addEventListener('input', (event) => {
        activeSearchQuery = event.target.value || '';
        $('btn-clear-tenant-search').hidden = !activeSearchQuery;
        renderTenantRows(currentTenants);
    });

    $('btn-clear-tenant-search')?.addEventListener('click', () => {
        const input = $('tenant-search');
        if (!input) return;
        input.value = '';
        activeSearchQuery = '';
        $('btn-clear-tenant-search').hidden = true;
        input.focus();
        renderTenantRows(currentTenants);
    });

    $('tenant-search')?.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        const input = event.target;
        if (!input.value) return;
        event.stopPropagation();
        input.value = '';
        activeSearchQuery = '';
        $('btn-clear-tenant-search').hidden = true;
        renderTenantRows(currentTenants);
    });

    // Filter pills click listener
    $('tenant-filter-pills')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.filter-pill');
        if (!btn) return;
        document
            .querySelectorAll('#tenant-filter-pills .filter-pill')
            .forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        activeFilterStatus = btn.dataset.status || 'all';
        renderTenantRows(currentTenants);
    });

    // Port input preview listener
    const portInput = $('tenant-port');
    if (portInput) {
        portInput.addEventListener('input', updateTenantUrlPreview);
    }

    // Password toggles
    setupPasswordToggle('btn-toggle-login-pwd', 'login-password');
    setupPasswordToggle('btn-toggle-tenant-pwd', 'tenant-password');

    // Escape key closes any open Super Admin modal
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const confirmModal = $('modal-confirm-action');
        if (confirmModal && !confirmModal.hidden) {
            $('btn-cancel-confirm-modal')?.click();
            return;
        }
        const pwdModal = $('modal-reset-pwd');
        if (pwdModal && !pwdModal.hidden) {
            closeResetPwdModal();
        }
    });

    // Navigation tabs smooth scroll and active state
    document.querySelectorAll('.nav-tab-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.nav-tab-btn').forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            const targetId = btn.getAttribute('href');
            if (targetId && targetId.startsWith('#')) {
                const target = document.querySelector(targetId);
                if (target) {
                    e.preventDefault();
                    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }
        });
    });

    // Initial session check
    guarded(null, async () => {
        try {
            csrf = (await api('/api/session')).csrf;
        } catch (error) {
            if (error.status === 401) return show(false);
            throw error;
        }
        show(true);
        await refresh();
    });
})();
