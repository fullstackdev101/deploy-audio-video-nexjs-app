"use client";

import { useState, useEffect } from "react";
import { usePeerStore } from "@/store/usePeerStore";
import { useCallActions } from "@/components/PeerContainer";

export default function Dashboard() {
  const {
    myId,
    status,
    remotePeerId,
    setRemotePeerId,
    errorMessage,
    localStream,
    remoteStream,
    setStatus,
  } = usePeerStore();
  const { startCall, startTextChat, endCall } = useCallActions();
  const [copied, setCopied] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const copyId = async () => {
    await navigator.clipboard.writeText(myId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Prevent hydration mismatch when using Zustand state
  if (!mounted) {
    return null; // Or a loading skeleton
  }

  const isConnected = status === "connected";
  const isBusy =
    status === "calling" ||
    status === "incoming" ||
    status === "connected";
  const isReady = status === "ready" || status === "connected";
  const hasActiveMedia = !!(localStream || remoteStream);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 flex items-center justify-center p-6">
      {/* Background orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-indigo-600/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-violet-600/20 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-sky-600/10 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-md space-y-6">
        {/* Header */}
        <div className="text-center">
          <div className="inline-flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-4 py-1.5 mb-4">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-white/60 text-xs tracking-widest uppercase font-medium">
              WebRTC P2P
            </span>
          </div>
          <h1 className="text-4xl font-bold text-white mb-1 tracking-tight">
            Peer<span className="text-indigo-400">Link</span>
          </h1>
          <p className="text-white/40 text-sm">
            Encrypted peer-to-peer communication
          </p>
        </div>

        {/* Status indicator */}
        <StatusBadge
          status={status}
          errorMessage={errorMessage}
          onRetry={() => setStatus("ready")}
        />

        {/* My ID Card */}
        <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2 text-white/50 text-xs uppercase tracking-widest font-semibold">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2"
              />
            </svg>
            Your Peer ID
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-slate-800/60 border border-white/8 rounded-xl px-4 py-2.5">
              {status === "initializing" ? (
                <div className="flex gap-1 items-center">
                  <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:0ms]" />
                  <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:150ms]" />
                  <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:300ms]" />
                </div>
              ) : (
                <p className="text-indigo-300 font-mono text-sm truncate" id="my-peer-id">
                  {myId || "—"}
                </p>
              )}
            </div>
            <button
              onClick={copyId}
              disabled={!myId}
              id="btn-copy-id"
              className="shrink-0 w-10 h-10 flex items-center justify-center rounded-xl bg-indigo-600/30 hover:bg-indigo-600/60 border border-indigo-500/30 transition-all duration-200 disabled:opacity-40 hover:scale-105 active:scale-95"
              title="Copy ID"
            >
              {copied ? (
                <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Connect Card */}
        <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2 text-white/50 text-xs uppercase tracking-widest font-semibold">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/>
            </svg>
            Connect to Peer
          </div>
          <input
            id="remote-peer-id-input"
            type="text"
            value={remotePeerId}
            onChange={(e) => setRemotePeerId(e.target.value)}
            disabled={isBusy}
            placeholder="Enter remote peer ID…"
            className="w-full bg-slate-800/60 border border-white/8 rounded-xl px-4 py-3 text-sm
              text-white placeholder-white/25 focus:outline-none focus:ring-2 focus:ring-indigo-500/50
              disabled:opacity-40 transition-all font-mono"
          />

          <div className="grid grid-cols-2 gap-3">
            <CallButton
              id="btn-video-call"
              onClick={startCall}
              disabled={!isReady || !remotePeerId || isBusy}
              emoji="📹"
              label="Video Call"
              variant="primary"
            />
            <CallButton
              id="btn-text-chat"
              onClick={startTextChat}
              disabled={!isReady || !remotePeerId || isBusy}
              emoji="💬"
              label="Text Chat"
              variant="secondary"
            />
          </div>

          {isBusy && (
            <CallButton
              id="btn-end-call"
              onClick={endCall}
              disabled={false}
              emoji="📵"
              label="End / Disconnect"
              variant="danger"
            />
          )}
        </div>

        {/* Active session info */}
        {hasActiveMedia && (
          <ActiveSessionCard />
        )}

        {/* Footer */}
        <p className="text-center text-white/20 text-xs">
          End-to-end encrypted via WebRTC · PeerJS
        </p>
      </div>
    </div>
  );
}

