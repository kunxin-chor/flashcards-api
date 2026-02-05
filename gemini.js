require('dotenv').config();

const { GoogleGenAI } = require('@google/genai');
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp';
const { quizUserTool, addFlashcardTool, geminiTools } = require('./tools');

function serializeFlashcard(card) {
    if (!card) return card;
    const { _id, ...rest } = card;
    return { ...rest, id: _id?.toString?.() ?? _id };
}

async function generateAssistantResponse(userId, message) {
    const tools = geminiTools;
    const systemPrompt = `You are a flashcard assistant.

You MUST follow these rules:
- If the user asks to add/create/save/remember/make a new flashcard (or gives a front/back), you MUST call the tool "addFlashcardTool" exactly once.
- If the user asks to test/quiz/practice/revise (any kind of test), you MUST call the tool "quizUserTool" exactly once.
- If the user does not ask for either of the above, do NOT call any tools and respond normally.

Tool usage rules:
- Do not ask follow-up questions.
- Do not invent extra fields.
- For addFlashcardTool: extract "front" and "back" as plain strings.
- If the user wants to add a flashcard but only gives a TOPIC (no explicit front/back), you MUST INFER a simple beginner-friendly flashcard (one card only) based on the topic.
- Keep inferred content short and clear.
- For quizUserTool: call it with no arguments.

Inference examples:
The following is ONLY an example of the format. Do NOT copy it verbatim in your tool call unless the user's topic is exactly the same.
You MUST generate a flashcard that matches the user's topic.

Example user topic: "basic N5 Japanese grammar"
Example tool call args (illustrative only):
front: "N5 grammar: How do you say 'I am a student' in Japanese?"
back: "わたしはがくせいです。 (watashi wa gakusei desu). Pattern: A は B です (A wa B desu)."
`;
    const response = await ai.models.generateContent({
        model: MODEL,
        contents: systemPrompt + "\nUser message: " + message,
        config: {
            tools
        }
    });
    const toolCall = response?.functionCalls[0];
    if (!toolCall) {
        return {
            response:response.text,
            toolCalled:null
        }
    } else {
        if (toolCall.name =="addFlashcardTool") {
            const result = await addFlashcardTool(
                toolCall.args.front,
                toolCall.args.back,
                userId
            );
            return {
                response:{
                    front:toolCall.args.front,
                    back:toolCall.args.back,
                    id: result?.toString?.() ?? result
                },
                toolCalled:"addFlashcardTool"
            }
        } else if (toolCall.name == "quizUserTool") {
            const result = await quizUserTool(userId);
            return {
                response:serializeFlashcard(result),
                toolCalled:"quizUserTool"
            };
        }
    }
    
}


module.exports = {
    ai, MODEL, generateAssistantResponse
}