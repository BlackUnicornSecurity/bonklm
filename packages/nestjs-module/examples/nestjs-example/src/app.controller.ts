/**
 * Example App Controller
 * ======================
 * Demonstrates various ways to use the @UseGuardrails() decorator.
 */

import { Controller, Post, Get, Body } from '@nestjs/common';
import { UseGuardrails } from '@blackunicorn/bonklm-nestjs';

@Controller('api')
export class AppController {
  /**
   * Simple chat endpoint with default validation.
   * Validates the request body before processing.
   */
  @Post('chat')
  @UseGuardrails()
  async chat(@Body() body: { message: string }) {
    // In a real app, this would call your LLM
    return {
      response: `I received your message: "${body.message}"`,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Chat endpoint with output validation.
   * Both request and response are validated.
   */
  @Post('chat-secured')
  @UseGuardrails({
    validateInput: true,
    validateOutput: true
  })
  async chatSecured(@Body() body: { message: string }) {
    // In a real app, this would call your LLM
    return {
      response: `Safe response to: "${body.message}"`
    };
  }

  /**
   * Generate endpoint with custom body field.
   * Extracts content from 'prompt' field instead of 'message'.
   */
  @Post('generate')
  @UseGuardrails({
    bodyField: 'prompt'
  })
  async generate(@Body() body: { prompt: string }) {
    return {
      text: `Generated content for: "${body.prompt}"`
    };
  }

  /**
   * Completion endpoint with custom response field.
   * Validates the 'text' field in the response.
   */
  @Post('complete')
  @UseGuardrails({
    validateInput: true,
    validateOutput: true,
    responseField: 'text'
  })
  async complete(@Body() body: { input: string }) {
    return {
      text: `Completion for: "${body.input}"`,
      usage: { tokens: 10 }
    };
  }

  /**
   * Endpoint with custom max content length.
   */
  @Post('summarize')
  @UseGuardrails({
    maxContentLength: 500 // 500 bytes max
  })
  async summarize(@Body() body: { text: string }) {
    return {
      summary: `Summary of: "${body.text.substring(0, 50)}..."`
    };
  }

  /**
   * Health check endpoint - no validation.
   */
  @Get('health')
  health() {
    return { status: 'ok', service: 'bonklm-nestjs-example' };
  }
}
