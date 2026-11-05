/* global deplao */
'use strict';
const el = (id) => document.getElementById(id);
let page = 1,
    query = {},
    generation = 0,
    ready = false;
function node(tag, text, className) {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (className) n.className = className;
    return n;
}
function renderProduct(p, epoch) {
    const card = node('article', undefined, 'card');
    card.append(
        node('h2', p.name),
        node('p', p.code, 'muted'),
        node('p', `${new Intl.NumberFormat('vi-VN').format(p.price)} đ`, 'price'),
        node('p', p.description || 'Chưa có mô tả.', 'description')
    );
    const select = node('select');
    select.setAttribute('aria-label', `Chọn máy của ${p.name}`);
    select.append(new Option('Ảnh chung sản phẩm', ''));
    for (const [i, unit] of p.units.entries())
        select.append(new Option(`Máy ${unit.serialMasked} · ${unit.conditionDetail}`, String(i)));
    const detail = node('p', p.conditionDetail, 'muted');
    const gallery = node('div', undefined, 'gallery');
    const actions = node('div', undefined, 'actions');
    const insert = node('button', 'Chèn tên và mô tả vào ô soạn');
    insert.type = 'button';
    insert.addEventListener('click', async () => {
        if (!deplao.ui.context()?.threadId) {
            el('status').textContent = 'Mở một hội thoại trước khi chèn nội dung.';
            return;
        }
        try {
            await deplao.ui.insertComposerText(
                `${p.name}\n${p.description}\n${detail.textContent}\nGiá: ${new Intl.NumberFormat('vi-VN').format(p.price)} đ`
            );
            el('status').textContent = 'Đã chèn vào ô soạn; chưa gửi cho khách.';
        } catch {
            el('status').textContent = 'Không thể chèn nội dung trong ngữ cảnh hiện tại.';
        }
    });
    actions.append(insert);
    function photos() {
        gallery.replaceChildren();
        const unit = select.value === '' ? null : p.units[Number(select.value)];
        detail.textContent = unit ? unit.conditionDetail : p.conditionDetail;
        const urls = unit ? unit.images : p.images;
        if (!urls.length) {
            gallery.append(node('p', 'Chưa có ảnh riêng cho mục này.', 'muted'));
            return;
        }
        for (const [i, url] of urls.entries()) {
            const box = node('div', undefined, 'photo');
            const button = node('button', `Xem ảnh ${i + 1}`);
            button.type = 'button';
            button.addEventListener('click', async () => {
                button.disabled = true;
                button.textContent = 'Đang tải…';
                try {
                    const out = await deplao.backend.call('image', { path: url });
                    if (generation !== epoch || !box.isConnected) return;
                    if (
                        !/^data:image\/(jpeg|png|gif|webp);base64,[A-Za-z0-9+/]*={0,2}$/.test(
                            out.src
                        )
                    )
                        throw new Error('invalid');
                    const image = node('img');
                    image.src = out.src;
                    image.alt = `${p.name} — ảnh ${i + 1}`;
                    box.replaceChildren(image);
                } catch (e) {
                    if (generation !== epoch || !box.isConnected) return;
                    button.disabled = false;
                    button.textContent = `Thử lại ảnh ${i + 1}`;
                    el('status').textContent = e.message || 'Không tải được ảnh.';
                }
            });
            box.append(button);
            gallery.append(box);
        }
    }
    select.addEventListener('change', photos);
    if (p.units.length) card.append(select);
    card.append(detail, gallery, actions);
    photos();
    return card;
}
async function search(nextPage) {
    if (!ready) return;
    const epoch = ++generation;
    el('prev').disabled = el('next').disabled = true;
    el('products').replaceChildren();
    el('status').textContent = 'Đang tìm sản phẩm…';
    try {
        const result = await deplao.backend.call('search', { ...query, page: nextPage });
        if (epoch !== generation) return;
        page = result.page;
        el('page').textContent = `Trang ${page}`;
        for (const p of result.products) el('products').append(renderProduct(p, epoch));
        el('prev').disabled = page <= 1;
        el('next').disabled = !result.hasMore;
        el('status').textContent = result.products.length
            ? `${result.products.length} sản phẩm. Bấm từng ảnh để tải; tồn kho có thể thay đổi.`
            : 'Không tìm thấy sản phẩm. Thử bỏ lọc còn hàng hoặc đổi từ khóa.';
    } catch (e) {
        if (epoch === generation)
            el('status').textContent = e.message || 'Không tải được sản phẩm.';
    }
}
el('search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    query = {
        q: el('query').value,
        minPrice: el('min-price').value,
        maxPrice: el('max-price').value,
        inStock: el('in-stock').checked
    };
    search(1);
});
el('prev').addEventListener('click', () => search(page - 1));
el('next').addEventListener('click', () => search(page + 1));
deplao.ready(() => {
    ready = true;
    el('status').textContent =
        'Cấu hình URL và token tại Cài đặt ứng dụng, sau đó bấm Tìm sản phẩm.';
});
