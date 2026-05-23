import logging
from PIL import Image

logger = logging.getLogger(__name__)

# Try importing easyocr with a safe fallback
EASYOCR_AVAILABLE = False
reader = None

try:
    import easyocr
    # Instantiate reader only when needed or on first use to prevent blocking imports
    EASYOCR_AVAILABLE = True
except ImportError:
    logger.warning("easyocr not installed. OCR capabilities will be mock-simulated. Please run 'pip install easyocr'")


def get_ocr_reader():
    """
    Lazy initialization of EasyOCR reader to speed up app start time and import chains.
    """
    global reader
    if not EASYOCR_AVAILABLE:
        return None
    if reader is None:
        try:
            logger.info("Initializing EasyOCR English reader...")
            reader = easyocr.Reader(['en'], gpu=False) # run CPU mode by default for portability
        except Exception as e:
            logger.error(f"Failed to initialize EasyOCR: {e}. OCR will be mocked.")
            return None
    return reader


def extract_text_from_image(image_path):
    """
    Extracts text from an image file using EasyOCR.
    If OCR is unavailable or fails, returns standard descriptive fallback.
    """
    ocr_reader = get_ocr_reader()
    if not ocr_reader:
        logger.info(f"Using mock OCR extraction for {image_path}")
        return f"[OCR Unavailable] Uploaded screenshot file: {image_path}. (Please install easyocr for exact text indexing)."

    try:
        # readtext with detail=0 returns a list of pure string predictions
        results = ocr_reader.readtext(image_path, detail=0)
        extracted_text = " ".join(results)

        if not extracted_text.strip():
            return "[OCR Alert] No readable characters detected in image."

        return extracted_text.strip()
    except Exception as e:
        logger.error(f"EasyOCR text extraction failed on {image_path}: {e}")
        return f"[OCR Error] Failed to extract text: {str(e)}"
