"""Periodic eval: TTS intelligibility, measured by machine.

Synthesizes known sentences with the RUNNING TTS service, transcribes the audio
with the RUNNING STT service, and scores character error rate. A voice that STT
cannot understand is a voice people will struggle with too. Thresholds per
language live in roundtrip_thresholds.json; the run fails on regression.

    services/tts/.venv/bin/python -m services.tts.evals.eval_roundtrip
    TTS_URL=... STT_URL=... python -m services.tts.evals.eval_roundtrip --langs sw,en,kik
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

from services.stt.evals.eval_fleurs import cer

HERE = Path(__file__).resolve().parent
SENTENCES = {
    "en": "The weather is warm today and the market opens at nine in the morning.",
    "sw": "Hali ya hewa ni nzuri leo na soko linafunguliwa saa tatu asubuhi.",
    "fr": "Il fait beau aujourd'hui et le marché ouvre à neuf heures du matin.",
    "de": "Das Wetter ist heute schön und der Markt öffnet um neun Uhr morgens.",
    "es": "Hoy hace buen tiempo y el mercado abre a las nueve de la mañana.",
    "ne": "आज मौसम राम्रो छ र बजार बिहान नौ बजे खुल्छ।",
    "kik": "Mũthenya ũyũ nĩ mwega na thoko nĩ ĩkũhingũka rũciinĩ.",
    "yo": "Ojú ọjọ́ dára lónìí, ọjà sì ṣí ní aago mẹ́sàn-án àárọ̀.",
    "am": "ዛሬ የአየር ሁኔታው ጥሩ ነው ገበያውም ጠዋት ሶስት ሰዓት ይከፈታል።",
}


def post_json(url: str, body: dict, token: str) -> tuple[bytes, dict]:
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})})
    with urllib.request.urlopen(req, timeout=600) as res:
        return res.read(), dict(res.headers)


def transcribe(url: str, audio: bytes, language: str, token: str) -> dict:
    boundary = uuid.uuid4().hex
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"language\"\r\n\r\n{language}\r\n"
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"tts.wav\"\r\n"
            f"Content-Type: audio/wav\r\n\r\n").encode() + audio + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(f"{url}/transcribe", data=body, method="POST",
                                 headers={"Content-Type": f"multipart/form-data; boundary={boundary}",
                                          **({"Authorization": f"Bearer {token}"} if token else {})})
    with urllib.request.urlopen(req, timeout=600) as res:
        return json.loads(res.read())


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--langs", default="en,sw,fr")
    ap.add_argument("--report", default=os.getenv("EVAL_REPORT_PATH", "data/observability/tts-roundtrip-eval.json"))
    args = ap.parse_args(argv)
    tts = os.getenv("TTS_URL", "http://localhost:8012").rstrip("/")
    stt = os.getenv("STT_URL", "http://localhost:8011").rstrip("/")
    thresholds = {k: v for k, v in json.loads((HERE / "roundtrip_thresholds.json").read_text(encoding="utf-8")).items()
                  if not k.startswith("_")}
    rows, failures = [], []
    for lang in [l.strip() for l in args.langs.split(",") if l.strip()]:
        text = SENTENCES.get(lang)
        if not text:
            print(f"skip {lang}: no reference sentence", file=sys.stderr)
            continue
        try:
            t0 = time.perf_counter()
            audio, headers = post_json(f"{tts}/synthesize", {"text": text, "language": lang, "format": "wav"},
                                       os.getenv("TTS_API_TOKEN", ""))
            synth_s = time.perf_counter() - t0
        except urllib.error.HTTPError as exc:
            detail = json.loads(exc.read() or b"{}")
            print(f"[SKIP] {lang:4} no voice ({detail.get('code')}): {detail.get('error')}")
            rows.append({"language": lang, "skipped": detail.get("code")})
            continue
        heard = transcribe(stt, audio, lang, os.getenv("STT_API_TOKEN", ""))
        score = round(cer(text, heard.get("text", "")), 4)
        limit = thresholds.get(lang)
        passed = limit is None or score <= limit
        row = {"language": lang, "voice": headers.get("x-semaje-voice"), "ttsEngine": headers.get("x-semaje-engine"),
               "sttEngine": heard.get("engine"), "cer": score, "threshold": limit, "passed": passed,
               "synthSec": round(synth_s, 3), "audioSec": float(headers.get("x-semaje-duration", 0)),
               "heard": heard.get("text", "")}
        rows.append(row)
        if not passed:
            failures.append(row)
        print(f"[{'PASS' if passed else 'FAIL'}] {lang:4} voice={row['voice']:28} CER={score:.3f} (limit {limit}) heard={row['heard']!r}")
    Path(args.report).parent.mkdir(parents=True, exist_ok=True)
    Path(args.report).write_text(json.dumps({"results": rows, "passed": not failures}, indent=2, ensure_ascii=False), encoding="utf-8")
    print("EVAL PASS" if not failures else f"EVAL FAIL ({len(failures)})")
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
