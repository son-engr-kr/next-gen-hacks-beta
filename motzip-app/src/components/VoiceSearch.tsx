"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Restaurant } from "@/types/restaurant";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:8000";

type Phase = "idle" | "recording" | "processing" | "done" | "error";

interface Props {
  userLat: number;
  userLng: number;
  onResults: (restaurants: Restaurant[]) => void;
  onClear: () => void;
}

export default function VoiceSearch({ userLat, userLng, onResults, onClear }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [transcript, setTranscript] = useState("");
  const [results, setResults] = useState<Restaurant[]>([]);
  const [responseText, setResponseText] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [textInput, setTextInput] = useState("");

  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  const startRecording = useCallback(async () => {
    setPhase("recording");
    setTranscript("");
    setResults([]);
    setResponseText("");
    setErrorMsg("");
    chunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Pick best supported format
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/ogg;codecs=opus";

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRef.current = recorder;

      // timeslice=200ms 로 chunk 단위 수집 — 짧은 녹음도 안전
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mimeType });
        await submitAudio(blob, mimeType);
      };

      recorder.start(200);
    } catch {
      setErrorMsg("마이크 접근이 거부됐어요. 브라우저 설정을 확인해주세요.");
      setPhase("error");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const stopRecording = useCallback(() => {
    if (mediaRef.current && mediaRef.current.state !== "inactive") {
      setPhase("processing");
      mediaRef.current.stop();
    }
  }, []);

  const submitText = async (text: string) => {
    if (!text.trim()) return;
    setPhase("processing");
    setTranscript("");
    setResults([]);
    setResponseText("");
    setErrorMsg("");
    try {
      const form = new FormData();
      // 빈 오디오 blob (서버에서 text_query 우선)
      form.append("audio", new Blob([], { type: "audio/webm" }), "empty.webm");
      form.append("text_query", text.trim());
      form.append("user_lat", String(userLat));
      form.append("user_lng", String(userLng));
      await processForm(form);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "오류가 발생했어요.");
      setPhase("error");
    }
  };

  const processForm = async (form: FormData) => {
    const res = await fetch(`${SERVER_URL}/api/voice-search`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    setTranscript(data.transcript || "");
    setResults(data.restaurants || []);

    const matched = data.restaurants?.length ?? 0;
    if (matched > 0) {
      const top3 = data.restaurants.slice(0, 3).map((r: Restaurant) => r.name).join(", ");
      setResponseText(`${matched}곳 발견: ${top3}${matched > 3 ? ` 외 ${matched - 3}곳` : ""}`);
    } else {
      setResponseText("조건에 맞는 식당을 찾지 못했어요.");
    }

    onResults(data.restaurants || []);

    if (data.audio_base64) {
      const bytes = atob(data.audio_base64);
      const buf = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
      const audioBlob = new Blob([buf], { type: "audio/mpeg" });
      const url = URL.createObjectURL(audioBlob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.play().catch(() => {});
      audio.onended = () => URL.revokeObjectURL(url);
    }

    setPhase("done");
  };

  const submitAudio = async (blob: Blob, mimeType: string) => {
    setPhase("processing");
    const ext = mimeType.includes("ogg") ? "ogg" : "webm";
    try {
      const form = new FormData();
      form.append("audio", blob, `voice.${ext}`);
      form.append("user_lat", String(userLat));
      form.append("user_lng", String(userLng));
      await processForm(form);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "오류가 발생했어요.");
      setPhase("error");
    }
  };

  const handleClear = () => {
    setPhase("idle");
    setTranscript("");
    setResults([]);
    setResponseText("");
    setErrorMsg("");
    audioRef.current?.pause();
    onClear();
  };

  const isRecording = phase === "recording";
  const isProcessing = phase === "processing";

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-2">
      {/* Transcript / response bubble */}
      {(transcript || responseText || errorMsg) && (
        <div className="max-w-xs w-[300px] bg-gray-950/90 backdrop-blur-2xl rounded-2xl border border-white/[0.06] p-3 text-[12px] space-y-1.5 shadow-xl">
          {transcript && (
            <p className="text-gray-400 leading-relaxed">
              <span className="text-gray-600 text-[10px] uppercase tracking-widest font-bold block mb-0.5">음성 인식</span>
              {transcript}
            </p>
          )}
          {responseText && (
            <p className="text-emerald-300 font-medium leading-relaxed">
              <span className="text-gray-600 text-[10px] uppercase tracking-widest font-bold block mb-0.5">결과</span>
              {responseText}
            </p>
          )}
          {errorMsg && (
            <p className="text-rose-400 leading-relaxed">{errorMsg}</p>
          )}
        </div>
      )}

      {/* Result chips */}
      {results.length > 0 && (
        <div className="flex flex-wrap gap-1.5 max-w-xs justify-center">
          {results.slice(0, 5).map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-1 bg-gray-950/80 backdrop-blur-xl border border-white/[0.06] rounded-full px-2.5 py-1 text-[11px] text-gray-300"
            >
              <span className="text-amber-400 text-[10px]">&#9733;</span>
              {r.rating.toFixed(1)}
              <span className="text-gray-500 ml-0.5 max-w-[100px] truncate">{r.name}</span>
            </div>
          ))}
          {results.length > 5 && (
            <div className="flex items-center bg-gray-950/80 backdrop-blur-xl border border-white/[0.06] rounded-full px-2.5 py-1 text-[11px] text-gray-500">
              +{results.length - 5}
            </div>
          )}
        </div>
      )}

      {/* Text input row */}
      <div className="flex items-center gap-2 w-[300px]">
        <input
          type="text"
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !isProcessing) { submitText(textInput); setTextInput(""); } }}
          disabled={isProcessing || isRecording}
          placeholder="텍스트로 검색 (예: 주차 가능한 이탈리안)"
          className="flex-1 bg-gray-900/80 backdrop-blur-xl border border-white/[0.08] rounded-full px-4 py-2 text-[12px] text-gray-300 placeholder-gray-600 focus:outline-none focus:border-violet-500/40 transition-colors"
        />
        <button
          onClick={() => { if (textInput.trim()) { submitText(textInput); setTextInput(""); } }}
          disabled={isProcessing || isRecording || !textInput.trim()}
          className="w-8 h-8 rounded-full bg-violet-900/60 border border-violet-500/20 flex items-center justify-center text-violet-300 hover:bg-violet-800/60 disabled:opacity-30 transition-all"
        >
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/>
          </svg>
        </button>
      </div>

      {/* Controls row */}
      <div className="flex items-center gap-3">
        {/* Clear button — shown when there are results */}
        {(phase === "done" || phase === "error") && (
          <button
            onClick={handleClear}
            className="w-8 h-8 rounded-full bg-gray-800/80 border border-white/[0.06] flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-700/80 transition-all text-xs"
            title="초기화"
          >
            &#x2715;
          </button>
        )}

        {/* Mic button */}
        <button
          onMouseDown={startRecording}
          onMouseUp={stopRecording}
          onTouchStart={(e) => { e.preventDefault(); startRecording(); }}
          onTouchEnd={(e) => { e.preventDefault(); stopRecording(); }}
          disabled={isProcessing}
          className={`
            relative w-14 h-14 rounded-full flex items-center justify-center
            transition-all duration-200 shadow-xl select-none
            ${isRecording
              ? "bg-rose-600 border-2 border-rose-400 scale-110 shadow-rose-500/40"
              : isProcessing
              ? "bg-gray-700/80 border border-white/[0.06] cursor-wait"
              : "bg-gray-900/80 backdrop-blur-xl border border-white/[0.08] hover:border-white/[0.15] hover:bg-gray-800/80 active:scale-95"
            }
          `}
          title={isRecording ? "놓으면 전송" : isProcessing ? "처리 중..." : "누르고 말하기"}
        >
          {/* Pulse ring when recording */}
          {isRecording && (
            <span className="absolute inset-0 rounded-full animate-ping bg-rose-500/30" />
          )}

          {isProcessing ? (
            /* Spinner */
            <svg className="w-5 h-5 text-gray-300 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          ) : (
            /* Mic icon */
            <svg className={`w-6 h-6 ${isRecording ? "text-white" : "text-gray-300"}`} fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4zm0 2a2 2 0 0 0-2 2v6a2 2 0 0 0 4 0V5a2 2 0 0 0-2-2z"/>
              <path d="M19 11a1 1 0 0 1 1 1 8 8 0 0 1-8 8 8 8 0 0 1-8-8 1 1 0 1 1 2 0 6 6 0 0 0 12 0 1 1 0 0 1 1-1z"/>
              <path d="M12 20a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0v-1a1 1 0 0 1 1-1z"/>
            </svg>
          )}
        </button>
      </div>

      {/* Hint label */}
      <p className="text-[10px] text-gray-600 font-medium">
        {isRecording ? "말하는 중... 손을 떼면 검색" : isProcessing ? "분석 중..." : "누르고 말하기"}
      </p>
    </div>
  );
}
