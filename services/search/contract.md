# Search Service — Contract

Local transcript retrieval has two modes:

- `keyword`: Postgres full-text search over title, transcript, enrichment,
  speaker labels, and tags.
- `semantic`: cosine similarity over locally generated Ollama embeddings stored
  as Postgres arrays. This mode is optional and does not require pgvector.

Every query is structurally scoped by `org_id`. Results include the closest
matching segment timestamp. Knowledge Q&A sends selected local transcript
snippets to the configured local LLM and returns explicit transcript citations.
