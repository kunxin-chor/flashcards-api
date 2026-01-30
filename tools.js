require("dotenv").config();
const { ObjectId } = require("mongodb");
const { connect } = require("./db");

const dbname = process.env.DB_NAME;
const mongoUri = process.env.MONGO_URI;

function coerceObjectId(value) {
    if (!value) return value;
    if (value instanceof ObjectId) return value;
    return new ObjectId(value);
}

async function addFlashcardTool( front, back, userId ) {
    const db = await connect(mongoUri, dbname);
    const collection = db.collection("flashcards");
    const result = await collection.insertOne({ front, back, userId: coerceObjectId(userId) });
    return result.insertedId;
}

async function quizUserTool( userId ) {
    const db = await connect(mongoUri, dbname);
    const cards = await db
        .collection("flashcards")
        .aggregate([
            { $match: { userId: coerceObjectId(userId) } },
            { $sample: { size: 1 } }
        ])
        .toArray();

    return cards[0] || null;
}

const geminiTools = [
    {
        functionDeclarations: [
            {
                name: "addFlashcardTool",
                description: "Create a new flashcard for the user.",
                parameters: {
                    type: "object",
                    properties: {
                        front: { type: "string", description: "The question/prompt side of the flashcard." },
                        back: { type: "string", description: "The answer/explanation side of the flashcard." }
                    },
                    required: ["front", "back"]
                }
            },
            {
                name: "quizUserTool",
                description: "Pick one random flashcard belonging to the user and return it.",
                parameters: {
                    type: "object",
                    properties: {},
                    required: []
                  
                }
            }
        ]
    }
];

module.exports = {
    addFlashcardTool,
    quizUserTool,
    geminiTools
}