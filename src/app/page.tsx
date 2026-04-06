import PeerContainer from "@/components/PeerContainer";
import Dashboard from "@/components/Dashboard";
import VideoInterface from "@/components/VideoInterface";
import ChatInterface from "@/components/ChatInterface";
import ActiveCallWrapper from "@/components/ActiveCallWrapper";
import IncomingCallModal from "@/components/IncomingCallModal";

export default function Home() {
  return (
    <PeerContainer>
      <main className="relative w-full min-h-screen">
        {/* Dashboard is always rendered underneath */}
        <Dashboard />

        {/* Incoming call ringing screen — Accept / Decline */}
        <IncomingCallModal />

        {/* Full-screen overlay when calling or connected */}
        <ActiveCallWrapper>
          <VideoInterface />
        </ActiveCallWrapper>

        {/* Chat sidebar & toggle — always mounted so messages persist */}
        <ChatInterface />
      </main>
    </PeerContainer>
  );
}
