"use client";

// Speak-your-haul input for the draft page. Records in the browser
// (MediaRecorder — AAC on iOS Safari, Opus/webm elsewhere) or accepts an
// uploaded voice memo, sends it to /api/admin/draft/transcribe, and hands
// the smart-filled fields back to the parent form for review.

import { useEffect, useRef, useState } from "react";

export type AudioFillFields = {
  acquisitionStory: string;
  photoNotes: string;
  city: string;
  state: string;
  vagueLocation: string;
};

const MAX_SECONDS = 240; // ~4 min keeps us under Vercel's body cap

export default function AudioStory({
  onFilled,
}: {
  onFilled: (fields: AudioFillFields, transcript: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find(
        (t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)
      );
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/mp4" });
        void submit(blob, `haul-story.${(rec.mimeType || "").includes("mp4") ? "m4a" : "webm"}`);
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
      setSeconds(0);
      timerRef.current = setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= MAX_SECONDS) stopRecording();
          return s + 1;
        });
      }, 1000);
    } catch {
      setError("Microphone unavailable — check browser permissions, or upload a voice memo instead.");
    }
  }

  function stopRecording() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    setRecording(false);
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  async function submit(blob: Blob, name: string) {
    if (blob.size > 4_200_000) {
      setError(`Recording is ${(blob.size / 1_000_000).toFixed(1)}MB — too large. Keep it under ~4 minutes.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("audio", blob, name);
      const res = await fetch("/api/admin/draft/transcribe", {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Transcription failed (${res.status})`);
        return;
      }
      setTranscript(data.transcript as string);
      onFilled(data.fields as AudioFillFields, data.transcript as string);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  const mmss = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <div className="border border-dashed border-brand-ink/25 rounded-md p-4 bg-brand-paper/50">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm font-medium">🎙 Speak your haul</span>
        {!recording ? (
          <button
            type="button"
            onClick={startRecording}
            disabled={busy}
            className="bg-brand-ink text-brand-paper hover:bg-brand-ink/85 rounded px-3 py-1.5 text-sm disabled:opacity-50"
          >
            Record story
          </button>
        ) : (
          <button
            type="button"
            onClick={stopRecording}
            className="bg-red-600 text-white hover:bg-red-700 rounded px-3 py-1.5 text-sm"
          >
            ■ Stop ({mmss})
          </button>
        )}
        <label className="text-sm text-brand-ink/70 hover:text-brand-ink cursor-pointer underline underline-offset-2 decoration-brand-yellow decoration-2">
          or upload a voice memo
          <input
            type="file"
            accept="audio/*"
            className="hidden"
            disabled={busy || recording}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void submit(f, f.name);
              e.target.value = "";
            }}
          />
        </label>
        {busy && <span className="text-sm text-brand-ink/60">Transcribing…</span>}
      </div>
      <p className="text-xs text-brand-ink/50 mt-2">
        Talk through where the haul came from and what&rsquo;s in it — the
        story, item notes, and location fields fill themselves for you to
        review. Up to ~4 minutes.
      </p>
      {error && <p className="text-sm text-red-700 mt-2">{error}</p>}
      {transcript && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowTranscript((v) => !v)}
            className="text-xs text-brand-ink/60 hover:underline"
          >
            {showTranscript ? "Hide" : "Show"} raw transcript
          </button>
          {showTranscript && (
            <p className="text-xs text-brand-ink/70 mt-1 whitespace-pre-wrap border-l-2 border-brand-yellow pl-3">
              {transcript}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
