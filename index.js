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

app.use(
    cors({
        origin: '*',
        methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: ['Content-Type'],
    })
)

// Health check
app.get('/health', (req, res) => res.send('OK'))

// API endpoint
app.post('/api/gen-image', async (req, res) => {
    try {
        res.setHeader('Content-Type', 'text/event-stream')
        res.setHeader('Cache-Control', 'no-cache')
        res.setHeader('Connection', 'keep-alive')

        for await (const chunk of handleDesignRequest(req.body)) {
            res.write(`data: ${JSON.stringify(chunk)}\n\n`)
        }

        res.end()
    } catch (err) {
        console.error(err)
        if (!res.headersSent) res.status(500).json({ error: err.message })
        else {
            res.write(JSON.stringify({ error: err.message }))
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
