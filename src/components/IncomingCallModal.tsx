"use client";

import { usePeerStore } from "@/store/usePeerStore";
import { useCallActions } from "@/components/PeerContainer";
import { useEffect, useRef } from "react";

/**
 * Full-screen modal that blocks the UI while an incoming call is ringing.
 * Accept → triggers media permissions + answers.
 * Decline → closes the peer call and resets to "ready".
 */
export default function IncomingCallModal() {
  const { status, incomingCall } = usePeerStore();
  const { acceptCall, declineCall } = useCallActions();
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const isVisible = status === "incoming" && !!incomingCall;

  // ── Play a ringtone while modal is showing ──────────────────────────────
  useEffect(() => {
    if (isVisible) {
      // Use a Web Audio API beep rather than an audio file (no assets needed)
      let stopped = false;
      let ctx: AudioContext | null = null;

      const ring = async () => {
        try {
          ctx = new AudioContext();
          const beepPattern = async () => {
            if (stopped || !ctx) return;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.value = 480;
            gain.gain.setValueAtTime(0.15, ctx.currentTime);
            osc.start();
            osc.stop(ctx.currentTime + 0.4);
            await new Promise<void>((r) => setTimeout(r, 800));
            if (!stopped) beepPattern();
          };
          beepPattern();
        } catch {
          /* ignore if audio context fails (e.g. no user gesture yet) */
        }
      };
      ring();

      return () => {
        stopped = true;
        ctx?.close().catch(() => {});
      };
    }
  }, [isVisible]);

  if (!isVisible) return null;

  const callerId = incomingCall?.peer ?? "Unknown";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Incoming call"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-md"
    >
      {/* Outer ring animation */}
      <div className="relative flex flex-col items-center gap-8">
        {/* Animated pulsing circles */}
        <div className="relative flex items-center justify-center">
          <span className="absolute w-40 h-40 rounded-full bg-emerald-500/10 animate-ping" />
          <span className="absolute w-32 h-32 rounded-full bg-emerald-500/15 animate-ping [animation-delay:200ms]" />
          <span className="absolute w-24 h-24 rounded-full bg-emerald-500/20 animate-ping [animation-delay:400ms]" />

          {/* Avatar */}
          <div className="relative w-24 h-24 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-xl shadow-indigo-900/60 border-2 border-white/20">
            <span className="text-4xl">👤</span>
          </div>
        </div>

        {/* Call info */}
        <div className="text-center space-y-1">
          <p className="text-white/50 text-sm tracking-widest uppercase font-medium">
            Incoming Video Call
          </p>
          <p className="text-white font-mono text-lg font-semibold break-all max-w-xs px-4">
            {callerId}
          </p>
        </div>

        {/* Accept / Decline buttons */}
        <div className="flex items-center gap-10">
          {/* Decline */}
          <div className="flex flex-col items-center gap-2">
            <button
              id="btn-decline-call"
              onClick={declineCall}
              title="Decline call"
              className="w-16 h-16 rounded-full bg-red-600 hover:bg-red-500 active:scale-90
                flex items-center justify-center text-2xl shadow-lg shadow-red-900/50
                transition-all duration-200 hover:scale-110 border-2 border-red-400/30"
            >
              📵
            </button>
            <span className="text-white/50 text-xs">Decline</span>
          </div>

          {/* Accept */}
          <div className="flex flex-col items-center gap-2">
            <button
              id="btn-accept-call"
              onClick={acceptCall}
              title="Accept call"
              className="w-16 h-16 rounded-full bg-emerald-600 hover:bg-emerald-500 active:scale-90
                flex items-center justify-center text-2xl shadow-lg shadow-emerald-900/50
                transition-all duration-200 hover:scale-110 border-2 border-emerald-400/30"
            >
              📞
            </button>
            <span className="text-white/50 text-xs">Accept</span>
          </div>
        </div>
      </div>
    </div>
  );
}
