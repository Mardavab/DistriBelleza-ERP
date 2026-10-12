/**
 * Configuración de Next.js.
 *
 * Incluye headers de seguridad en TODAS las respuestas:
 * - Cache-Control: no-store en /login para que el navegador no muestre
 *   versiones cacheadas (bfcache) tras un logout, y un atacante con
 *   acceso físico no pueda usar Back para ver la página protegida.
 * - X-Frame-Options DENY para evitar clickjacking.
 * - Strict-Transport-Security para forzar HTTPS en producción.
 * - X-Content-Type-Options nosniff.
 * - Referrer-Policy strict-origin-when-cross-origin.
 */

/** @type {import('next').NextConfig} */
const nextConfig = {
    async headers() {
        return [
            // /login no debe quedar en bfcache (back-button post-logout).
            {
                source: '/login',
                headers: [
                    { key: 'Cache-Control', value: 'no-store, must-revalidate, private' },
                    { key: 'Pragma', value: 'no-cache' },
                    { key: 'Expires', value: '0' },
                ],
            },
            // /accept-invinaction: tampoco en cache (contiene tokens sensibles).
            {
                source: '/accept-invitation',
                headers: [
                    { key: 'Cache-Control', value: 'no-store, must-revalidate, private' },
                ],
            },
            // Headers de seguridad globales.
            {
                source: '/(.*)',
                headers: [
                    { key: 'X-Frame-Options', value: 'DENY' },
                    { key: 'X-Content-Type-Options', value: 'nosniff' },
                    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
                    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
                    // HSTS — solo aplica en producción (HTTPS).
                    {
                        key: 'Strict-Transport-Security',
                        value: 'max-age=31536000; includeSubDomains',
                    },
                ],
            },
        ];
    },
};

module.exports = nextConfig;