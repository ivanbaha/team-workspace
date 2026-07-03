/**
 * BM25 sparse encoder — the lexical half of hybrid search.
 *
 * Qdrant's full-text payload index is a filter, not a ranker, so we encode each
 * chunk as a SPARSE VECTOR of BM25 term weights and let Qdrant score it by dot
 * product against the query's sparse vector. Documents carry the full BM25
 * weight (incl. IDF + length normalization); the query carries 1.0 per term, so
 * the dot product reproduces the standard BM25 score.
 *
 * The model (vocabulary, IDF, avg doc length) is corpus-wide, so it is fit
 * during ingestion, serialized, and reloaded at query time.
 */

const DEFAULT_K1 = 1.2;
const DEFAULT_B = 0.75;

/**
 * Tokenize to lowercase terms while PRESERVING identifier punctuation, so
 * `role:workspace:team_lead` and `MEMBER_ROLES_MAPPER` survive as single tokens.
 * Also emits the split sub-tokens of compound identifiers to aid recall.
 */
export function tokenize(text) {
  const lower = text.toLowerCase();
  const tokens = [];
  // Full tokens: alphanumerics plus internal . _ : - / separators.
  const matches = lower.match(/[a-z0-9][a-z0-9._:/-]*[a-z0-9]|[a-z0-9]/g) || [];
  for (const tok of matches) {
    tokens.push(tok);
    // Sub-tokens for compound identifiers (length guard avoids noise).
    if (/[._:/-]/.test(tok)) {
      for (const part of tok.split(/[._:/-]+/)) {
        if (part.length > 1) tokens.push(part);
      }
    }
  }
  return tokens;
}

export class Bm25 {
  constructor({ k1 = DEFAULT_K1, b = DEFAULT_B } = {}) {
    this.k1 = k1;
    this.b = b;
    this.vocab = new Map(); // term -> { id, idf }
    this.avgdl = 0;
  }

  /** Fit IDF, vocabulary and average document length over all chunk token arrays. */
  fit(docsTokens) {
    const df = new Map();
    let totalLen = 0;

    for (const tokens of docsTokens) {
      totalLen += tokens.length;
      for (const term of new Set(tokens)) {
        df.set(term, (df.get(term) || 0) + 1);
      }
    }

    const n = docsTokens.length || 1;
    this.avgdl = totalLen / n;

    let id = 0;
    for (const [term, freq] of df) {
      // Standard BM25 idf with +1 smoothing to stay non-negative.
      const idf = Math.log(1 + (n - freq + 0.5) / (freq + 0.5));
      this.vocab.set(term, { id: id++, idf });
    }
    return this;
  }

  /** Encode a document's tokens to a Qdrant sparse vector { indices, values }. */
  encodeDocument(tokens) {
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);

    const dl = tokens.length;
    const indices = [];
    const values = [];
    for (const [term, freq] of tf) {
      const entry = this.vocab.get(term);
      if (!entry) continue;
      const denom = freq + this.k1 * (1 - this.b + (this.b * dl) / (this.avgdl || 1));
      const weight = entry.idf * ((freq * (this.k1 + 1)) / denom);
      if (weight > 0) {
        indices.push(entry.id);
        values.push(weight);
      }
    }
    return { indices, values };
  }

  /** Encode a query's tokens to a sparse vector (1.0 per known term). */
  encodeQuery(tokens) {
    const indices = [];
    const values = [];
    const seen = new Set();
    for (const term of tokens) {
      const entry = this.vocab.get(term);
      if (!entry || seen.has(entry.id)) continue;
      seen.add(entry.id);
      indices.push(entry.id);
      values.push(1.0);
    }
    return { indices, values };
  }

  toJSON() {
    return {
      k1: this.k1,
      b: this.b,
      avgdl: this.avgdl,
      vocab: Array.from(this.vocab.entries()).map(([term, v]) => [term, v.id, v.idf]),
    };
  }

  static fromJSON(obj) {
    const m = new Bm25({ k1: obj.k1, b: obj.b });
    m.avgdl = obj.avgdl;
    for (const [term, id, idf] of obj.vocab) m.vocab.set(term, { id, idf });
    return m;
  }
}
