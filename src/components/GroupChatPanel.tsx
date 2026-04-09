"use client";

import { useState, useRef, useEffect } from "react";
import { useGroupStore } from "@/store/useGroupStore";
import { useGroupCallActions } from "@/components/GroupPeerContainer";

export default function GroupChatPanel() {
  const { chatHistory, isChatOpen, toggleGroupChat, groupStatus, participants } =
    useGroupStore();
  const { sendGroupMessage } = useGroupCallActions();
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]);

  useEffect(() => {
    if (isChatOpen) inputRef.current?.focus();
  }, [isChatOpen]);

  const handleSend = () => {
    if (!draft.trim()) return;
    sendGroupMessage(draft);
    setDraft("");
  };

  // Only show when group is active
  if (groupStatus !== "in-room") return null;

  const hasConnectedPeers = Array.from(participants.values()).some(
    (p) => p.dataConnection !== null,
  );

  return (
    <>
      {/* Chat sidebar */}
      <div
        className={`fixed top-0 right-0 h-full w-80 bg-slate-950/95 border-l border-white/10 shadow-2xl z-50 flex flex-col
          backdrop-blur-xl transform transition-transform duration-300 ease-in-out
          ${isChatOpen ? "translate-x-0" : "translate-x-full"}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full ${
                hasConnectedPeers ? "bg-emerald-400 animate-pulse" : "bg-slate-500"
              }`}
            />
            <h2 className="text-white font-semibold text-sm tracking-wide">
              Group Chat
            </h2>
            <span className="text-white/30 text-xs">
              ({participants.size} {participants.size === 1 ? "peer" : "peers"})
            </span>
          </div>
          <button
            onClick={toggleGroupChat}
            className="text-white/40 hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 scrollbar-thin">
          {chatHistory.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-white/30">
              <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z"
                />
              </svg>
              <p className="text-sm text-center">
                No messages yet.
                <br />
                Say hi to the group!
              </p>
            </div>
          ) : (
            chatHistory.map((msg) => {
              const isMe = msg.from === "me";
              // Generate a consistent color from the peerId
              const hue = isMe ? 239 : hashToHue(msg.from);

              return (
                <div
                  key={msg.id}
                  className={`flex ${isMe ? "justify-end" : "justify-start"}`}
                >
                  <div className="max-w-[80%]">
                    {/* Sender name (not shown for own messages) */}
                    {!isMe && (
                      <p
                        className="text-[11px] font-medium mb-0.5 ml-1"
                        style={{ color: `hsl(${hue}, 70%, 70%)` }}
                      >
                        {msg.displayName}
                      </p>
                    )}
                    <div
                      className={`px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                        isMe
                          ? "bg-indigo-600 text-white rounded-br-sm"
                          : "bg-white/10 text-white/90 rounded-bl-sm"
                      }`}
                    >
                      <p>{msg.text}</p>
                      <p
                        className={`text-[10px] mt-1 ${
                          isMe ? "text-indigo-200/70" : "text-white/30"
                        }`}
                      >
                        {msg.timestamp.toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="px-4 py-4 border-t border-white/10">
          {!hasConnectedPeers && (
            <p className="text-xs text-amber-400/70 text-center mb-2">
              Waiting for peers to connect…
            </p>
          )}
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              disabled={!hasConnectedPeers}
              placeholder={hasConnectedPeers ? "Message the group…" : "No peers connected"}
              className="flex-1 bg-white/8 border border-white/10 rounded-xl px-3 py-2 text-sm
                text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-indigo-500
                disabled:opacity-40 transition-all"
            />
            <button
              onClick={handleSend}
              disabled={!hasConnectedPeers || !draft.trim()}
              className="w-10 h-10 flex items-center justify-center rounded-xl bg-indigo-600
                hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed
                transition-all duration-200 hover:scale-105 active:scale-95 shrink-0"
            >
              <svg className="w-4 h-4 text-white rotate-45" fill="currentColor" viewBox="0 0 24 24">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Hash peer ID to a hue for consistent sender colors ──────────────────────
function hashToHue(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
}