function StatusBadge({
  status,
  errorMessage,
  onRetry,
}: {
  status: string;
  errorMessage: string;
  onRetry: () => void;
}) {
  const map: Record<string, { color: string; dot: string; label: string }> = {
    idle: {
      color: "bg-slate-800 border-slate-700",
      dot: "bg-slate-500",
      label: "Idle",
    },
    initializing: {
      color: "bg-amber-950 border-amber-800",
      dot: "bg-amber-400 animate-pulse",
      label: "Initializing…",
    },
    ready: {
      color: "bg-emerald-950 border-emerald-800",
      dot: "bg-emerald-400 animate-pulse",
      label: "Ready",
    },
    calling: {
      color: "bg-indigo-950 border-indigo-800",
      dot: "bg-indigo-400 animate-pulse",
      label: "Calling… (waiting for answer)",
    },
    incoming: {
      color: "bg-violet-950 border-violet-800",
      dot: "bg-violet-400 animate-pulse",
      label: "Incoming call…",
    },
    connected: {
      color: "bg-sky-950 border-sky-800",
      dot: "bg-sky-400 animate-pulse",
      label: "Connected",
    },
    declined: {
      color: "bg-orange-950 border-orange-800",
      dot: "bg-orange-400",
      label: "Call declined",
    },
    error: {
      color: "bg-red-950 border-red-800",
      dot: "bg-red-400",
      label: "Error",
    },
  };

  const s = map[status] || map.idle;

  if (status === "error") {
    return (
      <div className="rounded-xl border border-red-800 bg-red-950 p-4 space-y-2">
        <div className="flex items-start gap-2.5">
          <div className="w-2 h-2 rounded-full bg-red-400 shrink-0 mt-1.5" />
          <p className="text-red-300 text-sm leading-relaxed flex-1">
            {errorMessage || "An unknown error occurred."}
          </p>
        </div>
        <div className="pl-4.5 flex flex-col gap-1 text-xs text-red-400/70">
          <p>• Make sure your browser has camera/mic permission for this site.</p>
          <p>• Check that no other app is using the camera.</p>
          <p>• Try refreshing the page and allowing access when prompted.</p>
        </div>
        <button
          onClick={onRetry}
          className="mt-1 ml-4.5 text-xs text-red-300 underline hover:text-red-100 transition-colors"
        >
          Dismiss →
        </button>
      </div>
    );
  }

  return (
    <div
      className={`flex items-center gap-2.5 px-4 py-2 rounded-xl border ${s.color} transition-all`}
    >
      <div className={`w-2 h-2 rounded-full ${s.dot} shrink-0`} />
      <span className="text-white/60 text-sm capitalize">{s.label}</span>
    </div>
  );
}

function CallButton({
  id,
  onClick,
  disabled,
  emoji,
  label,
  variant,
}: {
  id: string;
  onClick: () => void;
  disabled: boolean;
  emoji: string;
  label: string;
  variant: "primary" | "secondary" | "danger";
}) {
  const variants = {
    primary:
      "bg-indigo-600 hover:bg-indigo-500 border-indigo-500/50 text-white",
    secondary:
      "bg-slate-700 hover:bg-slate-600 border-white/10 text-white/80 hover:text-white",
    danger: "bg-red-700 hover:bg-red-600 border-red-600/50 text-white w-full",
  };

  return (
    <button
      id={id}
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl border font-medium text-sm
        transition-all duration-200 hover:scale-105 active:scale-95
        disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100
        ${variants[variant]}`}
    >
      <span>{emoji}</span>
      {label}
    </button>
  );
}

function ActiveSessionCard() {
  const { status, remoteStream } = usePeerStore();
  return (
    <div className="bg-emerald-950/50 border border-emerald-700/30 rounded-2xl p-4 flex items-center gap-3">
      <div className="w-10 h-10 rounded-full bg-emerald-600/30 flex items-center justify-center text-lg">
        {remoteStream ? "📹" : "💬"}
      </div>
      <div>
        <p className="text-emerald-300 text-sm font-semibold">
          Active{" "}
          {remoteStream ? "Video Call" : "Text Session"}
        </p>
        <p className="text-white/40 text-xs capitalize">{status}</p>
      </div>
      <div className="ml-auto flex gap-1">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="w-1 bg-emerald-400 rounded-full animate-bounce"
            style={{
              height: `${8 + i * 4}px`,
              animationDelay: `${i * 100}ms`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
