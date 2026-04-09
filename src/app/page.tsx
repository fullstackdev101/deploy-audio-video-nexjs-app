"use client";

import { useState } from "react";
import PeerContainer from "@/components/PeerContainer";
import GroupPeerContainer from "@/components/GroupPeerContainer";
import Dashboard from "@/components/Dashboard";
import VideoInterface from "@/components/VideoInterface";
import ChatInterface from "@/components/ChatInterface";
import ActiveCallWrapper from "@/components/ActiveCallWrapper";
import IncomingCallModal from "@/components/IncomingCallModal";
import GroupRoom from "@/components/GroupRoom";
import GroupVideoGrid from "@/components/GroupVideoGrid";
import GroupChatPanel from "@/components/GroupChatPanel";
import { useGroupStore } from "@/store/useGroupStore";

function AppContent() {
  const [mode, setMode] = useState<"1to1" | "group">("1to1");
  const groupStatus = useGroupStore((s) => s.groupStatus);

  // If group call is actively in-room, show the group UI overlay
  const isInGroupRoom = groupStatus === "in-room";

  return (
    <main className="relative w-full min-h-screen">
      {mode === "1to1" ? (
        <>
          {/* Dashboard is always rendered underneath */}
          <Dashboard onSwitchToGroup={() => setMode("group")} />

          {/* Incoming call ringing screen — Accept / Decline */}
          <IncomingCallModal />

          {/* Full-screen overlay when calling or connected */}
          <ActiveCallWrapper>
            <VideoInterface />
          </ActiveCallWrapper>

          {/* Chat sidebar & toggle — always mounted so messages persist */}
          <ChatInterface />
        </>
      ) : (
        <>
          {/* Group mode: show room setup or active group call */}
          {!isInGroupRoom && (
            <GroupRoom onBack={() => setMode("1to1")} />
          )}

          {/* Group video grid (full-screen, only when in-room) */}
          <GroupVideoGrid />

          {/* Group chat sidebar */}
          <GroupChatPanel />
        </>
      )}
    </main>
  );
}

export default function Home() {
  return (
    <PeerContainer>
      <GroupPeerContainer>
        <AppContent />
      </GroupPeerContainer>
    </PeerContainer>
  );
}
