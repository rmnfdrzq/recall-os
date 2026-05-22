import re

def semantic_chunk_text(text, chunk_size=500, overlap=100):
    """
    Chunks text semantically, attempting to preserve sentence and paragraph structures.
    Uses sliding window approach with specified character bounds.
    """
    if not text:
        return []

    # Replace consecutive newlines to clean formatting
    cleaned_text = re.sub(r'\n{3,}', '\n\n', text)

    # Split text into sentences using simple regex
    # Matches terminal punctuation followed by space or end of string
    sentences = re.split(r'(?<=[.!?])\s+', cleaned_text)

    chunks = []
    current_chunk = ""

    for sentence in sentences:
        # If sentence is extremely long, split it by length
        if len(sentence) > chunk_size:
            if current_chunk:
                chunks.append(current_chunk.strip())
                current_chunk = ""

            # Slice long sentence into sub-chunks
            words = sentence.split(' ')
            sub_chunk = ""
            for word in words:
                if len(sub_chunk) + len(word) + 1 <= chunk_size:
                    sub_chunk += (word + " ")
                else:
                    chunks.append(sub_chunk.strip())
                    # Sliding overlap window
                    sub_chunk = words[max(0, len(sub_chunk) - overlap):] # simple fallback
                    sub_chunk = word + " "
            if sub_chunk:
                current_chunk = sub_chunk
        else:
            # Standard chunk builder
            if len(current_chunk) + len(sentence) + 1 <= chunk_size:
                current_chunk += (sentence + " ")
            else:
                chunks.append(current_chunk.strip())
                # Re-seed with overlapping sentences
                words_in_prev = current_chunk.split(' ')
                overlap_text = " ".join(words_in_prev[-15:]) # approximate ~100 characters overlap
                if len(overlap_text) < overlap:
                    current_chunk = overlap_text + " " + sentence + " "
                else:
                    current_chunk = sentence + " "

    if current_chunk:
        chunks.append(current_chunk.strip())

    # Remove empty entries
    return [c for c in chunks if c]
