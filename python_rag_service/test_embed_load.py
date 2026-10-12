import sys
from sentence_transformers import SentenceTransformer

try:
    print("Attempting to load BAAI/bge-m3 with model_kwargs={'local_files_only': True}...")
    model = SentenceTransformer("BAAI/bge-m3", model_kwargs={"local_files_only": True})
    print("Success! Model loaded.")
except Exception as e:
    print(f"Failed to load: {type(e).__name__}: {e}")
    import traceback
    traceback.print_exc()
