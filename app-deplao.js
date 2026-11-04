'use strict';
let deplaoBranch = '',
    deplaoOffset = 0,
    deplaoGeneration = 0,
    deplaoBusy = false;
const depEl = (id) => document.getElementById(`deplao-${id}`);
const depStatus = (text) => {
    depEl('status').textContent = text;
};
const depStorageKey = () => `nkiot.deplao.last.${KVStore.user?.id || ''}`;
function depUuid() {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
let deplaoJobId = '';
function depOptions(id, rows, label) {
    depEl(id).replaceChildren(new Option(label, ''));
    for (const row of rows) {
        const option = new Option(row.name, row.id);
        option.disabled = row.disabled === true;
        depEl(id).appendChild(option);
    }
}
function depProducts() {
    return (KVStore.data.products || []).filter(
        (p) => (p.branch || FALLBACK_BRANCH) === deplaoBranch && p.status === 'active'
    );
}
function openDeplao(productId = '') {
    if (KVStore.user?.role !== 'admin')
        return showToast('Chỉ quản trị viên được dùng kết nối Deplao.', 'warning');
    if (getCurrentBranch() === ALL_BRANCHES)
        return showToast('Chọn một chi nhánh cụ thể.', 'warning');
    if (!deplaoBusy) {
        deplaoBranch = getCurrentBranch();
        deplaoGeneration++;
        depOptions(
            'product',
            depProducts().map((p) => ({ id: p.id, name: `${p.code} · ${p.name}` })),
            'Chọn sản phẩm'
        );
        depEl('product').value = productId;
        deplaoProductChanged();
        depOptions('account', [], 'Kiểm tra kết nối để chọn tài khoản');
        deplaoClearThreads();
        try {
            deplaoJobId = sessionStorage.getItem(depStorageKey()) || '';
        } catch {}
        depEl('fields').disabled = !!deplaoJobId;
        depStatus(
            deplaoJobId
                ? `Có lượt gửi trước: ${deplaoJobId}. Bấm kiểm tra trước khi gửi mới.`
                : `Chi nhánh: ${deplaoBranch}. Chọn sản phẩm, ảnh và đúng hội thoại trước khi gửi.`
        );
    }
    depEl('modal').classList.remove('hidden');
}
function deplaoProductChanged() {
    const p = depProducts().find((p) => p.id === depEl('product').value);
    depOptions(
        'imei',
        (p?.hasImei ? p.imeis || [] : []).map((id) => ({ id, name: id })),
        p?.hasImei ? 'Chọn máy còn tồn' : 'Không quản lý IMEI'
    );
    depEl('imei').disabled = !p?.hasImei;
    deplaoImagesChanged();
}
function deplaoImagesChanged() {
    const p = depProducts().find((p) => p.id === depEl('product').value);
    const serial = depEl('imei').value;
    const images = p?.hasImei ? p.imeiDetails?.[serial]?.images : p?.images;
    depEl('images').replaceChildren();
    for (const url of new Set(Array.isArray(images) ? images : [])) {
        if (!/^\/uploads\/[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(jpg|jpeg|png|webp|gif)$/i.test(url))
            continue;
        const label = document.createElement('label');
        label.className = 'flex flex-col gap-1 border rounded-lg p-2';
        const image = document.createElement('img');
        image.src = url;
        image.alt = p.name;
        image.className = 'w-24 h-24 object-contain';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = url;
        input.setAttribute('aria-label', `Chọn ảnh ${depEl('images').childElementCount + 1}`);
        label.append(image, input);
        depEl('images').appendChild(label);
    }
    if (!depEl('images').childElementCount)
        depEl('images').textContent =
            'Chưa có ảnh riêng hợp lệ. Bản đầu chỉ gửi ảnh upload nội bộ, không lấy ảnh máy khác.';
    depEl('text').value = p
        ? `${p.name}${serial ? ` · Máy ***${serial.slice(-4)}` : ''}\nGiá tư vấn: ${formatVND(p.price)} đ`
        : '';
}
function deplaoClearThreads() {
    deplaoGeneration++;
    deplaoOffset = 0;
    depOptions('thread', [], 'Tìm và chọn hội thoại');
    depEl('more').disabled = true;
}
async function deplaoConnect() {
    const generation = ++deplaoGeneration;
    depStatus('Đang kiểm tra kết nối…');
    try {
        const out = await KVStore.request(
            `/api/deplao/connection?branch=${encodeURIComponent(deplaoBranch)}`
        );
        if (generation !== deplaoGeneration) return;
        depOptions(
            'account',
            out.accounts.map((a) => ({
                id: a.id,
                name: `${a.name} · ${a.channel}${a.online ? '' : ' (offline)'}`,
                disabled: !a.online
            })),
            'Chọn tài khoản gửi'
        );
        deplaoClearThreads();
        depStatus('Kết nối thành công. Chỉ hiển thị tài khoản được gán cho chi nhánh.');
    } catch (e) {
        if (generation === deplaoGeneration) depStatus(e.message);
    }
}
function deplaoShowJob(job) {
    const labels = {
        uploading: 'Đang upload (nếu server đã restart, cần đối soát)',
        sending: 'Đang gửi / chưa xác nhận',
        sent: 'Deplao xác nhận đã gửi',
        failed: 'Dừng trước bước gửi chat',
        needs_review: 'Có thể đã gửi một phần hoặc chưa rõ kết quả — kiểm tra Deplao'
    };
    depStatus(
        `${labels[job.status] || job.status}\nUpload: ${job.uploaded}/${job.total}\nMã lượt: ${job.id}\n${job.result?.error || ''}`
    );
}
async function deplaoCheckJob() {
    if (!deplaoJobId) return depStatus('Chưa có mã lượt gửi trong phiên này.');
    try {
        const out = await KVStore.request(`/api/deplao/jobs/${deplaoJobId}`);
        deplaoShowJob(out.job);
    } catch (e) {
        depStatus(`${e.message}\nGiữ mã ${deplaoJobId}; không gửi lại nếu chưa đối soát.`);
    }
}
async function deplaoNewSend() {
    if (deplaoBusy) return;
    if (
        deplaoJobId &&
        !(await askAction({
            title: 'Chuẩn bị lượt mới',
            message:
                'Bạn đã kiểm tra lịch sử Deplao của lượt trước? Lượt mới có thể gửi trùng nếu lượt trước đã gửi.',
            confirmText: 'Đã kiểm tra, tạo lượt mới'
        }))
    )
        return;
    deplaoJobId = '';
    try {
        sessionStorage.removeItem(depStorageKey());
    } catch {}
    depEl('fields').disabled = false;
    depStatus('Chuẩn bị lượt mới. Chọn lại ảnh và người nhận trước khi xác nhận.');
}
async function deplaoConfirmSend() {
    if (deplaoBusy || deplaoJobId) return;
    if (getCurrentBranch() !== deplaoBranch)
        return depStatus('Chi nhánh đã thay đổi. Đóng và mở lại màn hình gửi.');
    const images = [...depEl('images').querySelectorAll('input:checked')].map((el) => el.value);
    if (!images.length || images.length > 10 || !depEl('account').value || !depEl('thread').value)
        return depStatus('Chọn 1–10 ảnh, tài khoản gửi và hội thoại nhận.');
    const input = {
        id: depUuid(),
        branch: deplaoBranch,
        productId: depEl('product').value,
        imei: depEl('imei').value,
        accountId: depEl('account').value,
        threadId: depEl('thread').value,
        images,
        text: depEl('text').value,
        confirmed: true
    };
    const account = depEl('account').selectedOptions[0].textContent;
    const thread = depEl('thread').selectedOptions[0].textContent;
    deplaoBusy = true;
    depEl('fields').disabled = true;
    try {
        const confirmed = await askAction({
            title: 'Gửi ảnh thật cho khách',
            message: `Từ: ${account}\nĐến: ${thread}\nSố ảnh: ${images.length}\n${input.text}`,
            confirmText: 'Gửi ảnh cho người nhận này'
        });
        if (!confirmed) {
            depEl('fields').disabled = false;
            return;
        }
        deplaoJobId = input.id;
        try {
            sessionStorage.setItem(depStorageKey(), input.id);
        } catch {}
        depStatus(`Đang upload và gửi… Mã ${input.id}. Không bấm gửi lại nếu mạng bị ngắt.`);
        const out = await KVStore.request('/api/deplao/send', {
            method: 'POST',
            body: JSON.stringify(input)
        });
        deplaoShowJob(out.job);
    } catch (e) {
        depStatus(`${e.message}\nMã: ${deplaoJobId}. Bấm kiểm tra lượt gửi; không tự gửi lại.`);
    } finally {
        deplaoBusy = false;
    }
}

async function deplaoSearch(offset = 0) {
    const account = depEl('account').value;
    if (!account) return depStatus('Chọn tài khoản gửi trước.');
    const generation = ++deplaoGeneration;
    depOptions('thread', [], 'Đang tìm…');
    depEl('more').disabled = true;
    try {
        const query = new URLSearchParams({
            branch: deplaoBranch,
            accountId: account,
            search: depEl('search').value,
            offset: String(offset)
        });
        const out = await KVStore.request(`/api/deplao/conversations?${query}`);
        if (generation !== deplaoGeneration) return;
        depOptions(
            'thread',
            out.conversations.map((r) => ({
                id: r.id,
                name: `${r.name} · ${r.phone} · ${r.type} · ${r.id}`
            })),
            'Chọn đúng người nhận'
        );
        deplaoOffset = offset;
        depEl('more').disabled = !out.hasMore;
        depStatus(`${out.conversations.length} hội thoại ở trang này.`);
    } catch (e) {
        if (generation === deplaoGeneration) depStatus(e.message);
    }
}
