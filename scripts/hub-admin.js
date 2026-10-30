'use strict';
// Hub CLI: tạo tenant/API key và liên kết đối tác.
//   node scripts/hub-admin.js create-tenant kalo "Kalo"
//   node scripts/hub-admin.js link kalo techmotion
//   node scripts/hub-admin.js unlink kalo techmotion
const hubDb = require('../hub-db');
const { createTenant, linkPartners } = require('../hub-server');
const [command, a, b] = process.argv.slice(2);
hubDb.initDb();
try {
    if (command === 'create-tenant' && a && b) {
        const key = createTenant({ id: a, name: b });
        console.log(`Tenant ${a} sẵn sàng. Đặt cho server ${a}.nkiot.site (chỉ hiển thị một lần):`);
        console.log(`NKIOT_HUB_API_KEY=${key}`);
    } else if ((command === 'link' || command === 'unlink') && a && b) {
        linkPartners(a, b, command === 'link' ? 'active' : 'removed');
        console.log(`${command === 'link' ? 'Đã liên kết' : 'Đã hủy liên kết'} ${a} <-> ${b}.`);
    } else {
        console.log('Dùng: create-tenant <id> <tên> | link <id> <id> | unlink <id> <id>');
        process.exitCode = 1;
    }
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
} finally {
    hubDb.closeDb();
}
