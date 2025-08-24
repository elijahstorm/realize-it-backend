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
        const response = await handleDesignRequest(req.body)
        res.json(response)
    } catch (err) {
        console.error(err)
        res.status(500).json({ error: 'Internal Server Error' })
    }
})

// Fallback route
app.use((req, res) => res.status(404).send('Not Found'))

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on http://0.0.0.0:${PORT}`)
})
