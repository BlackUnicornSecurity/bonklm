/**
 * The connector catalog — every publishable BonkLM connector that is described
 * declaratively rather than hand-written.
 *
 * `registry.test.ts` asserts that this catalog plus the hand-written
 * definitions under `implementations/` claim every publishable `packages/*`
 * manifest exactly once. Adding a connector package therefore fails the build
 * until a descriptor is added here.
 *
 * @module connectors/catalog
 */

import type { ConnectorDescriptor } from '../descriptor.js';
import { LLM_DESCRIPTORS } from './llm.js';
import { AGENT_DESCRIPTORS } from './agents.js';
import { DATA_DESCRIPTORS } from './data.js';
import { WEB_DESCRIPTORS } from './web.js';
import { PLATFORM_DESCRIPTORS } from './platform.js';
import { UTILITY_DESCRIPTORS } from './utility.js';

/** All descriptor-defined connectors, in category order. */
export const CONNECTOR_CATALOG: readonly ConnectorDescriptor[] = Object.freeze([
  ...LLM_DESCRIPTORS,
  ...AGENT_DESCRIPTORS,
  ...WEB_DESCRIPTORS,
  ...DATA_DESCRIPTORS,
  ...PLATFORM_DESCRIPTORS,
  ...UTILITY_DESCRIPTORS
]);

export {
  LLM_DESCRIPTORS,
  AGENT_DESCRIPTORS,
  DATA_DESCRIPTORS,
  WEB_DESCRIPTORS,
  PLATFORM_DESCRIPTORS,
  UTILITY_DESCRIPTORS
};
