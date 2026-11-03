module.exports = {
    content: [
        './index.html',
        './app.js',
        './app-*.js',
        './ui-safety.js',
        './client-store.js',
        './catalog-service.js'
    ],
    theme: {
        extend: {
            borderRadius: {
                none: '0',
                xs: '3px',
                sm: '4px',
                DEFAULT: '6px',
                md: '6px',
                lg: '6px',
                xl: '6px',
                '2xl': '8px',
                '3xl': '10px',
                '4xl': '12px',
                full: '9999px'
            },
            boxShadow: {
                'ios-card': 'none',
                'ios-modal': '0 10px 25px -5px rgba(0, 0, 0, 0.1)',
                'ios-menu': '0 4px 12px rgba(0, 0, 0, 0.08)',
                'ios-btn': 'none'
            },
            height: { 7.5: '30px' }
        }
    }
};
