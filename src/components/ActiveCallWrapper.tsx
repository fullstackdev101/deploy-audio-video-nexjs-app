"use client";

import { usePeerStore } from "@/store/usePeerStore";

/**
 * Conditionally renders full-screen children overlay when a media call is active.
 * When idle/ready, falls through and shows nothing.
 */
export default function ActiveCallWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  const { localStream, remoteStream, status } = usePeerStore();
  const hasActiveMedia = !!(localStream || remoteStream);
  const isCallActive =
    status === "calling" ||
    status === "incoming" ||
    status === "connected";

  if (!hasActiveMedia && !isCallActive) return null;

  return (
    <div className="fixed inset-0 z-40 bg-black">
      {children}
    </div>
  );
}
