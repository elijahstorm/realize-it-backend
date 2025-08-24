import { handleDesignRequest } from './app/designer-agent.js'

function withCORS(res) {
    res.headers.set('Access-Control-Allow-Origin', '*')
    res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    res.headers.set('Access-Control-Allow-Headers', '*')
    return res
}

const server = Bun.serve({
    idleTimeout: 0,
    port: process.env.PORT || 3000,
    async fetch(req) {
        const url = new URL(req.url)

        // Handle preflight CORS
        if (req.method === 'OPTIONS') {
            return withCORS(new Response(null, { status: 204 }))
        }

        if (url.pathname === '/health') {
            return withCORS(new Response('OK', { status: 200 }))
        }

        if (url.pathname === '/api/gen-image' && req.method === 'POST') {
            const body = await req.json()
            return withCORS(await handleDesignRequest(body))
        }

        return new Response('Not Found', { status: 404 })
    },
})

console.log(`🚀 Server running at http://localhost:${server.port}`)
