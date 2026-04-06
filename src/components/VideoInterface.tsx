"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { usePeerStore } from "@/store/usePeerStore";
import { useCallActions } from "@/components/PeerContainer";

export default function VideoInterface() {
  const {
    remoteStream,
    localStream,
    isMuted,
    isCameraOff,
    status,
    toggleMute,
    toggleCamera,
    toggleChat,
    isChatOpen,
    videoFit,
    toggleVideoFit,
  } = usePeerStore();
  const { endCall } = useCallActions();

  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const [localPos, setLocalPos] = useState({ x: 24, y: 24 });
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  // ── Attach remote stream ──────────────────────────────────────────────────
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  // ── Attach local stream ───────────────────────────────────────────────────
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  // ── Draggable local PiP ───────────────────────────────────────────────────
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      dragging.current = true;
      dragOffset.current = {
        x: e.clientX - localPos.x,
        y: e.clientY - localPos.y,
      };
      e.preventDefault();
    },
    [localPos]
  );

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      setLocalPos({
        x: e.clientX - dragOffset.current.x,
        y: e.clientY - dragOffset.current.y,
      });
    };
    const onMouseUp = () => {
      dragging.current = false;
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  if (!remoteStream && !localStream) return null;

  return (
    <div className="relative w-full h-full bg-black flex items-center justify-center">
      {/* Remote video - full background */}
      {remoteStream ? (
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className={`w-full h-full transition-all duration-300 bg-slate-950 ${
            videoFit === "cover" ? "object-cover" : "object-contain"
          }`}
        />
      ) : (
        <div className="flex flex-col items-center gap-4 text-white/40">
          <div className="w-24 h-24 rounded-full bg-white/10 flex items-center justify-center text-5xl">
            👤
          </div>
          <p className="text-lg">Waiting for remote video…</p>
        </div>
      )}

      {/* Calling overlay — shown while caller waits for receiver to answer */}
      {status === "calling" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-black/60 backdrop-blur-sm">
          {/* Pulsing ring */}
          <div className="relative flex items-center justify-center">
            <span className="absolute w-36 h-36 rounded-full bg-indigo-500/15 animate-ping" />
            <span className="absolute w-28 h-28 rounded-full bg-indigo-500/20 animate-ping [animation-delay:200ms]" />
            <div className="relative w-24 h-24 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-xl border-2 border-white/20">
              <span className="text-4xl">📞</span>
            </div>
          </div>
          <div className="text-center space-y-1">
            <p className="text-white font-semibold text-xl animate-pulse">Calling…</p>
            <p className="text-white/50 text-sm">Waiting for the other person to answer</p>
          </div>
          <button
            id="btn-cancel-call"
            onClick={endCall}
            title="Cancel call"
            className="flex items-center gap-2 px-6 py-3 rounded-full bg-red-600 hover:bg-red-500
              text-white font-medium transition-all duration-200 hover:scale-105 active:scale-95
              shadow-lg shadow-red-900/40"
          >
            📵 Cancel Call
          </button>
        </div>
      )}

      {/* Draggable local video PiP */}
      {localStream && status === "connected" && (
        <div
          onMouseDown={onMouseDown}
          style={{ left: localPos.x, top: localPos.y }}
          className="absolute w-44 h-32 rounded-2xl overflow-hidden border-2 border-white/20 shadow-2xl cursor-grab active:cursor-grabbing select-none z-10"
        >
          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            className={`w-full h-full object-cover ${
              isCameraOff ? "opacity-0" : ""
            }`}
          />
          {isCameraOff && (
            <div className="absolute inset-0 bg-slate-800 flex items-center justify-center">
              <span className="text-3xl">🚫</span>
            </div>
          )}
          <div className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[10px] text-white/60 bg-black/40 rounded px-1">
            You
          </div>
        </div>
      )}

      {/* Control Bar — only shown when fully connected */}
      {status === "connected" && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-slate-900/80 backdrop-blur-xl px-6 py-3 rounded-2xl border border-white/10 shadow-2xl z-10">
          <ControlBtn
            onClick={toggleMute}
            active={isMuted}
            title={isMuted ? "Unmute" : "Mute"}
            emoji={isMuted ? "🔇" : "🎤"}
            danger={isMuted}
          />
          <ControlBtn
            onClick={toggleCamera}
            active={isCameraOff}
            title={isCameraOff ? "Enable Camera" : "Disable Camera"}
            emoji={isCameraOff ? "📵" : "📷"}
            danger={isCameraOff}
          />
          {/* Divider */}
          <div className="w-px h-6 bg-white/10" />
          <ControlBtn
            onClick={toggleChat}
            active={isChatOpen}
            title={isChatOpen ? "Close Chat" : "Open Chat"}
            emoji="💬"
          />
          <ControlBtn
            onClick={toggleVideoFit}
            active={videoFit === "cover"}
            title={videoFit === "cover" ? "Fit Video" : "Fill Video"}
            emoji={videoFit === "cover" ? "🔲" : "🔳"}
          />
          {/* Divider */}
          <div className="w-px h-6 bg-white/10" />
          <button
            onClick={endCall}
            title="End Call"
            className="flex items-center justify-center w-12 h-12 rounded-full bg-red-600 hover:bg-red-500 transition-all duration-200 text-xl shadow-lg hover:scale-110 active:scale-95"
          >
            📵
          </button>
        </div>
      )}
    </div>
  );
}

function ControlBtn({
  onClick,
  active,
  title,
  emoji,
  danger,
}: {
  onClick: () => void;
  active: boolean;
  title: string;
  emoji: string;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex items-center justify-center w-12 h-12 rounded-full transition-all duration-200 text-xl shadow-lg hover:scale-110 active:scale-95 ${
        active && !danger
          ? "bg-indigo-600/80 hover:bg-indigo-500"
          : danger
          ? "bg-red-600/80 hover:bg-red-500"
          : "bg-white/10 hover:bg-white/20"
      }`}
    >
      {emoji}
    </button>
  );
}
