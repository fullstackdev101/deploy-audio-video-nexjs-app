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
    hasRemoteVideo,
    hasLocalVideo,
  } = usePeerStore();
  const { endCall } = useCallActions();

  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const [localPos, setLocalPos] = useState({ x: 24, y: 24 });
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  // ── Attach remote stream via callback ref so srcObject is set the moment
  //    the <video> element mounts, regardless of stream timing. ─────────────
  const remoteCallbackRef = useCallback(
    (el: HTMLVideoElement | null) => {
      (
        remoteVideoRef as React.MutableRefObject<HTMLVideoElement | null>
      ).current = el;
      if (el && remoteStream && el.srcObject !== remoteStream) {
        el.srcObject = remoteStream;
      }
    },
    [remoteStream],
  );

  // Also update if stream object reference changes after mount
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  // ── Draggable local PiP — mouse ───────────────────────────────────────────
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      dragging.current = true;
      dragOffset.current = {
        x: e.clientX - localPos.x,
        y: e.clientY - localPos.y,
      };
      e.preventDefault();
    },
    [localPos],
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

  // Audio-only call indicator
  const isAudioOnlyCall =
    status === "connected" && !hasRemoteVideo && !hasLocalVideo;
  const remoteIsAudioOnly =
    status === "connected" && remoteStream && !hasRemoteVideo;
  const localIsAudioOnly =
    status === "connected" && localStream && !hasLocalVideo;

  const connectionLabel =
    status === "connected"
      ? hasRemoteVideo
        ? "Video connected"
        : "Audio connected"
      : status === "calling"
        ? "Connecting…"
        : "Calling";
  const connectionSubtext =
    status === "connected"
      ? "Connection fully established"
      : "Waiting for remote peer";

  return (
    <div className="relative w-full h-full bg-black flex items-center justify-center">
      {/* Connection status badge */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20">
        <div className="rounded-full border border-white/15 bg-slate-950/90 px-4 py-2 text-center backdrop-blur-sm shadow-xl shadow-slate-950/30">
          <p className="text-xs text-slate-300 uppercase tracking-[0.2em]">
            {connectionLabel}
          </p>
          <p className="text-sm text-white/80">{connectionSubtext}</p>
        </div>
      </div>

      {/* Audio-only call overlay */}
      {isAudioOnlyCall && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-linear-to-br from-slate-900 to-slate-800 z-30">
          <div className="flex flex-col items-center gap-4">
            <div className="w-32 h-32 rounded-full bg-linear-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-2xl border-2 border-white/20">
              <span className="text-6xl">🎙️</span>
            </div>
            <div className="text-center space-y-2">
              <h2 className="text-2xl font-bold text-white">Audio Call</h2>
              <p className="text-white/60 text-sm">
                Video not available • Sound active
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Remote video - full background */}
      {remoteStream && hasRemoteVideo ? (
        <video
          ref={remoteCallbackRef}
          autoPlay
          playsInline
          className={`w-full h-full transition-all duration-300 bg-slate-950 ${
            videoFit === "cover" ? "object-cover" : "object-contain"
          }`}
        />
      ) : remoteStream && !hasRemoteVideo ? (
        // Remote audio-only (remote has no camera)
        <div className="flex flex-col items-center gap-4 text-white/40">
          <div className="w-32 h-32 rounded-full bg-linear-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg border-2 border-white/20">
            <span className="text-5xl">👤</span>
          </div>
          <div className="text-center space-y-1">
            <p className="text-lg font-medium">Remote peer is audio-only</p>
            <p className="text-sm text-white/30">
              They don't have camera enabled
            </p>
          </div>
        </div>
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
            <div className="relative w-24 h-24 rounded-full bg-linear-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-xl border-2 border-white/20">
              <span className="text-4xl">📞</span>
            </div>
          </div>
          <div className="text-center space-y-1">
            <p className="text-white font-semibold text-xl animate-pulse">
              Calling…
            </p>
            <p className="text-white/50 text-sm">
              Waiting for the other person to answer
            </p>
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

      {/* Draggable local PiP — visible during CALLING and CONNECTED */}
      {localStream &&
        hasLocalVideo &&
        (status === "connected" || status === "calling") && (
          <LocalPiP
            localVideoRef={localVideoRef}
            localStream={localStream}
            localPos={localPos}
            setLocalPos={setLocalPos}
            isCameraOff={isCameraOff}
            onMouseDown={onMouseDown}
          />
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
          {hasLocalVideo && (
            <>
              <ControlBtn
                onClick={toggleCamera}
                active={isCameraOff}
                title={isCameraOff ? "Enable Camera" : "Disable Camera"}
                emoji={isCameraOff ? "📵" : "📷"}
                danger={isCameraOff}
              />
              {/* Divider */}
              <div className="w-px h-6 bg-white/10" />
            </>
          )}
          <ControlBtn
            onClick={toggleChat}
            active={isChatOpen}
            title={isChatOpen ? "Close Chat" : "Open Chat"}
            emoji="💬"
          />
          {hasLocalVideo && (
            <ControlBtn
              onClick={toggleVideoFit}
              active={videoFit === "cover"}
              title={videoFit === "cover" ? "Fit Video" : "Fill Video"}
              emoji={videoFit === "cover" ? "🔲" : "🔳"}
            />
          )}
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

// ── Local PiP: callback ref ensures srcObject assigned on mount ─────────────
function LocalPiP({
  localVideoRef,
  localStream,
  localPos,
  setLocalPos,
  isCameraOff,
  onMouseDown,
}: {
  localVideoRef: React.RefObject<HTMLVideoElement | null>;
  localStream: MediaStream;
  localPos: { x: number; y: number };
  setLocalPos: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>;
  isCameraOff: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  // Callback ref: fires when the <video> element first mounts.
  // This guarantees srcObject is set even if localStream was already
  // in the store before this subtree appeared in the DOM.
  const videoCallbackRef = useCallback(
    (el: HTMLVideoElement | null) => {
      (
        localVideoRef as React.MutableRefObject<HTMLVideoElement | null>
      ).current = el;
      if (el && el.srcObject !== localStream) {
        el.srcObject = localStream;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [localStream],
  );

  // ── Touch drag support for mobile ──────────────────────────────────────
  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      dragging.current = true;
      const touch = e.touches[0];
      dragOffset.current = {
        x: touch.clientX - localPos.x,
        y: touch.clientY - localPos.y,
      };
    },
    [localPos],
  );

  useEffect(() => {
    const onTouchMove = (e: TouchEvent) => {
      if (!dragging.current) return;
      e.preventDefault();
      const touch = e.touches[0];
      setLocalPos({
        x: touch.clientX - dragOffset.current.x,
        y: touch.clientY - dragOffset.current.y,
      });
    };
    const onTouchEnd = () => {
      dragging.current = false;
    };
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd);
    return () => {
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [setLocalPos]);

  return (
    <div
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      style={{ left: localPos.x, top: localPos.y }}
      className="absolute w-44 h-32 rounded-2xl overflow-hidden border-2 border-white/20 shadow-2xl cursor-grab active:cursor-grabbing select-none z-10"
    >
      <video
        ref={videoCallbackRef}
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
