'use strict';
const { safeMediaUrl } = require('./constants');

// Validate new writes only; old records are rendered defensively rather than silently rewritten.
function validateMedia(record) {
    const reject = () => {
        throw Object.assign(new Error('Hình ảnh, video hoặc chi tiết IMEI không hợp lệ.'), {
            status: 422
        });
    };
    function fields(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) reject();
        if (
            value.images !== undefined &&
            (!Array.isArray(value.images) ||
                value.images.length > 20 ||
                value.images.some((url) => !safeMediaUrl(url)))
        )
            reject();
        if (value.videoUrl !== undefined && value.videoUrl !== '' && !safeMediaUrl(value.videoUrl))
            reject();
        if (
            value.condition !== undefined &&
            !['new', 'like_new', 'good', 'fair'].includes(value.condition)
        )
            reject();
        for (const key of ['conditionDetail', 'description'])
            if (
                value[key] !== undefined &&
                (typeof value[key] !== 'string' || value[key].length > 5000)
            )
                reject();
    }
    fields(record);
    if (record.imeiDetails !== undefined) {
        const details = record.imeiDetails;
        if (
            !details ||
            typeof details !== 'object' ||
            Array.isArray(details) ||
            Object.keys(details).length > 10000
        )
            reject();
        for (const [serial, value] of Object.entries(details)) {
            if (
                !serial ||
                serial.length > 200 ||
                ['__proto__', 'constructor', 'prototype'].includes(serial)
            )
                reject();
            fields(value);
        }
    }
}
module.exports = { validateMedia };
