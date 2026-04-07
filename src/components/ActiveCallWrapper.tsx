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
  const { localStream, remoteStream, status, hasLocalVideo, hasRemoteVideo } =
    usePeerStore();
  const hasAnyVideo = hasLocalVideo || hasRemoteVideo;
  const hasAnyMedia = !!(localStream || remoteStream);
  // Only show the fullscreen call overlay while a real call is in progress.
  // Text-only chat keeps the UI on the dashboard, but audio/video calls still
  // need the call controls even when no camera is available.
  const isMediaCallActive =
    hasAnyMedia && (status === "calling" || status === "connected");

  if (!isMediaCallActive) return null;

  return (
    <div className="fixed inset-0 z-40 bg-black flex flex-col">{children}</div>
  );
}
