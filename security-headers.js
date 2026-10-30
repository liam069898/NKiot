'use strict';

// POS strict CSP waits until legacy inline event handlers and styles are removed; report-only
// records violations without breaking it. Admin portal already enforces the policy.
const CONTENT_SECURITY_POLICY =
    "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";

function securityHeaders({ enforceCsp = false } = {}) {
    return {
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'same-origin',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
        [enforceCsp ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only']:
            CONTENT_SECURITY_POLICY
    };
}

module.exports = { securityHeaders, CONTENT_SECURITY_POLICY };
