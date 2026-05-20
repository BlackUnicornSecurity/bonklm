/**
 * UAT Test Fixtures - Safe Content
 * =================================
 *
 * This file contains test data for legitimate, safe content that should pass validation.
 */

export const safeQueries = [
  'Hello, how can you help me today?',
  'What are your capabilities?',
  'Tell me about your features.',
  'Can you help me write a resume?',
  'I need assistance with my homework.',
  'What is the weather like today?',
  'Explain how photosynthesis works.',
  'How do I write a for loop in JavaScript?',
  'What are the best practices for API design?',
  'Can you explain machine learning concepts?',
];

export const safeCodeSnippets = [
  'const greeting = "Hello World";',
  'function add(a, b) { return a + b; }',
  'const apiKey = process.env.API_KEY;',
  'import { useState } from "react";',
  'interface User { name: string; age: number; }',
  'const config = { apiKey: "<YOUR_API_KEY_HERE>" };',
  'password = "xxxxxxxx"',
  'api_key = "test_key_for_development"',
];

export const safeConversationTurns = [
  'Hello, I have a question.',
  'I need help with TypeScript.',
  'Can you explain generics?',
  'That makes sense, thank you.',
  'One more question about types.',
  'Great, thanks for your help!',
];

export const safeStreamingChunks = [
  'Hello, ',
  'how are ',
  'you today? ',
  'I wanted to ',
  'ask about your ',
  'products and services.',
  'Can you help me ',
  'understand your ',
  'pricing options? ',
  'Thank you for ',
  'your assistance.',
];

export const safeMultilingualContent = {
  spanish: [
    'Hola, ¿cómo estás?',
    '¿Puedes ayudarme con español?',
    'Gracias por tu ayuda.',
  ],
  french: [
    'Bonjour, comment allez-vous?',
    'Pouvez-vous m\'aider?',
    'Merci pour votre aide.',
  ],
  german: [
    'Hallo, wie geht es dir?',
    'Können Sie mir helfen?',
    'Vielen Dank für Ihre Hilfe.',
  ],
  japanese: [
    'こんにちは、元気ですか？',
    '手伝ってもらえますか？',
    'ご協力ありがとうございます。',
  ],
  chinese: [
    '你好，你好吗？',
    '你能帮助我吗？',
    '谢谢你的帮助。',
  ],
};

export const safeTechnicalContent = [
  'How do I handle async/await in TypeScript?',
  'What is the difference between let and const?',
  'Explain React hooks in simple terms.',
  'How do I set up a Node.js server?',
  'What is the purpose of Docker containers?',
  'How do I implement JWT authentication?',
  'What are REST API best practices?',
  'How do I optimize database queries?',
  'Explain the concept of dependency injection.',
  'What is the difference between SQL and NoSQL?',
];

export const safeLongFormContent = [
  // Paragraph about programming
  `Programming is the process of creating a set of instructions that tell a computer how to perform a task. Programming can be done using various programming languages, such as Python, Java, JavaScript, and many others. Each language has its own syntax and semantics, but they all share fundamental concepts like variables, loops, and functions.`,

  // Technical documentation
  `API Documentation
  ================

  This API provides endpoints for managing user resources.

  Authentication
  -------------
  All requests must include a valid API key in the header.

  Endpoints
  ---------
  GET /users - List all users
  POST /users - Create a new user
  GET /users/:id - Get user by ID
  PUT /users/:id - Update user by ID
  DELETE /users/:id - Delete user by ID`,

  // Tutorial content
  `Getting Started with TypeScript
  ===============================

  Step 1: Install TypeScript
  -------------------------
  npm install -g typescript

  Step 2: Create a TypeScript file
  -------------------------------
  Create a file named app.ts and add some code.

  Step 3: Compile
  --------------
  tsc app.ts

  Step 4: Run
  ----------
  node app.js`,
];

export const safePlaceholderContent = [
  'Your API key goes here',
  '<REPLACE_WITH_YOUR_CREDENTIALS>',
  'password = "********"',
  'email = "user@example.com"',
  'SSN = "***-**-****"',
];

// Combined export
export const allSafeContent = {
  queries: safeQueries,
  code: safeCodeSnippets,
  conversation: safeConversationTurns,
  streaming: safeStreamingChunks,
  multilingual: safeMultilingualContent,
  technical: safeTechnicalContent,
  longForm: safeLongFormContent,
  placeholders: safePlaceholderContent,
};
