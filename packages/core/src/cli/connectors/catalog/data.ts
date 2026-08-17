/**
 * Vector-store and memory connector descriptors.
 *
 * Ports and Docker container patterns are only declared where this repository
 * already documents them (Qdrant's 6333 appears in the connector README and
 * fixtures). A port we cannot source is left off rather than guessed: a wrong
 * port reports a healthy service as down.
 *
 * @module connectors/catalog/data
 */

import type { ConnectorDescriptor } from '../descriptor.js';

export const DATA_DESCRIPTORS: readonly ConnectorDescriptor[] = Object.freeze([
  {
    id: 'chroma',
    name: 'Chroma',
    category: 'vector-db',
    npmPackage: '@blackunicorn/bonklm-chroma',
    peerPackages: ['chromadb'],
    dockerContainers: ['chroma'],
    summary: 'Vector database security for RAG applications backed by ChromaDB.'
  },
  {
    id: 'lance',
    name: 'LanceDB',
    category: 'vector-db',
    npmPackage: '@blackunicorn/bonklm-lance',
    peerPackages: ['@lancedb/lancedb'],
    summary: 'LanceDB table wrapper — RetrievedDocValidator on reads, MemoryWriteValidator on writes.'
  },
  {
    id: 'pinecone',
    name: 'Pinecone',
    category: 'vector-db',
    npmPackage: '@blackunicorn/bonklm-pinecone',
    peerPackages: ['@pinecone-database/pinecone'],
    credentials: [{ env: 'PINECONE_API_KEY', configKey: 'apiKey' }],
    summary: 'Query and retrieval validation for the Pinecone vector database.'
  },
  {
    id: 'qdrant',
    name: 'Qdrant',
    category: 'vector-db',
    npmPackage: '@blackunicorn/bonkdrant',
    peerPackages: ['@qdrant/js-client-rest'],
    ports: [6333],
    dockerContainers: ['qdrant'],
    probe: { kind: 'tcp', port: 6333 },
    summary: 'Vector database security for RAG applications backed by Qdrant.'
  },
  {
    id: 'turbopuffer',
    name: 'Turbopuffer',
    category: 'vector-db',
    npmPackage: '@blackunicorn/bonklm-turbopuffer',
    peerPackages: ['@turbopuffer/turbopuffer'],
    credentials: [{ env: 'TURBOPUFFER_API_KEY', configKey: 'apiKey' }],
    summary: 'Edge-compatible Turbopuffer namespace wrapper with write + retrieval guardrails.'
  },
  {
    id: 'weaviate',
    name: 'Weaviate',
    category: 'vector-db',
    npmPackage: '@blackunicorn/bonkviate',
    peerPackages: ['weaviate-client'],
    dockerContainers: ['weaviate'],
    summary: 'Vector database security for RAG applications backed by Weaviate.'
  },
  {
    id: 'letta',
    name: 'Letta',
    category: 'memory',
    npmPackage: '@blackunicorn/bonklm-letta',
    peerPackages: ['@letta-ai/letta-client'],
    summary: 'Letta agent memory add/search/update with sealed-write + composed-context recall validation.'
  },
  {
    id: 'mem0',
    name: 'Mem0',
    category: 'memory',
    npmPackage: '@blackunicorn/bonklm-mem0',
    peerPackages: ['mem0ai'],
    summary: "Wraps Mem0's add/search/update/get/history/reset with sealed-write + recall validation."
  },
  {
    id: 'zep',
    name: 'Zep',
    category: 'memory',
    npmPackage: '@blackunicorn/bonklm-zep',
    peerPackages: ['@getzep/zep-cloud'],
    credentials: [{ env: 'ZEP_API_KEY', configKey: 'apiKey' }],
    summary: 'Zep thread and graph memory with sealed-write + composed-context recall validation.'
  }
] as const);
