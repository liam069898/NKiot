'use strict';
const MAX_BODY = 2 * 1024 * 1024;
const MAX_ITEMS = 5000;
function validateSnapshot(snapshot) {
    if (!Array.isArray(snapshot.items) || snapshot.items.length > MAX_ITEMS)
        throw Object.assign(new Error(`Catalog Hub không được vượt ${MAX_ITEMS} sản phẩm.`), {
            status: 400
        });
    if (Buffer.byteLength(JSON.stringify(snapshot)) > MAX_BODY)
        throw Object.assign(
            new Error('Catalog Hub vượt giới hạn 2 MB. Giảm sản phẩm hoặc chi tiết chia sẻ.'),
            { status: 413 }
        );
}
module.exports = { MAX_BODY, MAX_ITEMS, validateSnapshot };
