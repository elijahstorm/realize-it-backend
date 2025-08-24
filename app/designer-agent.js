import cloudinary from 'cloudinary'
import OpenAI from 'openai'

/**
 * Main function to handle design requests
 * @param {Object} body - JSON body with { context, messages }
 * @returns {Response} - SSE stream response
 */
export async function handleDesignRequest(body) {
    cloudinary.v2.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
    })

    const solarai = new OpenAI({
        apiKey: process.env.SOLARAI_API_KEY,
        baseURL: 'https://api.upstage.ai/v1',
    })
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        baseURL: 'https://api.openai.com/v1',
    })
    const IMAGE_MODEL = 'gpt-image-1'

    const designerAgentSystemPrompt = `You are an AI design assistant. This tool is called RealizeIt and it generates AI images and then makes real life products using those images. You will output JSON with the \`image_gen_prompt\` value being your summarized prompt to generate the AI image. you are located in the new design creation page. you are helping the user figure out what their initial deisgn idea is so we can generate it. you will also recieve feedback from the user and will make updates to your design prompt. Your aim is to find the user's perfect design. the design in their mind. the user might not always know what they want, so it's your job to find that out using follow up questions and leading idea suggestions. Always return structured json. Never reply with text or address the user's response directly. Behind the scenes, we use OpenAI's \`${IMAGE_MODEL}\` model for image gen. if you include the \`image_gen_prompt\` value, do not ask the user for any follow-ups like "any information before I generate the image?" because it will sound unnatural. You are automatically trigger an image render when the value is present. Instead you should mention to the user to wait for the image to finish loading, and then ask them if they wnat any changes.

Always respond with valid JSON in this exact format:
{
    "content": "your main response here. talk to the user here. ask follow ups to help get a clear picture of what the user wants.",
    "reasoning": "your thought process and reasoning here",
    "image_gen_prompt": "optional - only when ready to generate an image. we should be sure of the user's requested image before acting. image generation is expensive and we want to make sure we are ready to commit to a design before sending this. if the user is talking without a specific request, do not generate an iamge. providing this value will automatically trigger an image generation job."
}

Do not include any text outside of this JSON structure or the tool will break.`

    const { context, messages } = body

    const chatCompletion = await solarai.chat.completions.create({
        model: 'solar-pro2',
        messages: [
            { role: 'system', content: designerAgentSystemPrompt },
            { role: 'user', content: context.prompt },
            ...messages,
        ],
        stream: true,
    })

    const stream = new ReadableStream({
        async start(controller) {
            try {
                let accumulatedContent = ''
                let lastSentContentLength = 0
                let imageGenerationTriggered = false

                for await (const chunk of chatCompletion) {
                    const content = chunk.choices[0]?.delta?.content || ''
                    accumulatedContent += content

                    // Progressive streaming
                    const contentMatch = accumulatedContent.match(
                        /"content":\s*"([^"\\]*(\\.[^"\\]*)*)"/
                    )
                    if (contentMatch && contentMatch[1]) {
                        const extractedContent = contentMatch[1]
                        if (extractedContent.length > lastSentContentLength) {
                            const newContent = extractedContent.slice(lastSentContentLength)
                            const contentChunk = JSON.stringify({
                                content: newContent,
                                streaming: true,
                            })
                            controller.enqueue(
                                new TextEncoder().encode(`data: ${contentChunk}\n\n`)
                            )
                            lastSentContentLength = extractedContent.length
                        }
                    }

                    // Try to parse completed JSON
                    try {
                        const parsed = JSON.parse(accumulatedContent)

                        const responseChunk = JSON.stringify({
                            content: parsed.content,
                            reasoning: parsed.reasoning,
                            complete: true,
                        })
                        controller.enqueue(new TextEncoder().encode(`data: ${responseChunk}\n\n`))

                        if (parsed.image_gen_prompt && !imageGenerationTriggered) {
                            imageGenerationTriggered = true

                            const startChunk = JSON.stringify({
                                image_status: 'gen',
                                image_prompt: parsed.image_gen_prompt,
                            })
                            controller.enqueue(new TextEncoder().encode(`data: ${startChunk}\n\n`))

                            try {
                                const result = await openai.images.generate({
                                    model: IMAGE_MODEL,
                                    prompt: parsed.image_gen_prompt,
                                    size: '1024x1024',
                                })

                                if (!result?.data || !result?.data[0]?.b64_json) {
                                    throw new Error('OpenAI did not return b64_json for the image')
                                }

                                const image_base64 = result.data[0].b64_json

                                const uploadRes = await cloudinary.v2.uploader.upload(
                                    `data:image/png;base64,${image_base64}`,
                                    {
                                        folder: process.env.CLOUDINARY_FOLDER,
                                    }
                                )

                                const doneChunk = JSON.stringify({
                                    image_status: 'done',
                                    image_data: image_base64,
                                    image_prompt: parsed.image_gen_prompt,
                                    image_url: uploadRes.secure_url,
                                })

                                controller.enqueue(
                                    new TextEncoder().encode(`data: ${doneChunk}\n\n`)
                                )
                            } catch (imageError) {
                                console.error(imageError)
                                const errorChunk = JSON.stringify({
                                    image_status: 'error',
                                    image_error: imageError.message,
                                })
                                controller.enqueue(
                                    new TextEncoder().encode(`data: ${errorChunk}\n\n`)
                                )
                            }
                        }

                        break
                    } catch {
                        // incomplete JSON, continue
                    }
                }

                if (
                    accumulatedContent.trim() &&
                    !accumulatedContent.includes('"image_gen_prompt"')
                ) {
                    const contentMatch = accumulatedContent.match(
                        /"content":\s*"([^"\\]*(\\.[^"\\]*)*)"?/
                    )
                    const reasoningMatch = accumulatedContent.match(
                        /"reasoning":\s*"([^"\\]*(\\.[^"\\]*)*)"?/
                    )

                    if (contentMatch || reasoningMatch) {
                        const fallbackChunk = JSON.stringify({
                            content: contentMatch ? contentMatch[1] : '',
                            reasoning: reasoningMatch ? reasoningMatch[1] : 'Incomplete response',
                            complete: true,
                            recovered: true,
                        })
                        controller.enqueue(new TextEncoder().encode(`data: ${fallbackChunk}\n\n`))
                    } else {
                        const rawChunk = JSON.stringify({
                            content: accumulatedContent,
                            reasoning: 'Failed to parse structured response',
                            complete: true,
                            raw: true,
                        })
                        controller.enqueue(new TextEncoder().encode(`data: ${rawChunk}\n\n`))
                    }
                }

                controller.enqueue(
                    new TextEncoder().encode(`data: ${JSON.stringify({ done: true })}\n\n`)
                )
            } catch (err) {
                const errorChunk = JSON.stringify({
                    error: err.message,
                    complete: true,
                })
                controller.enqueue(new TextEncoder().encode(`data: ${errorChunk}\n\n`))
            } finally {
                controller.close()
            }
        },
    })

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
        },
    })
}
