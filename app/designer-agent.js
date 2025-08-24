import cloudinary from 'cloudinary'
import OpenAI from 'openai'

export async function* handleDesignRequest(body) {
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
    })

    const IMAGE_MODEL = 'gpt-image-1'

    const { context, messages } = body

    const designerAgentSystemPrompt = `You are an AI design assistant. This tool is called RealizeIt and it generates AI images and then makes real life products using those images. You will output JSON with the \`image_gen_prompt\` value being your summarized prompt to generate the AI image. you are located in the new design creation page. you are helping the user figure out what their initial deisgn idea is so we can generate it. you will also recieve feedback from the user and will make updates to your design prompt. Your aim is to find the user's perfect design. the design in their mind. the user might not always know what they want, so it's your job to find that out using follow up questions and leading idea suggestions. Always return structured json. Never reply with text or address the user's response directly. Behind the scenes, we use OpenAI's \`${IMAGE_MODEL}\` model for image gen. if you include the \`image_gen_prompt\` value, do not ask the user for any follow-ups like "any information before I generate the image?" because it will sound unnatural. You are automatically trigger an image render when the value is present. Instead you should mention to the user to wait for the image to finish loading, and then ask them if they wnat any changes.

Always respond with valid JSON in this exact format:
{
    "content": "your main response here. talk to the user here. ask follow ups to help get a clear picture of what the user wants.",
    "reasoning": "your thought process and reasoning here",
    "image_gen_prompt": "optional - only when ready to generate an image. we should be sure of the user's requested image before acting. image generation is expensive and we want to make sure we are ready to commit to a design before sending this. if the user is talking without a specific request, do not generate an iamge. providing this value will automatically trigger an image generation job."
}

Do not include any text outside of this JSON structure or the tool will break.`

    const chatCompletion = await solarai.chat.completions.create({
        model: 'solar-pro2',
        messages: [
            { role: 'system', content: designerAgentSystemPrompt },
            { role: 'user', content: context.prompt },
            ...messages,
        ],
        stream: true,
    })

    let accumulatedContent = ''
    let lastSentLength = 0
    let imageTriggered = false

    for await (const chunk of chatCompletion) {
        const content = chunk.choices[0]?.delta?.content || ''
        accumulatedContent += content

        // Progressive content streaming
        const contentMatch = accumulatedContent.match(/"content":\s*"([^"\\]*(\\.[^"\\]*)*)"/)
        if (contentMatch && contentMatch[1].length > lastSentLength) {
            const newContent = contentMatch[1].slice(lastSentLength)
            lastSentLength = contentMatch[1].length
            yield { content: newContent, streaming: true }
        }

        // Try parsing completed JSON
        try {
            const parsed = JSON.parse(accumulatedContent)

            // Trigger image generation if prompt exists
            if (parsed.image_gen_prompt && !imageTriggered) {
                imageTriggered = true
                yield { image_status: 'gen', image_prompt: parsed.image_gen_prompt }

                try {
                    const result = await openai.images.generate({
                        model: IMAGE_MODEL,
                        prompt: parsed.image_gen_prompt,
                        size: '1024x1024',
                    })

                    const image_base64 = result.data[0]?.b64_json
                    if (!image_base64) throw new Error('No image returned from OpenAI')

                    const uploadRes = await cloudinary.v2.uploader.upload(
                        `data:image/png;base64,${image_base64}`,
                        { folder: process.env.CLOUDINARY_FOLDER }
                    )

                    yield {
                        image_status: 'done',
                        image_data: image_base64,
                        image_url: uploadRes.secure_url,
                        image_prompt: parsed.image_gen_prompt,
                    }
                } catch (imageErr) {
                    yield { image_status: 'error', image_error: imageErr.message }
                }
            }

            // Send final parsed JSON
            yield {
                content: parsed.content,
                reasoning: parsed.reasoning,
                complete: true,
            }
            break
        } catch {
            // JSON incomplete, continue streaming
        }
    }

    // Fallback if parsing never succeeded
    if (!accumulatedContent.includes('"content"')) {
        yield {
            content: accumulatedContent,
            reasoning: 'Failed to parse structured JSON',
            complete: true,
        }
    }
}
