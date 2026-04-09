"use client";

import { useState } from "react";
import { usePeerStore } from "@/store/usePeerStore";
import { useGroupStore } from "@/store/useGroupStore";
import { useGroupCallActions } from "@/components/GroupPeerContainer";

interface GroupRoomProps {
  onBack: () => void;
}

export default function GroupRoom({ onBack }: GroupRoomProps) {
  const myId = usePeerStore((s) => s.myId);
  const peerStatus = usePeerStore((s) => s.status);
  const { groupStatus, groupError } = useGroupStore();
  const { createRoom, joinRoom } = useGroupCallActions();

  const [mode, setMode] = useState<"menu" | "create" | "join">("menu");
  const [displayName, setDisplayName] = useState("");
  const [roomIdInput, setRoomIdInput] = useState("");
  const [copied, setCopied] = useState(false);

  const isReady = peerStatus === "ready";

  const handleCreate = async () => {
    await createRoom(displayName || undefined);
  };

  const handleJoin = async () => {
    if (!roomIdInput.trim()) return;
    await joinRoom(roomIdInput.trim(), displayName || undefined);
  };

  const copyMyId = async () => {
    await navigator.clipboard.writeText(myId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // error state
  if (groupStatus === "error") {
    return (
      <div className="min-h-screen flex items-center justify-center p-6"
        style={{ background: "linear-gradient(135deg, #0f172a 0%, #111827 50%, #312e81 100%)" }}>
        <div className="relative z-10 w-full max-w-md space-y-6">
          <div className="bg-red-950/50 border border-red-800 rounded-2xl p-6 text-center space-y-4">
            <div className="text-4xl">⚠️</div>
            <p className="text-red-300 text-sm">{groupError || "Something went wrong."}</p>
            <button
              onClick={onBack}
              className="px-6 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-xl text-sm transition-all"
            >
              ← Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  // joining spinner
  if (groupStatus === "joining") {
    return (
      <div className="min-h-screen flex items-center justify-center p-6"
        style={{ background: "linear-gradient(135deg, #0f172a 0%, #111827 50%, #312e81 100%)" }}>
        <div className="relative z-10 flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-full border-4 border-indigo-500/30 border-t-indigo-500 animate-spin" />
          <p className="text-white/60 text-sm">Setting up your room…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6"
      style={{ background: "linear-gradient(135deg, #0f172a 0%, #111827 50%, #312e81 100%)" }}>
      {/* Background orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-violet-600/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-indigo-600/20 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-md space-y-6">
        {/* Header */}
        <div className="text-center">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-white/40 hover:text-white/70 text-xs mb-4 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to 1-to-1
          </button>
          <div className="inline-flex items-center gap-2 bg-violet-500/10 border border-violet-500/20 rounded-full px-4 py-1.5 mb-4">
            <div className="w-2 h-2 rounded-full bg-violet-400 animate-pulse" />
            <span className="text-violet-300/80 text-xs tracking-widest uppercase font-medium">
              Group Call
            </span>
          </div>
          <h1 className="text-4xl font-bold text-white mb-1 tracking-tight">
            Peer<span className="text-violet-400">Link</span>
            <span className="text-indigo-400 text-2xl ml-2">Group</span>
          </h1>
          <p className="text-white/40 text-sm">
            Mesh-powered group video calls (up to 5 peers)
          </p>
        </div>

        {/* Peer ID badge */}
        <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-4">
          <div className="flex items-center gap-2 text-white/50 text-xs uppercase tracking-widest font-semibold mb-2">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" />
            </svg>
            Your Peer ID
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-slate-800/60 border border-white/8 rounded-xl px-3 py-2">
              <p className="text-indigo-300 font-mono text-sm truncate">{myId || "—"}</p>
            </div>
            <button onClick={copyMyId} disabled={!myId}
              className="shrink-0 w-10 h-10 flex items-center justify-center rounded-xl bg-indigo-600/30 hover:bg-indigo-600/60 border border-indigo-500/30 transition-all duration-200 disabled:opacity-40 hover:scale-105 active:scale-95">
              {copied ? (
                <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Display name input */}
        <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-4 space-y-3">
          <label className="text-white/50 text-xs uppercase tracking-widest font-semibold">
            Display Name (optional)
          </label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Enter your name…"
            className="w-full bg-slate-800/60 border border-white/8 rounded-xl px-4 py-3 text-sm
              text-white placeholder-white/25 focus:outline-none focus:ring-2 focus:ring-violet-500/50
              transition-all"
          />
        </div>

        {/* Mode selection */}
        {mode === "menu" && (
          <div className="space-y-3">
            <button
              onClick={() => setMode("create")}
              disabled={!isReady}
              className="w-full flex items-center justify-center gap-3 px-6 py-4 rounded-2xl
                bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500
                text-white font-semibold text-sm border border-violet-400/20
                transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]
                disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100
                shadow-lg shadow-violet-900/40"
            >
              <span className="text-xl">🎬</span>
              Create Room
            </button>

            <button
              onClick={() => setMode("join")}
              disabled={!isReady}
              className="w-full flex items-center justify-center gap-3 px-6 py-4 rounded-2xl
                bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20
                text-white/80 hover:text-white font-semibold text-sm
                transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]
                disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
            >
              <span className="text-xl">🔗</span>
              Join Room
            </button>
          </div>
        )}

        {/* Create room flow */}
        {mode === "create" && (
          <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <button onClick={() => setMode("menu")} className="text-white/40 hover:text-white transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <h3 className="text-white font-semibold text-sm">Create a new room</h3>
            </div>
            <p className="text-white/40 text-xs leading-relaxed">
              Your Peer ID will be the Room ID. Share it with up to 4 other people to start a group call.
            </p>
            <button
              onClick={handleCreate}
              disabled={!isReady}
              className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl
                bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500
                text-white font-medium text-sm transition-all duration-200
                hover:scale-105 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed
                shadow-lg shadow-violet-900/30"
            >
              🎬 Create & Start
            </button>
          </div>
        )}

        {/* Join room flow */}
        {mode === "join" && (
          <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <button onClick={() => setMode("menu")} className="text-white/40 hover:text-white transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <h3 className="text-white font-semibold text-sm">Join an existing room</h3>
            </div>
            <input
              type="text"
              value={roomIdInput}
              onChange={(e) => setRoomIdInput(e.target.value)}
              placeholder="Paste Room ID here…"
              className="w-full bg-slate-800/60 border border-white/8 rounded-xl px-4 py-3 text-sm
                text-white placeholder-white/25 focus:outline-none focus:ring-2 focus:ring-violet-500/50
                transition-all font-mono"
            />
            <button
              onClick={handleJoin}
              disabled={!isReady || !roomIdInput.trim()}
              className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl
                bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500
                text-white font-medium text-sm transition-all duration-200
                hover:scale-105 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed
                shadow-lg shadow-emerald-900/30"
            >
              🔗 Join Room
            </button>
          </div>
        )}

        {/* Footer */}
        <p className="text-center text-white/20 text-xs">
          Mesh topology · Max 5 peers · End-to-end encrypted via WebRTC
        </p>
      </div>
    </div>
  );
}
