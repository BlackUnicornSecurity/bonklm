#!/usr/bin/env node
// PreToolUse:Skill hook entrypoint (invoked as `supply-chain.js validate`; argv ignored).
import { runHook } from '../lib/run-hook.js';
import { validateSupplyChain } from '../lib/validators/supply-chain.js';

runHook('supply-chain', validateSupplyChain);
