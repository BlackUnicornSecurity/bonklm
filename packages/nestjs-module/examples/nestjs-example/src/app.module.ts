/**
 * Example NestJS App Module
 * ==========================
 * Demonstrates how to integrate @blackunicorn/bonklm-nestjs.
 */

import { Module } from '@nestjs/common';
import { GuardrailsModule } from '@blackunicorn/bonklm-nestjs';
import { PromptInjectionValidator, JailbreakValidator, SecretGuard, PIIGuard } from '@blackunicorn/bonklm';
import { AppController } from './app.controller.js';

@Module({
  imports: [
    // Configure guardrails with validators and guards
    GuardrailsModule.forRoot({
      validators: [new PromptInjectionValidator(), new JailbreakValidator()],
      guards: [new SecretGuard(), new PIIGuard()],
      global: true, // Make interceptor available globally
      productionMode: process.env.NODE_ENV === 'production',
      validationTimeout: 5000,
      maxContentLength: 1024 * 1024 // 1MB
    })
  ],
  controllers: [AppController]
})
export class AppModule {}
