#!/usr/bin/env node
/**
 * Pre-warm the embedding model: downloads + caches the ONNX weights so the
 * first real query (or ingest) isn't slow. Run from WSL2: yarn docs:download-model
 */
import { embedPassages } from '../src/docs/embedder.js';

console.log('[model] warming up embedding model...');
const t0 = Date.now();
const [vec] = await embedPassages(['warm up']);
console.log(`[model] ready in ${((Date.now() - t0) / 1000).toFixed(1)}s, dim=${vec.length}`);
