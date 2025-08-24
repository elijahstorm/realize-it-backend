import { handleDesignRequest } from './app/designer-agent.js'
import cors from 'cors'
import { configDotenv } from 'dotenv'
import express from 'express'

configDotenv()

const app = express()
const PORT = process.env.PORT || 8080

// Middleware
app.use(cors())
app.use(express.json())

// Health check
app.get('/health', (req, res) => res.send('OK'))

// API endpoint
app.post('/api/gen-image', async (req, res) => {
    try {
        res.setHeader('Content-Type', 'application/json') // or 'text/event-stream' if using SSE
        res.setHeader('Cache-Control', 'no-cache')
        res.setHeader('Connection', 'keep-alive')

        // If handleDesignRequest yields chunks:
        for await (const chunk of handleDesignRequest(req.body)) {
            res.write(JSON.stringify(chunk) + '\n') // send each chunk
        }

        res.end() // close stream
    } catch (err) {
        console.error(err)
        if (!res.headersSent) {
            res.status(500).json({ error: 'Internal Server Error' })
        } else {
            res.write(JSON.stringify({ error: 'Internal Server Error' }))
            res.end()
        }
    }
})

// Fallback route
app.use((req, res) => res.status(404).send('Not Found'))

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on http://0.0.0.0:${PORT}`)
})
