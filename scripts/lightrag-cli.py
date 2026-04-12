#!/usr/bin/env python3
"""
AURAMAXING LightRAG CLI — Local vector search for session memory.

Uses sentence-transformers (all-MiniLM-L6-v2) for dense semantic embeddings
+ cosine similarity search. No external API keys required. All local computation.

Usage:
  python3 lightrag-cli.py ingest --workspace <path> --input <json-file>
  python3 lightrag-cli.py query  --workspace <path> --query "text" --top-k 3
  python3 lightrag-cli.py status --workspace <path>
"""
import argparse
import json
import os
import sys
import hashlib
from pathlib import Path

import numpy as np

# ── Lazy-loaded Sentence Transformer model ───────────────────────────────────

_model = None

def _get_model():
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer
        _model = SentenceTransformer('all-MiniLM-L6-v2')
    return _model

# ── Semantic Vectorizer (local, no API) ──────────────────────────────────────

class LocalVectorizer:
    """Semantic vectorizer using sentence-transformers with cosine similarity search."""

    def __init__(self, workspace: str):
        self.workspace = Path(workspace)
        self.workspace.mkdir(parents=True, exist_ok=True)
        self.index_path = self.workspace / "vector_index.json"
        self.docs_path = self.workspace / "documents.json"
        self.documents: list[dict] = []
        self.vectors: list[list[float]] = []
        self._load()

    def _load(self):
        """Load existing index from disk."""
        try:
            if self.docs_path.exists():
                self.documents = json.loads(self.docs_path.read_text())
            if self.index_path.exists():
                data = json.loads(self.index_path.read_text())
                self.vectors = data.get("vectors", [])
        except Exception as e:
            print(f"Warning: failed to load index: {e}", file=sys.stderr)

    def _save(self):
        """Persist index to disk using atomic write (temp + rename)."""
        import tempfile
        for path, data in [
            (self.docs_path, json.dumps(self.documents)),
            (self.index_path, json.dumps({"vectors": [[float(v) for v in vec] for vec in self.vectors]})),
        ]:
            fd, tmp = tempfile.mkstemp(dir=str(self.workspace), suffix='.tmp')
            try:
                os.write(fd, data.encode())
                os.close(fd)
                os.replace(tmp, str(path))  # atomic on POSIX
            except Exception:
                os.close(fd) if not os.get_inheritable(fd) else None
                try: os.unlink(tmp)
                except: pass
                raise

    def _vectorize(self, text: str) -> list[float]:
        """Convert text to dense embedding using sentence-transformers."""
        model = _get_model()
        embedding = model.encode(text, show_progress_bar=False)
        return embedding.tolist()

    def ingest(self, entries: list[dict]) -> int:
        """Ingest documents into the index. Returns count of new documents."""
        lock_path = self.workspace / ".lock"
        # Simple PID-based lock
        if lock_path.exists():
            try:
                pid = int(lock_path.read_text().strip())
                # Check if process is still alive
                os.kill(pid, 0)
                return 0  # Another process is ingesting, skip
            except (ProcessLookupError, ValueError):
                pass  # Stale lock, proceed
        lock_path.write_text(str(os.getpid()))
        try:
            existing_ids = {d.get("id") for d in self.documents}
            new_count = 0

            for entry in entries:
                # Build searchable text first, then hash on content for dedup
                text_parts = []
                for key in ("content", "summary", "text", "strategy", "pattern", "label", "error"):
                    val = entry.get(key)
                    if val and isinstance(val, str):
                        text_parts.append(val)
                text = " ".join(text_parts)
                if not text.strip():
                    continue

                # Hash on text content only — prevents duplicates with different timestamps
                doc_id = hashlib.md5(text.encode()).hexdigest()[:12]

                if doc_id in existing_ids:
                    continue

                self.documents.append({
                    "id": doc_id,
                    "text": text[:500],  # cap at 500 chars
                    "type": entry.get("type", "unknown"),
                    "ts": entry.get("ts", ""),
                    "source": entry.get("source", "memory"),
                })
                existing_ids.add(doc_id)
                new_count += 1

            if new_count > 0:
                # Prune to 500 documents max — remove oldest by timestamp
                max_docs = 500
                if len(self.documents) > max_docs:
                    self.documents.sort(key=lambda d: d.get("ts", ""), reverse=True)
                    self.documents = self.documents[:max_docs]

                # Re-vectorize all documents with semantic embeddings
                self.vectors = [self._vectorize(doc["text"]) for doc in self.documents]

                self._save()

            return new_count
        finally:
            try: lock_path.unlink()
            except: pass

    def query(self, text: str, top_k: int = 3) -> list[dict]:
        """Search for similar documents. Returns top_k results with scores."""
        if not self.documents or not self.vectors:
            return []

        query_vec = np.array(self._vectorize(text), dtype=np.float32)
        query_norm = np.linalg.norm(query_vec)
        if query_norm == 0:
            return []

        results = []
        for i, doc_vec in enumerate(self.vectors):
            doc_arr = np.array(doc_vec, dtype=np.float32)
            doc_norm = np.linalg.norm(doc_arr)
            if doc_norm == 0:
                continue
            similarity = float(np.dot(query_vec, doc_arr) / (query_norm * doc_norm))
            if similarity > 0.3:  # dense embeddings need higher threshold
                results.append({
                    "text": self.documents[i]["text"],
                    "type": self.documents[i]["type"],
                    "ts": self.documents[i]["ts"],
                    "score": round(similarity, 4),
                    "id": self.documents[i]["id"],
                })

        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:top_k]

    def status(self) -> dict:
        """Return index statistics."""
        embedding_dim = len(self.vectors[0]) if self.vectors else 0
        return {
            "documents": len(self.documents),
            "embedding_dim": embedding_dim,
            "index_exists": self.index_path.exists(),
            "workspace": str(self.workspace),
            "types": dict(
                sorted(
                    {
                        t: sum(1 for d in self.documents if d.get("type") == t)
                        for t in {d.get("type", "unknown") for d in self.documents}
                    }.items()
                )
            ) if self.documents else {},
        }


# ── CLI ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="AURAMAXING LightRAG CLI")
    parser.add_argument("command", choices=["ingest", "query", "status"])
    parser.add_argument("--workspace", default=os.path.expanduser("~/.auramaxing/lightrag-workspace"))
    parser.add_argument("--input", help="JSON file to ingest")
    parser.add_argument("--query", "-q", help="Query text for search")
    parser.add_argument("--top-k", type=int, default=3, help="Number of results")
    args = parser.parse_args()

    vectorizer = LocalVectorizer(args.workspace)

    if args.command == "ingest":
        if not args.input:
            # Read from stdin
            try:
                data = json.load(sys.stdin)
            except Exception:
                print(json.dumps({"error": "No input provided", "ingested": 0}))
                sys.exit(0)
        else:
            try:
                with open(args.input) as f:
                    data = json.load(f)
            except Exception as e:
                print(json.dumps({"error": str(e), "ingested": 0}))
                sys.exit(0)

        entries = data if isinstance(data, list) else [data]
        count = vectorizer.ingest(entries)
        print(json.dumps({"ingested": count, "total": len(vectorizer.documents)}))

    elif args.command == "query":
        if not args.query:
            print(json.dumps([]))
            sys.exit(0)
        results = vectorizer.query(args.query, args.top_k)
        print(json.dumps(results))

    elif args.command == "status":
        print(json.dumps(vectorizer.status()))

    sys.exit(0)


if __name__ == "__main__":
    main()
