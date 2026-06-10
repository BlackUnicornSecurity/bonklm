#!/usr/bin/env node
// PreToolUse:Skill hook entrypoint (skill authorization policy). Logic + tests live in lib/.
import { runHook } from '../lib/run-hook.js';
import { validateAuthorization } from '../lib/validators/authorization.js';

runHook('authorization', validateAuthorization);
