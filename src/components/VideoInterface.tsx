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
  } = usePeerStore();
  const { endCall } = useCallActions();

  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const [localPos, setLocalPos] = useState({ x: 24, y: 24 });
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  // Draggable local video
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
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="flex flex-col items-center gap-4 text-white/40">
          <div className="w-24 h-24 rounded-full bg-white/10 flex items-center justify-center text-5xl">
            👤
          </div>
          <p className="text-lg">Waiting for remote video…</p>
        </div>
      )}

      {/* Status badge */}
      {status === "calling" && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 bg-indigo-600/90 backdrop-blur-md px-6 py-2 rounded-full text-white text-sm font-medium animate-pulse">
          📞 Calling…
        </div>
      )}
      {status === "incoming" && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 bg-emerald-600/90 backdrop-blur-md px-6 py-2 rounded-full text-white text-sm font-medium animate-pulse">
          📲 Incoming Call…
        </div>
      )}

      {/* Draggable local video PiP */}
      {localStream && (
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

      {/* Control Bar */}
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
