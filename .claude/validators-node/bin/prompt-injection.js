#!/usr/bin/env node
// UserPromptSubmit + PreToolUse:Write/Edit/Read/NotebookEdit/TodoWrite hook entrypoint.
import { runHook } from '../lib/run-hook.js';
import { validatePromptInjection } from '../lib/validators/prompt-injection.js';

runHook('prompt-injection', validatePromptInjection);
