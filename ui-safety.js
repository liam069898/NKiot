'use strict';
class HTMLValue {
    constructor(value) {
        this.value = value;
    }
    toString() {
        return this.value;
    }
}
function escapeHTML(value) {
    return String(value ?? '').replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
}
// Only literal markup and already-escaped template compositions use this helper.
function trustedHTML(value) {
    return new HTMLValue(String(value ?? ''));
}
function renderHTML(strings, ...values) {
    let result = strings[0];
    values.forEach((value, index) => {
        if (value instanceof HTMLValue) result += value.value;
        else {
            let text = String(value ?? '');
            // Legacy inline handlers contain quoted IDs. Escape for both JS and HTML contexts.
            if (
                /\bon\w+\s*=\s*"[^"]*$/.test(result) &&
                result.endsWith("'") &&
                strings[index + 1].startsWith("'")
            ) {
                text = text
                    .replace(/\\/g, '\\\\')
                    .replace(/'/g, "\\'")
                    .replace(/\r/g, '\\r')
                    .replace(/\n/g, '\\n')
                    .replace(/\u2028/g, '\\u2028')
                    .replace(/\u2029/g, '\\u2029');
            }
            result += escapeHTML(text);
        }
        result += strings[index + 1];
    });
    return new HTMLValue(result);
}
function renderMediaImages(container, images, onSelect = null) {
    if (!container) return;
    container.replaceChildren();
    for (const value of Array.isArray(images) ? images : []) {
        const url = safeMediaUrl(value);
        if (!url) continue;
        const image = document.createElement('img');
        image.src = url;
        image.alt = 'Ảnh sản phẩm';
        image.className = 'w-16 h-16 object-cover rounded-lg border border-gray-200';
        if (onSelect) {
            const button = document.createElement('button');
            button.type = 'button';
            button.addEventListener('click', () => onSelect(url));
            button.appendChild(image);
            container.appendChild(button);
        } else {
            const link = document.createElement('a');
            link.href = url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.appendChild(image);
            container.appendChild(link);
        }
    }
}
function printRegion(id, thermal = false, paperSize = 'k80') {
    const source = document.getElementById(id);
    if (!source) return;
    document.getElementById('print-root')?.remove();
    const root = document.createElement('section');
    root.id = 'print-root';
    root.dataset.thermal = String(thermal);
    root.dataset.paper = String(paperSize || 'k80');
    const clone = source.cloneNode(true);
    clone.removeAttribute('id');
    clone.className = '';
    clone.querySelectorAll('button,input[type="checkbox"],.no-print').forEach((el) => el.remove());
    clone.querySelectorAll('input,select,textarea').forEach((el) => {
        const text = document.createElement('span');
        text.textContent = el.value;
        el.replaceWith(text);
    });
    // Canvas pixels are not copied by cloneNode.
    const originals = source.querySelectorAll('canvas');
    clone.querySelectorAll('canvas').forEach((canvas, i) => {
        const image = document.createElement('img');
        image.src = originals[i].toDataURL();
        canvas.replaceWith(image);
    });
    root.appendChild(clone);
    document.body.appendChild(root);

    // In real browsers, wait for external images (e.g. VietQR, store logo) to finish loading
    const isJSDOM =
        typeof navigator !== 'undefined' &&
        navigator.userAgent &&
        navigator.userAgent.includes('jsdom');
    const images = Array.from(root.querySelectorAll('img')).filter(
        (img) => img.src && !img.complete
    );

    if (!isJSDOM && images.length > 0) {
        let printed = false;
        const doPrint = () => {
            if (printed) return;
            printed = true;
            window.print();
        };
        const timer = setTimeout(doPrint, 800);
        let pending = images.length;
        images.forEach((img) => {
            const onDone = () => {
                pending--;
                if (pending <= 0) {
                    clearTimeout(timer);
                    doPrint();
                }
            };
            img.addEventListener('load', onDone, { once: true });
            img.addEventListener('error', onDone, { once: true });
        });
    } else {
        window.print();
    }
}
window.addEventListener('afterprint', () => document.getElementById('print-root')?.remove());
