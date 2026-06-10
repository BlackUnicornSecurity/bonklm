#!/usr/bin/env node
// PreToolUse:Write/Edit/NotebookEdit hook entrypoint. Logic + tests live in lib/.
import { runHook } from '../lib/run-hook.js';
import { validateEnvProtection } from '../lib/validators/env-protection.js';

runHook('env-protection', validateEnvProtection);
