# -*- coding: utf-8 -*-
"""
Бесплатное распознавание голосовых сообщений.

Работает полностью локально через faster-whisper (модель Whisper от OpenAI,
но открытая и бесплатная для самостоятельного запуска — в отличие от платного
Whisper-эндпоинта OpenAI API). Никаких сторонних платных сервисов и лишних
расходов сверх ресурсов твоего сервера (CPU/RAM, при наличии — GPU).

Модель грузится один раз при первом голосовом сообщении и держится в памяти.
Размер модели и устройство настраиваются через .env:
  WHISPER_MODEL_SIZE  — tiny / base / small / medium / large-v3 (по умолчанию "small":
                         хороший баланс качества и скорости для русской речи на CPU)
  WHISPER_DEVICE      — "cpu" или "cuda" (если есть GPU)
  WHISPER_COMPUTE_TYPE — "int8" (быстро и легко на CPU), "float16" (для GPU) и т.п.

При первом запуске faster-whisper скачает веса модели с Hugging Face (нужен разовый
доступ в интернет на сервере) и закэширует их локально — повторных скачиваний не будет.
"""
import asyncio
import logging
import os
import tempfile

from config import cfg

log = logging.getLogger(__name__)

_model = None
_model_lock = asyncio.Lock()


async def _get_model():
    global _model
    if _model is not None:
        return _model
    async with _model_lock:
        if _model is None:
            from faster_whisper import WhisperModel  # импорт внутри функции: тяжёлая зависимость,
            # грузим только тогда, когда голосовые реально понадобились

            log.info(
                "Загружаю модель Whisper '%s' (device=%s, compute_type=%s)...",
                cfg.whisper_model_size, cfg.whisper_device, cfg.whisper_compute_type,
            )
            _model = await asyncio.to_thread(
                WhisperModel,
                cfg.whisper_model_size,
                device=cfg.whisper_device,
                compute_type=cfg.whisper_compute_type,
            )
            log.info("Модель Whisper загружена.")
    return _model


def _transcribe_sync(model, path: str) -> str:
    segments, _info = model.transcribe(path, vad_filter=True)
    return " ".join(seg.text.strip() for seg in segments).strip()


async def transcribe(audio_bytes: bytes, suffix: str = ".oga") -> str:
    """
    Распознаёт речь из байтов аудиофайла (voice/audio-сообщение из Telegram)
    и возвращает распознанный текст. Язык определяется автоматически.
    """
    model = await _get_model()
    fd, path = tempfile.mkstemp(suffix=suffix)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(audio_bytes)
        return await asyncio.to_thread(_transcribe_sync, model, path)
    finally:
        try:
            os.remove(path)
        except OSError:
            pass
