"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useGroupStore } from "@/store/useGroupStore";
import { usePeerStore } from "@/store/usePeerStore";
import { useGroupCallActions } from "@/components/GroupPeerContainer";

// ─── Grid layout helper ──────────────────────────────────────────────────────
// Returns CSS grid classes based on participant count (including self)
function gridClass(count: number): string {
  if (count <= 1) return "grid-cols-1";
  if (count <= 2) return "grid-cols-1 sm:grid-cols-2";
  if (count <= 4) return "grid-cols-2";
  if (count <= 6) return "grid-cols-2 sm:grid-cols-3";
  return "grid-cols-3 sm:grid-cols-4";
}

// ─── Main component ──────────────────────────────────────────────────────────
export default function GroupVideoGrid() {
  const {
    participants,
    localStream,
    hasLocalVideo,
    isMuted,
    isCameraOff,
    groupStatus,
    roomId,
    isChatOpen,
    myDisplayName,
  } = useGroupStore();
  const { leaveRoom } = useGroupCallActions();
  const myId = usePeerStore((s) => s.myId);
  const participantArray = Array.from(participants.values());
  const totalTiles = participantArray.length + 1; // +1 for self

  if (groupStatus !== "in-room") return null;

  return (
    <div className="fixed inset-0 z-40 bg-slate-950 flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-900/80 border-b border-white/5 backdrop-blur-lg z-10">
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
          <div>
            <p className="text-white text-sm font-semibold tracking-wide">
              Group Call
            </p>
            <p className="text-white/40 text-[11px] font-mono">
              Room: {roomId?.slice(0, 12)}…
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-white/5 border border-white/10 rounded-full px-3 py-1">
            <svg className="w-3.5 h-3.5 text-white/50" fill="currentColor" viewBox="0 0 24 24">
              <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
            </svg>
            <span className="text-white/60 text-xs font-medium">{totalTiles}</span>
          </div>
        </div>
      </div>

      {/* Video grid */}
      <div className={`flex-1 grid ${gridClass(totalTiles)} gap-2 p-2 auto-rows-fr overflow-hidden`}>
        {/* Self tile — always first */}
        <SelfTile
          localStream={localStream}
          hasVideo={hasLocalVideo}
          isCameraOff={isCameraOff}
          isMuted={isMuted}
          displayName={myDisplayName}
        />

        {/* Remote participant tiles */}
        {participantArray.map((p) => (
          <ParticipantTile key={p.peerId} participant={p} />
        ))}
      </div>

      {/* Bottom control bar */}
      <ControlBar />
    </div>
  );
}

