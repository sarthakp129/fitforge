# ADR-002 — Voice modalities and second AI-provider evaluation

**Status:** accepted · **Date:** 2026-10-13

## Decisions

1. **Keep speech-to-text (Whisper) as an optional input modality.**
   One entry point: the microphone, via browser dictation where available and
   Whisper recording otherwise (hardware + secure context required). The
   transcript never auto-executes: coach dictation lands editable in the
   composer; meal dictation goes through a deterministic parser and a
   confirmation list. Verified live: verbatim transcription of a spoken meal.
2. **Keep text-to-speech (Orpheus) for coach replies**, opt-in via the speaker
   toggle, capped at 25 replies/day, graceful text-only degradation on terms,
   caps or provider errors. Verified live: 157 KB `audio/wav` round-trip.
3. **Do NOT build continuous/full-duplex voice chat.** Wrong interaction shape
   for gym logging (taps and chips are faster), and it would require streaming
   TTS + WebSockets + barge-in handling for marginal benefit.
4. **Do NOT add Hugging Face free inference as a provider** (primary or
   fallback): 20–30 s cold starts, CPU-only free compute, stricter shared rate
   limits, and user health data leaving the self-hosted boundary. It solves no
   documented requirement (project rule: no extra providers without one).
   Re-evaluate only for (a) a self-trained LoRA demo Space, or (b) weight
   downloads for self-hosting on owned GPU hardware.

## Consequences

- Voice features degrade in this order: mic → upload → text; replies: audio →
  text. Every degradation states its reason in the UI.
- One STT/TTS provider pair (Groq) keeps the governor, usage telemetry and
  fallback logic single-path and explainable.
- Residual risk accepted: machines without microphones cannot use voice input
  at all (hardware, not software); an upload path existed and was removed on
  the owner's request as inconvenient — typing remains the universal fallback.
