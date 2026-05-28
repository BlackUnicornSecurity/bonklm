/**
 * Example NestJS Bootstrap
 * ========================
 * Entry point for the example application.
 */

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable validation pipes
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true
    })
  );

  const port = process.env.PORT || 3000;
  await app.listen(port);

  console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                              ║
║        BonkLM NestJS Example App                    ║
║                                                              ║
║        Server running on: http://localhost:${port}              ║
║                                                              ║
║        Try these endpoints:                                  ║
║        • POST /api/chat          - Basic validation         ║
║        • POST /api/chat-secured   - Input + output validation║
║        • POST /api/generate      - Custom body field        ║
║        • POST /api/complete      - Custom response field    ║
║        • POST /api/summarize     - Custom max length        ║
║        • GET  /api/health        - Health check             ║
║                                                              ║
╚════════════════════════════════════════════════════════════╝
  `);
}

bootstrap().catch(error => {
  console.error('Failed to start application:', error);
  process.exit(1);
});
