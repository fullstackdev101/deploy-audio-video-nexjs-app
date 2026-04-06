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
  const isCallActive = status === "calling" || status === "connected";

  if (!hasActiveMedia && !isCallActive) return null;

  return (
    <div className="fixed inset-0 z-40 bg-black flex flex-col">
      {children}
    </div>
  );
}