// ─── Self video tile ─────────────────────────────────────────────────────────
function SelfTile({
  localStream,
  hasVideo,
  isCameraOff,
  isMuted,
  displayName,
}: {
  localStream: MediaStream | null;
  hasVideo: boolean;
  isCameraOff: boolean;
  isMuted: boolean;
  displayName: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  const callbackRef = useCallback(
    (el: HTMLVideoElement | null) => {
      (videoRef as React.MutableRefObject<HTMLVideoElement | null>).current = el;
      if (el && localStream && el.srcObject !== localStream) {
        el.srcObject = localStream;
      }
    },
    [localStream],
  );

  useEffect(() => {
    if (videoRef.current && localStream) {
      videoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  return (
    <div className="relative rounded-2xl overflow-hidden bg-slate-900 border border-white/5 group">
      {hasVideo && !isCameraOff ? (
        <video
          ref={callbackRef}
          autoPlay
          muted
          playsInline
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-slate-800 to-slate-900">
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-3xl border-2 border-white/20 shadow-lg shadow-indigo-900/40">
            {displayName.charAt(0).toUpperCase()}
          </div>
          <p className="text-white/50 text-sm">{isCameraOff ? "Camera off" : "No camera"}</p>
        </div>
      )}

      {/* Name badge */}
      <div className="absolute bottom-2 left-2 flex items-center gap-1.5 bg-black/60 backdrop-blur-sm rounded-lg px-2.5 py-1">
        {isMuted && (
          <svg className="w-3.5 h-3.5 text-red-400" fill="currentColor" viewBox="0 0 24 24">
            <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z" />
          </svg>
        )}
        <span className="text-white text-xs font-medium">{displayName} (You)</span>
      </div>
    </div>
  );
}

// ─── Remote participant tile ─────────────────────────────────────────────────
function ParticipantTile({
  participant,
}: {
  participant: ReturnType<typeof useGroupStore.getState>["participants"] extends Map<string, infer V> ? { [K in keyof V]: V[K] } : never;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  const callbackRef = useCallback(
    (el: HTMLVideoElement | null) => {
      (videoRef as React.MutableRefObject<HTMLVideoElement | null>).current = el;
      if (el && participant.remoteStream && el.srcObject !== participant.remoteStream) {
        el.srcObject = participant.remoteStream;
      }
    },
    [participant.remoteStream],
  );

  useEffect(() => {
    if (videoRef.current && participant.remoteStream) {
      videoRef.current.srcObject = participant.remoteStream;
    }
  }, [participant.remoteStream]);

  const hasVideo = participant.hasVideo && participant.remoteStream;
  const isConnecting = !participant.remoteStream;

  return (
    <div className="relative rounded-2xl overflow-hidden bg-slate-900 border border-white/5 group">
      {hasVideo ? (
        <video
          ref={callbackRef}
          autoPlay
          playsInline
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-slate-800 to-slate-900">
          <div className={`w-20 h-20 rounded-full flex items-center justify-center text-3xl border-2 border-white/20 shadow-lg ${
            isConnecting
              ? "bg-gradient-to-br from-amber-500 to-orange-600 shadow-amber-900/40 animate-pulse"
              : "bg-gradient-to-br from-emerald-500 to-teal-600 shadow-emerald-900/40"
          }`}>
            {isConnecting ? "⏳" : participant.displayName.charAt(0).toUpperCase()}
          </div>
          <p className="text-white/50 text-sm">
            {isConnecting ? "Connecting…" : participant.hasAudio ? "Audio only" : "No media"}
          </p>
        </div>
      )}

      {/* Name badge */}
      <div className="absolute bottom-2 left-2 flex items-center gap-1.5 bg-black/60 backdrop-blur-sm rounded-lg px-2.5 py-1">
        {participant.isMuted && (
          <svg className="w-3.5 h-3.5 text-red-400" fill="currentColor" viewBox="0 0 24 24">
            <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z" />
          </svg>
        )}
        <span className="text-white text-xs font-medium">{participant.displayName}</span>
      </div>

      {/* Connection quality indicator */}
      {participant.remoteStream && (
        <div className="absolute top-2 right-2">
          <div className="flex gap-0.5">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="w-1 rounded-full bg-emerald-400"
                style={{ height: `${6 + i * 3}px` }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Bottom control bar ──────────────────────────────────────────────────────
function ControlBar() {
  const { isMuted, isCameraOff, hasLocalVideo, isChatOpen } = useGroupStore();
  const { toggleGroupMute, toggleGroupCamera, toggleGroupChat } = useGroupStore();
  const { leaveRoom } = useGroupCallActions();
  const [showInvite, setShowInvite] = useState(false);

  return (
    <div className="flex items-center justify-center gap-3 px-4 py-4 bg-slate-900/80 border-t border-white/5 backdrop-blur-lg">
      {/* Mute */}
      <button
        onClick={toggleGroupMute}
        title={isMuted ? "Unmute" : "Mute"}
        className={`flex items-center justify-center w-12 h-12 rounded-full transition-all duration-200 text-lg shadow-lg hover:scale-110 active:scale-95 ${
          isMuted
            ? "bg-red-600/80 hover:bg-red-500"
            : "bg-white/10 hover:bg-white/20"
        }`}
      >
        {isMuted ? "🔇" : "🎤"}
      </button>

      {/* Camera */}
      {hasLocalVideo && (
        <button
          onClick={toggleGroupCamera}
          title={isCameraOff ? "Enable Camera" : "Disable Camera"}
          className={`flex items-center justify-center w-12 h-12 rounded-full transition-all duration-200 text-lg shadow-lg hover:scale-110 active:scale-95 ${
            isCameraOff
              ? "bg-red-600/80 hover:bg-red-500"
              : "bg-white/10 hover:bg-white/20"
          }`}
        >
          {isCameraOff ? "📵" : "📷"}
        </button>
      )}

      {/* Divider */}
      <div className="w-px h-8 bg-white/10" />

      {/* Chat */}
      <button
        onClick={toggleGroupChat}
        title={isChatOpen ? "Close Chat" : "Open Chat"}
        className={`flex items-center justify-center w-12 h-12 rounded-full transition-all duration-200 text-lg shadow-lg hover:scale-110 active:scale-95 ${
          isChatOpen
            ? "bg-indigo-600/80 hover:bg-indigo-500"
            : "bg-white/10 hover:bg-white/20"
        }`}
      >
        💬
      </button>

      {/* Invite */}
      <button
        onClick={() => setShowInvite(!showInvite)}
        title="Invite Peer"
        className={`flex items-center justify-center w-12 h-12 rounded-full transition-all duration-200 text-lg shadow-lg hover:scale-110 active:scale-95 ${
          showInvite
            ? "bg-emerald-600/80 hover:bg-emerald-500"
            : "bg-white/10 hover:bg-white/20"
        }`}
      >
        👥
      </button>

      {/* Divider */}
      <div className="w-px h-8 bg-white/10" />

      {/* Leave */}
      <button
        onClick={leaveRoom}
        title="Leave Room"
        className="flex items-center justify-center w-12 h-12 rounded-full bg-red-600 hover:bg-red-500 transition-all duration-200 text-lg shadow-lg shadow-red-900/40 hover:scale-110 active:scale-95"
      >
        📵
      </button>

      {/* Inline invite popup */}
      {showInvite && <InvitePopup onClose={() => setShowInvite(false)} />}
    </div>
  );
}

// ─── Invite popup ────────────────────────────────────────────────────────────
function InvitePopup({ onClose }: { onClose: () => void }) {
  const [peerId, setPeerId] = useState("");
  const [copied, setCopied] = useState(false);
  const { invitePeer } = useGroupCallActions();
  const roomId = useGroupStore((s) => s.roomId);

  const copyRoomId = async () => {
    await navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="absolute bottom-20 left-1/2 -translate-x-1/2 bg-slate-900 border border-white/10 rounded-2xl p-4 shadow-2xl w-80 z-50">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-white text-sm font-semibold">Invite to Room</h3>
        <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Share room ID */}
      <div className="mb-3">
        <label className="text-white/40 text-xs uppercase tracking-wider font-medium mb-1 block">
          Room ID (share this)
        </label>
        <div className="flex gap-2">
          <div className="flex-1 bg-slate-800/60 border border-white/8 rounded-lg px-3 py-2 text-indigo-300 font-mono text-xs truncate">
            {roomId}
          </div>
          <button
            onClick={copyRoomId}
            className="shrink-0 px-3 py-2 bg-indigo-600/30 hover:bg-indigo-600/60 border border-indigo-500/30 rounded-lg text-xs text-indigo-300 transition-all"
          >
            {copied ? "✓" : "Copy"}
          </button>
        </div>
      </div>

      {/* Direct invite */}
      <div>
        <label className="text-white/40 text-xs uppercase tracking-wider font-medium mb-1 block">
          Or invite by Peer ID
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={peerId}
            onChange={(e) => setPeerId(e.target.value)}
            placeholder="Enter peer ID…"
            className="flex-1 bg-slate-800/60 border border-white/8 rounded-lg px-3 py-2 text-sm text-white placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
          />
          <button
            onClick={() => {
              if (peerId.trim()) {
                invitePeer(peerId.trim());
                setPeerId("");
              }
            }}
            disabled={!peerId.trim()}
            className="shrink-0 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 rounded-lg text-xs text-white font-medium transition-all"
          >
            Invite
          </button>
        </div>
      </div>
    </div>
  );
}
