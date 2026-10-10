from app.schemas import ExtractRequest


def extract_entities(request: ExtractRequest):
    """Future Inference Providers call using server-only HF_TOKEN.

    Validate structured output, retain source/unit provenance, and require review
    before publishing model-generated relationships into the graph.
    """
    raise NotImplementedError("Hugging Face extraction is not implemented.")
