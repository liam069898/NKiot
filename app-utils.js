// --- UTILS & DATE HELPERS ---
function formatVND(num) {
    return (num || 0).toLocaleString('vi-VN');
}
function parseVND(str) {
    if (typeof str === 'number') return str;
    if (/^-/.test(String(str).trim())) return -parseInt(String(str).replace(/[^0-9]/g, ''), 10);
    return parseInt((str || '0').replace(/[^0-9]/g, ''), 10) || 0;
}
function readMoneyInVietnamese(n) {
    if (!n || isNaN(n) || n === 0) return 'Không đồng';
    n = Math.round(Math.abs(n));
    const digits = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
    const units = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ', 'triệu tỷ'];

    function readGroup(g, isFirst) {
        const h = Math.floor(g / 100);
        const t = Math.floor((g % 100) / 10);
        const u = g % 10;
        const res = [];
        if (h > 0 || !isFirst) {
            res.push(digits[h] + ' trăm');
        }
        if (t > 1) {
            res.push(digits[t] + ' mươi');
            if (u === 1) res.push('mốt');
            else if (u === 4) res.push('tư');
            else if (u === 5) res.push('lăm');
            else if (u > 0) res.push(digits[u]);
        } else if (t === 1) {
            res.push('mười');
            if (u === 5) res.push('lăm');
            else if (u > 0) res.push(digits[u]);
        } else {
            if ((h > 0 || !isFirst) && u > 0) {
                res.push('lẻ');
                res.push(digits[u]);
            } else if (u > 0 && isFirst && h === 0) {
                res.push(digits[u]);
            }
        }
        return res.join(' ');
    }

    const groups = [];
    let temp = n;
    while (temp > 0) {
        groups.push(temp % 1000);
        temp = Math.floor(temp / 1000);
    }

    const words = [];
    for (let i = groups.length - 1; i >= 0; i--) {
        const g = groups[i];
        if (g > 0) {
            const s = readGroup(g, i === groups.length - 1);
            if (s) {
                words.push(s);
                if (units[i]) words.push(units[i]);
            }
        }
    }

    const result = words.join(' ').trim() + ' đồng';
    return result.charAt(0).toUpperCase() + result.slice(1);
}
function getCurrentDateTimeString() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseRecordDate(str) {
    if (!str) return null;
    const parts = str.trim().split(' ');
    const datePart = parts[0];
    const segs = datePart.split('/');
    if (segs.length === 3) {
        const day = parseInt(segs[0], 10);
        const month = parseInt(segs[1], 10) - 1;
        const year = parseInt(segs[2], 10);
        let hours = 0,
            minutes = 0;
        if (parts[1]) {
            const timeSegments = parts[1].split(':');
            hours = parseInt(timeSegments[0], 10) || 0;
            minutes = parseInt(timeSegments[1], 10) || 0;
        }
        return new Date(year, month, day, hours, minutes);
    }
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
}

function matchesDateFilter(recordTimeStr, filterMode, customFromStr, customToStr) {
    if (!filterMode || filterMode === 'all') return true;
    const d = parseRecordDate(recordTimeStr);
    if (!d) return true;

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    if (filterMode === 'today') {
        return d >= todayStart && d <= todayEnd;
    } else if (filterMode === 'yesterday') {
        const yestStart = new Date(todayStart);
        yestStart.setDate(yestStart.getDate() - 1);
        const yestEnd = new Date(todayEnd);
        yestEnd.setDate(yestEnd.getDate() - 1);
        return d >= yestStart && d <= yestEnd;
    } else if (filterMode === '7days') {
        const past7 = new Date(todayStart);
        past7.setDate(past7.getDate() - 6);
        return d >= past7 && d <= todayEnd;
    } else if (filterMode === '30days') {
        const past30 = new Date(todayStart);
        past30.setDate(past30.getDate() - 29);
        return d >= past30 && d <= todayEnd;
    } else if (filterMode === 'this_month') {
        return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    } else if (filterMode === 'last_month') {
        const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        return (
            d.getFullYear() === lastMonthDate.getFullYear() &&
            d.getMonth() === lastMonthDate.getMonth()
        );
    } else if (filterMode === 'this_quarter') {
        const currentQuarter = Math.floor(now.getMonth() / 3);
        const recordQuarter = Math.floor(d.getMonth() / 3);
        return d.getFullYear() === now.getFullYear() && recordQuarter === currentQuarter;
    } else if (filterMode === 'this_year') {
        return d.getFullYear() === now.getFullYear();
    } else if (filterMode === 'custom') {
        const fromStr =
            customFromStr ||
            (typeof document !== 'undefined'
                ? document.getElementById('rep-date-from')?.value
                : '') ||
            '';
        const toStr =
            customToStr ||
            (typeof document !== 'undefined'
                ? document.getElementById('rep-date-to')?.value
                : '') ||
            '';
        if (fromStr) {
            const fromDate = new Date(fromStr + 'T00:00:00');
            if (!isNaN(fromDate.getTime()) && d < fromDate) return false;
        }
        if (toStr) {
            const toDate = new Date(toStr + 'T23:59:59.999');
            if (!isNaN(toDate.getTime()) && d > toDate) return false;
        }
        return true;
    }
    return true;
}

// Shared UI/export predicates; independent of rendering and pagination.
function matchesDocumentFilter(
    row,
    { q = '', date = 'all', status = 'all', kind, returned = false, starred = false } = {}
) {
    if (!matchesDateFilter(row.time, date)) return false;
    if (status === 'starred' && !starred) return false;
    if (status === 'cancelled' && row.status !== 'cancelled') return false;
    if (status === 'imported' && row.status === 'cancelled') return false;
    if (status === 'completed' && (row.status !== 'completed' || returned)) return false;
    if (status === 'returned' && !returned) return false;
    const values =
        kind === 'imports'
            ? [row.code, row.nccName, row.nccCode]
            : [row.code, row.customer, row.phone];
    return (
        !q ||
        values.some((v) =>
            String(v || '')
                .toLowerCase()
                .includes(q.trim().toLowerCase())
        )
    );
}

// Share date semantics with the paginated SQLite reader (no DOM access for supported presets).
if (typeof module !== 'undefined') module.exports = { parseRecordDate, matchesDateFilter };
