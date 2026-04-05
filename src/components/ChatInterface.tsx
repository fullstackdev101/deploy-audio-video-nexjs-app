"use client";

import { useState, useRef, useEffect } from "react";
import { usePeerStore } from "@/store/usePeerStore";
import { useCallActions } from "@/components/PeerContainer";

export default function ChatInterface() {
  const { chatHistory, isChatOpen, toggleChat, status, dataConnection } =
    usePeerStore();
  const { sendMessage } = useCallActions();
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
    sendMessage(draft);
    setDraft("");
  };

  const canSend = !!dataConnection && status === "connected";

  return (
    <>
      {/* Toggle button */}
      <button
        id="btn-toggle-chat"
        onClick={toggleChat}
        className={`fixed bottom-24 right-6 z-50 flex items-center justify-center w-14 h-14 rounded-full shadow-2xl transition-all duration-300 hover:scale-110 active:scale-95 ${
          isChatOpen
            ? "bg-indigo-600 text-white shadow-indigo-500/40"
            : "bg-slate-800 border border-white/10 text-white/70 hover:text-white"
        }`}
        title="Toggle Chat"
      >
        <svg
          className="w-6 h-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
          />
        </svg>
        {chatHistory.length > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-[10px] font-bold flex items-center justify-center">
            {chatHistory.length > 9 ? "9+" : chatHistory.length}
          </span>
        )}
      </button>

      {/* Chat sidebar */}
      <div
        className={`fixed top-0 right-0 h-full w-80 bg-slate-950 border-l border-white/10 shadow-2xl z-50 flex flex-col
          transform transition-transform duration-300 ease-in-out
          ${isChatOpen ? "translate-x-0" : "translate-x-full"}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full ${
                canSend ? "bg-emerald-400 animate-pulse" : "bg-slate-500"
              }`}
            />
            <h2 className="text-white font-semibold text-sm tracking-wide">
              Chat
            </h2>
          </div>
          <button
            onClick={toggleChat}
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
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                />
              </svg>
              <p className="text-sm text-center">
                No messages yet.
                <br />
                Start the conversation!
              </p>
            </div>
          ) : (
            chatHistory.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.from === "me" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm leading-relaxed
                    ${
                      msg.from === "me"
                        ? "bg-indigo-600 text-white rounded-br-sm"
                        : "bg-white/10 text-white/90 rounded-bl-sm"
                    }`}
                >
                  <p>{msg.text}</p>
                  <p
                    className={`text-[10px] mt-1 ${
                      msg.from === "me" ? "text-indigo-200/70" : "text-white/30"
                    }`}
                  >
                    {msg.timestamp.toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="px-4 py-4 border-t border-white/10">
          {!canSend && (
            <p className="text-xs text-amber-400/70 text-center mb-2">
              {status === "idle" || status === "ready"
                ? "Connect to a peer to start chatting"
                : "Establishing chat channel…"}
            </p>
          )}
          <div className="flex gap-2">
            <input
              ref={inputRef}
              id="msg-input"
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              disabled={!canSend}
              placeholder={canSend ? "Type a message…" : "Not connected"}
              className="flex-1 bg-white/8 border border-white/10 rounded-xl px-3 py-2 text-sm
                text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-indigo-500
                disabled:opacity-40 transition-all"
            />
            <button
              id="btn-send-msg"
              onClick={handleSend}
              disabled={!canSend || !draft.trim()}
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
