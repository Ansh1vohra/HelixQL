from app.config import Settings
from app.services.llm import GeminiSynthesisEngine

BASE = {"gemini_api_key": "test-key", "control_plane_internal_secret": "test-secret"}


def engine(**overrides) -> GeminiSynthesisEngine:
    return GeminiSynthesisEngine(Settings(**BASE, **overrides))  # type: ignore[arg-type]


def test_thinking_level_is_used_when_no_budget_is_set():
    thinking = engine(gemini_thinking_level="low")._thinking_config()
    assert thinking is not None
    # The SDK coerces the string onto its ThinkingLevel enum ("LOW").
    assert str(thinking.thinking_level).upper().endswith("LOW")
    assert thinking.thinking_budget is None


def test_budget_takes_precedence_and_suppresses_level():
    """Sending both fields is a 400 from the API, so exactly one must win."""
    thinking = engine(gemini_thinking_budget=0, gemini_thinking_level="low")._thinking_config()
    assert thinking is not None
    assert thinking.thinking_budget == 0
    assert thinking.thinking_level is None


def test_blank_level_and_no_budget_sends_nothing():
    assert engine(gemini_thinking_level="  ")._thinking_config() is None


def test_generation_config_pins_temperature_to_zero():
    config = engine()._config("system")
    assert config.temperature == 0.0
    assert config.candidate_count == 1
    assert config.system_instruction == "system"
