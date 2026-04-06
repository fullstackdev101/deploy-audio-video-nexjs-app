"use client";

import { usePeerStore } from "@/store/usePeerStore";

/**
 * Renders children as a full-screen overlay ONLY when a media session is
 * actively in progress (calling or connected) — NOT during "incoming" which
 * is handled separately by IncomingCallModal.
 */
export default function ActiveCallWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  const { localStream, remoteStream, status } = usePeerStore();
  const hasActiveMedia = !!(localStream || remoteStream);
  // Only show the fullscreen video overlay when there is real media.
  // Text-only chat sets status='connected' but has no streams — keep it on
  // the dashboard instead of launching a black video screen.
  const isMediaCallActive =
    hasActiveMedia && (status === "calling" || status === "connected");

  if (!isMediaCallActive) return null;

  return (
    <div className="fixed inset-0 z-40 bg-black flex flex-col">
      {children}
    </div>
  );
}
